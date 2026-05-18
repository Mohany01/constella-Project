"""Deadline alert agent built with LangGraph-compatible patterns."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import psycopg2

from .common_imports import BaseModel, Dict, END, Field, List, StateGraph, TypedDict
from .db import get_connection, release_connection


DEADLINE_ALERT_TYPES = ("task_due_soon", "task_overdue")
TIMELINE_ALERT_TYPES = (
    "task_blocked",
    "task_ready_to_start",
    "task_critical_path_delay",
)
MANAGED_ALERT_TYPES = DEADLINE_ALERT_TYPES + TIMELINE_ALERT_TYPES
COMPLETED_TASK_STATUSES = {"done", "completed", "complete", "closed"}
AUTO_STARTABLE_TASK_STATUSES = {"not started", "todo", "to do", "pending"}
IN_PROGRESS_TASK_STATUS = "In Progress"
DB_CONNECTION_ERRORS = (psycopg2.OperationalError, psycopg2.InterfaceError)


class TaskDeadlineContext(BaseModel):
    task_id: int
    project_id: int
    task_name: str
    status: str | None = None
    deadline: datetime | None = None
    employee_ids: List[str] = Field(default_factory=list)


class AlertCandidate(BaseModel):
    task_id: int
    project_id: int
    employee_id: str
    alert_type: str
    severity: str
    message: str


class AlertAgentState(TypedDict, total=False):
    project_id: int | None
    due_soon_days: int
    timeline_status_updates: Dict[str, Any]
    task_context: List[Dict[str, Any]]
    candidate_alerts: List[Dict[str, Any]]
    inserted_alerts: List[Dict[str, Any]]
    resolved_count: int


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _is_db_connection_error(exc: Exception) -> bool:
    if isinstance(exc, DB_CONNECTION_ERRORS):
        return True
    message = str(exc).lower()
    return "ssl connection has been closed" in message or "connection already closed" in message


def _safe_rollback(conn: Any) -> None:
    try:
        if conn is not None and not getattr(conn, "closed", True):
            conn.rollback()
    except Exception:
        pass


def _safe_close_cursor(cur: Any) -> None:
    try:
        if cur is not None:
            cur.close()
    except Exception:
        pass


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _is_completed(status: str | None) -> bool:
    return str(status or "").strip().lower() in COMPLETED_TASK_STATUSES


def _status_key(status: str | None) -> str:
    return str(status or "").strip().replace("_", " ").lower()


def _is_auto_startable(status: str | None) -> bool:
    return _status_key(status) in AUTO_STARTABLE_TASK_STATUSES


def _to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def _get_table_columns(cur, table_name: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row[0] for row in cur.fetchall()}


def _get_task_name_column(task_columns: set[str]) -> str | None:
    if "name" in task_columns:
        return "name"
    if "task_name" in task_columns:
        return "task_name"
    return None


def _get_employee_link_column(columns: set[str]) -> str | None:
    for column in ("employee_id", "emp_id", "member_id", "owner_employee_id"):
        if column in columns:
            return column
    return None


def _get_dependency_column(dep_columns: set[str]) -> str | None:
    for column in (
        "dependent_on_task_id",
        "depends_on_task_id",
        "dependency_task_id",
        "depends_on_id",
        "dependency_id",
    ):
        if column in dep_columns:
            return column
    return None


def _get_dependency_name_column(dep_columns: set[str]) -> str | None:
    for column in ("depends_on_name", "dependency_name"):
        if column in dep_columns:
            return column
    return None


def _scheduled_start_has_arrived(task: Dict[str, Any], now: datetime) -> bool:
    task_start = _coerce_datetime(task.get("task_start"))
    if task_start:
        return task_start <= now
    project_start = _coerce_datetime(task.get("project_start"))
    if not project_start:
        return False
    offset_days = max(0, _to_int(task.get("start_days_from_kickoff"), 0))
    return project_start + timedelta(days=offset_days) <= now


def _load_timeline_tasks(cur, project_id: int | None = None) -> Dict[int, Dict[str, Any]]:
    task_columns = _get_table_columns(cur, "task")
    project_columns = _get_table_columns(cur, "project")
    task_name_col = _get_task_name_column(task_columns)
    required = {"task_id", "project_id", "status"}
    if not required.issubset(task_columns) or not task_name_col or "project_id" not in project_columns:
        return {}

    select_cols = [
        "t.task_id",
        "t.project_id",
        f"t.{task_name_col} AS name",
        "t.status",
        "p.start_date AS project_start",
    ]
    if "deadline" in task_columns:
        select_cols.append("t.deadline")
    else:
        select_cols.append("NULL AS deadline")
    if "start_days_from_kickoff" in task_columns:
        select_cols.append("t.start_days_from_kickoff")
    else:
        select_cols.append("0 AS start_days_from_kickoff")
    if "start_date" in task_columns:
        select_cols.append("t.start_date AS task_start")
    else:
        select_cols.append("NULL AS task_start")

    query = f"""
        SELECT {", ".join(select_cols)}
        FROM task t
        JOIN project p ON p.project_id = t.project_id
        WHERE p.start_date IS NOT NULL
    """
    params: List[Any] = []
    if project_id:
        query += " AND t.project_id = %s"
        params.append(project_id)
    query += " ORDER BY t.project_id, t.task_id"

    cur.execute(query, params)
    cols = [desc[0] for desc in cur.description]
    return {
        int(row_dict["task_id"]): row_dict
        for row_dict in (dict(zip(cols, row)) for row in cur.fetchall())
        if row_dict.get("task_id") is not None
    }


def _load_task_dependencies(
    cur, tasks_by_id: Dict[int, Dict[str, Any]]
) -> Dict[int, List[int]]:
    dependencies: Dict[int, List[int]] = {task_id: [] for task_id in tasks_by_id}
    if not tasks_by_id:
        return dependencies

    dep_columns = _get_table_columns(cur, "task_dependency")
    if "task_id" not in dep_columns:
        return dependencies

    dep_id_col = _get_dependency_column(dep_columns)
    dep_name_col = _get_dependency_name_column(dep_columns)
    if not dep_id_col and not dep_name_col:
        return dependencies

    select_cols = ["task_id"]
    if "project_id" in dep_columns:
        select_cols.append("project_id")
    if dep_id_col:
        select_cols.append(dep_id_col)
    elif dep_name_col:
        select_cols.append(dep_name_col)

    task_ids = list(tasks_by_id.keys())
    cur.execute(
        f"""
        SELECT {", ".join(select_cols)}
        FROM task_dependency
        WHERE task_id = ANY(%s)
        """,
        (task_ids,),
    )
    rows = cur.fetchall()
    cols = [desc[0] for desc in cur.description]
    task_id_by_project_name = {
        (int(task["project_id"]), str(task["name"])): int(task_id)
        for task_id, task in tasks_by_id.items()
        if task.get("project_id") is not None and task.get("name")
    }

    for raw_row in rows:
        row = dict(zip(cols, raw_row))
        try:
            task_id = int(row.get("task_id"))
        except Exception:
            continue
        if task_id not in tasks_by_id:
            continue
        dep_task_id = None
        if dep_id_col:
            dep_task_id = row.get(dep_id_col)
        elif dep_name_col:
            project_id = row.get("project_id") or tasks_by_id[task_id].get("project_id")
            dep_task_id = task_id_by_project_name.get((int(project_id), str(row.get(dep_name_col))))
        try:
            dep_task_id = int(dep_task_id)
        except Exception:
            dep_task_id = None
        if dep_task_id in tasks_by_id:
            dependencies[task_id].append(dep_task_id)

    return dependencies


def _load_task_assignees(cur, task_ids: List[int]) -> Dict[int, List[str]]:
    assignees: Dict[int, List[str]] = {task_id: [] for task_id in task_ids}
    if not task_ids:
        return assignees

    employee_task_columns = _get_table_columns(cur, "employee_task")
    employee_task_employee_col = _get_employee_link_column(employee_task_columns)
    if "task_id" in employee_task_columns and employee_task_employee_col:
        cur.execute(
            f"""
            SELECT task_id, {employee_task_employee_col}
            FROM employee_task
            WHERE task_id = ANY(%s)
            ORDER BY task_id, {employee_task_employee_col}
            """,
            (task_ids,),
        )
        for task_id, emp_id in cur.fetchall():
            try:
                task_id = int(task_id)
            except Exception:
                continue
            if task_id in assignees and emp_id is not None:
                assignees[task_id].append(str(emp_id))

    task_columns = _get_table_columns(cur, "task")
    if "task_id" in task_columns and "owner_employee_id" in task_columns:
        cur.execute(
            """
            SELECT task_id, owner_employee_id
            FROM task
            WHERE task_id = ANY(%s)
              AND owner_employee_id IS NOT NULL
            ORDER BY task_id, owner_employee_id
            """,
            (task_ids,),
        )
        for task_id, owner_employee_id in cur.fetchall():
            try:
                task_id = int(task_id)
            except Exception:
                continue
            employee_id = str(owner_employee_id)
            if task_id in assignees and employee_id not in assignees[task_id]:
                assignees[task_id].append(employee_id)
    return assignees


def advance_ready_tasks(cur, project_id: int | None = None) -> Dict[str, Any]:
    """
    Move scheduled tasks into In Progress only when all dependencies are complete.
    The caller owns the transaction.
    """
    task_columns = _get_table_columns(cur, "task")
    if "task_id" not in task_columns or "status" not in task_columns:
        return {"activated_task_ids": [], "activated_count": 0}

    now = _utc_now()
    tasks_by_id = _load_timeline_tasks(cur, project_id=project_id)
    dependencies = _load_task_dependencies(cur, tasks_by_id)

    ready_ids: List[int] = []
    for task_id, task in tasks_by_id.items():
        if not _is_auto_startable(task.get("status")):
            continue
        if not _scheduled_start_has_arrived(task, now):
            continue
        dependency_ids = dependencies.get(task_id, [])
        if all(_is_completed(tasks_by_id.get(dep_id, {}).get("status")) for dep_id in dependency_ids):
            ready_ids.append(task_id)

    if ready_ids:
        cur.execute(
            """
            UPDATE task
            SET status = %s
            WHERE task_id = ANY(%s)
            """,
            (IN_PROGRESS_TASK_STATUS, ready_ids),
        )

    return {"activated_task_ids": ready_ids, "activated_count": len(ready_ids)}


def sync_timeline_task_statuses(project_id: int | None = None) -> Dict[str, Any]:
    conn = get_connection()
    if conn is None:
        raise RuntimeError("Database connection not available.")

    cur = conn.cursor()
    try:
        result = advance_ready_tasks(cur, project_id=project_id)
        conn.commit()
        return result
    except Exception:
        _safe_rollback(conn)
        raise
    finally:
        _safe_close_cursor(cur)
        release_connection(conn)


def _build_due_soon_message(task_name: str, deadline: datetime) -> str:
    due_text = deadline.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"Task '{task_name}' is due soon on {due_text}."


def _build_overdue_message(task_name: str, deadline: datetime) -> str:
    due_text = deadline.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"Task '{task_name}' passed its deadline on {due_text}."


def load_deadline_context_node(state: AlertAgentState) -> AlertAgentState:
    """Load tasks with deadlines and current assignees from the database."""
    if state.get("task_context"):
        return state

    conn = get_connection()
    if conn is None:
        raise RuntimeError("Database connection not available.")

    cur = conn.cursor()
    try:
        project_id = state.get("project_id")
        task_columns = _get_table_columns(cur, "task")
        task_name_col = _get_task_name_column(task_columns)
        if not task_name_col:
            return {"task_context": []}

        task_query = f"""
            SELECT t.task_id,
                   t.project_id,
                   t.{task_name_col},
                   t.status,
                   t.deadline
            FROM task t
            WHERE 1 = 1
        """
        params: List[Any] = []
        if project_id:
            task_query += " AND t.project_id = %s"
            params.append(project_id)
        task_query += " ORDER BY t.deadline ASC, t.task_id ASC"

        cur.execute(task_query, params)
        task_rows = cur.fetchall()
        if not task_rows:
            return {"task_context": []}

        task_map: Dict[int, Dict[str, Any]] = {}
        for task_id, proj_id, task_name, status, deadline in task_rows:
            task_map[int(task_id)] = {
                "task_id": int(task_id),
                "project_id": int(proj_id),
                "task_name": task_name or "Untitled task",
                "status": status,
                "deadline": _coerce_datetime(deadline),
                "employee_ids": [],
            }

        assignees_by_task_id = _load_task_assignees(cur, list(task_map.keys()))
        for task_id, employee_ids in assignees_by_task_id.items():
            task = task_map.get(int(task_id))
            if task:
                task["employee_ids"].extend(employee_ids)

        return {"task_context": list(task_map.values())}
    finally:
        _safe_close_cursor(cur)
        release_connection(conn)


def detect_deadline_alerts_node(state: AlertAgentState) -> AlertAgentState:
    """Detect due-soon and overdue task alerts using deterministic rules."""
    due_soon_days = max(1, int(state.get("due_soon_days", 3) or 3))
    now = _utc_now()
    task_context = state.get("task_context") or []
    candidates: List[Dict[str, Any]] = []

    for raw_task in task_context:
        try:
            task = TaskDeadlineContext(**raw_task)
        except Exception:
            continue

        if _is_completed(task.status) or not task.deadline or not task.employee_ids:
            continue

        seconds_until_due = (task.deadline - now).total_seconds()
        if seconds_until_due < 0:
            alert_type = "task_overdue"
            severity = "critical"
            message = _build_overdue_message(task.task_name, task.deadline)
        elif seconds_until_due <= due_soon_days * 86400:
            alert_type = "task_due_soon"
            severity = "high" if seconds_until_due <= 86400 else "medium"
            message = _build_due_soon_message(task.task_name, task.deadline)
        else:
            continue

        for employee_id in task.employee_ids:
            candidates.append(
                AlertCandidate(
                    task_id=task.task_id,
                    project_id=task.project_id,
                    employee_id=employee_id,
                    alert_type=alert_type,
                    severity=severity,
                    message=message,
                ).model_dump()
            )

    return {"candidate_alerts": candidates}


def detect_timeline_alerts_node(state: AlertAgentState) -> AlertAgentState:
    """Detect dependency timeline alerts after ready tasks have been advanced."""
    existing = state.get("candidate_alerts") or []
    project_id = state.get("project_id")

    conn = get_connection()
    if conn is None:
        raise RuntimeError("Database connection not available.")

    cur = conn.cursor()
    try:
        now = _utc_now()
        tasks_by_id = _load_timeline_tasks(cur, project_id=project_id)
        dependencies = _load_task_dependencies(cur, tasks_by_id)
        assignees = _load_task_assignees(cur, list(tasks_by_id.keys()))
        candidates: List[Dict[str, Any]] = []

        for task_id, task in tasks_by_id.items():
            if _is_completed(task.get("status")):
                continue

            dependency_ids = dependencies.get(task_id, [])
            incomplete_dependencies = [
                dep_id
                for dep_id in dependency_ids
                if not _is_completed(tasks_by_id.get(dep_id, {}).get("status"))
            ]
            if not incomplete_dependencies or not _scheduled_start_has_arrived(task, now):
                continue

            dependency_names = [
                str(tasks_by_id.get(dep_id, {}).get("name") or "dependency")
                for dep_id in incomplete_dependencies
            ]
            message = (
                f"Task '{task.get('name') or 'Untitled task'}' is blocked by "
                f"unfinished dependency: {', '.join(dependency_names)}."
            )
            severity = "high"
            for employee_id in assignees.get(task_id, []):
                candidates.append(
                    AlertCandidate(
                        task_id=int(task_id),
                        project_id=int(task.get("project_id")),
                        employee_id=employee_id,
                        alert_type="task_blocked",
                        severity=severity,
                        message=message,
                    ).model_dump()
                )

        downstream_by_parent: Dict[int, List[int]] = {}
        for child_id, dependency_ids in dependencies.items():
            for parent_id in dependency_ids:
                downstream_by_parent.setdefault(parent_id, []).append(child_id)

        for parent_id, child_ids in downstream_by_parent.items():
            parent = tasks_by_id.get(parent_id)
            if not parent or _is_completed(parent.get("status")):
                continue
            deadline = _coerce_datetime(parent.get("deadline"))
            if not deadline or deadline >= now:
                continue
            open_children = [
                child_id
                for child_id in child_ids
                if not _is_completed(tasks_by_id.get(child_id, {}).get("status"))
            ]
            if not open_children:
                continue

            message = (
                f"Task '{parent.get('name') or 'Untitled task'}' is overdue "
                "and blocking downstream work."
            )
            for employee_id in assignees.get(parent_id, []):
                candidates.append(
                    AlertCandidate(
                        task_id=int(parent_id),
                        project_id=int(parent.get("project_id")),
                        employee_id=employee_id,
                        alert_type="task_critical_path_delay",
                        severity="critical",
                        message=message,
                    ).model_dump()
                )

        return {"candidate_alerts": existing + candidates}
    finally:
        _safe_close_cursor(cur)
        release_connection(conn)


def _get_allowed_alert_types(cur) -> set[str] | None:
    """Return enum labels for alert.alert_type, or None when it is unrestricted text."""
    cur.execute(
        """
        SELECT e.enumlabel
        FROM information_schema.columns c
        JOIN pg_type t ON t.typname = c.udt_name
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE c.table_schema = 'public'
          AND c.table_name = 'alert'
          AND c.column_name = 'alert_type'
        ORDER BY e.enumsortorder
        """
    )
    rows = cur.fetchall()
    if not rows:
        return None
    return {str(row[0]) for row in rows}


def _resolve_alert_type(requested: str, allowed: set[str] | None) -> str | None:
    if allowed is None or requested in allowed:
        return requested

    fallback = {
        "task_blocked": "task_overdue",
        "task_ready_to_start": "task_due_soon",
        "task_critical_path_delay": "task_overdue",
    }.get(requested)
    if fallback and fallback in allowed:
        return fallback
    return None


def _open_alert_condition(alert_columns: set[str]) -> str:
    if "is_resolved" in alert_columns:
        return "is_resolved = FALSE"
    if "status" in alert_columns:
        return "COALESCE(LOWER(status), 'open') NOT IN ('resolved', 'closed')"
    if "resolved_at" in alert_columns:
        return "resolved_at IS NULL"
    return "1 = 1"


def persist_deadline_alerts_node(state: AlertAgentState) -> AlertAgentState:
    """Insert non-duplicate unresolved alerts into the alert table."""
    candidates = state.get("candidate_alerts") or []
    if not candidates:
        return {"inserted_alerts": []}

    conn = get_connection()
    if conn is None:
        raise RuntimeError("Database connection not available.")

    cur = conn.cursor()
    inserted: List[Dict[str, Any]] = []
    try:
        alert_columns = _get_table_columns(cur, "alert")
        open_condition = _open_alert_condition(alert_columns)
        allowed_alert_types = _get_allowed_alert_types(cur)
        for candidate in candidates:
            alert = AlertCandidate(**candidate)
            stored_alert_type = _resolve_alert_type(alert.alert_type, allowed_alert_types)
            if not stored_alert_type:
                continue

            cur.execute(
                f"""
                SELECT alert_id
                FROM alert
                WHERE task_id = %s
                  AND project_id = %s
                  AND employee_id = %s
                  AND alert_type::text = %s
                  AND {open_condition}
                LIMIT 1
                """,
                (
                    alert.task_id,
                    alert.project_id,
                    alert.employee_id,
                    stored_alert_type,
                ),
            )
            if cur.fetchone():
                continue

            insert_data = {
                "task_id": alert.task_id,
                "project_id": alert.project_id,
                "message": alert.message,
                "alert_type": stored_alert_type,
                "severity": alert.severity,
                "employee_id": alert.employee_id,
                "status": "open",
            }
            insert_columns = [column for column in insert_data if column in alert_columns]
            if not {"task_id", "project_id", "message", "alert_type"}.issubset(insert_columns):
                continue
            returning_cols = [column for column in ("alert_id", "alert_date") if column in alert_columns]
            returning_sql = f" RETURNING {', '.join(returning_cols)}" if returning_cols else ""
            placeholders = ", ".join(["%s"] * len(insert_columns))
            cur.execute(
                f"""
                INSERT INTO alert ({", ".join(insert_columns)})
                VALUES ({placeholders})
                {returning_sql}
                """,
                [insert_data[column] for column in insert_columns],
            )
            returned = cur.fetchone() if returning_cols else None
            returned_payload = dict(zip(returning_cols, returned or []))
            payload = alert.model_dump()
            payload["alert_type"] = stored_alert_type
            if "alert_id" in returned_payload:
                payload["alert_id"] = int(returned_payload["alert_id"])
            if "alert_date" in returned_payload:
                alert_date = returned_payload["alert_date"]
                payload["alert_date"] = alert_date.isoformat() if hasattr(alert_date, "isoformat") else str(alert_date)
            inserted.append(payload)

        conn.commit()
        return {"inserted_alerts": inserted}
    except Exception:
        _safe_rollback(conn)
        raise
    finally:
        _safe_close_cursor(cur)
        release_connection(conn)


def resolve_deadline_alerts_node(state: AlertAgentState) -> AlertAgentState:
    """Resolve obsolete deadline alerts when tasks are completed or alert type changed."""
    task_context = state.get("task_context") or []
    candidate_alerts = state.get("candidate_alerts") or []

    task_completion = {
        int(item["task_id"]): _is_completed(item.get("status"))
        for item in task_context
        if item.get("task_id") is not None
    }

    conn = get_connection()
    if conn is None:
        raise RuntimeError("Database connection not available.")

    cur = conn.cursor()
    resolved_count = 0
    try:
        alert_columns = _get_table_columns(cur, "alert")
        open_condition = _open_alert_condition(alert_columns)
        allowed_alert_types = _get_allowed_alert_types(cur)
        active_pairs = set()
        for item in candidate_alerts:
            if item.get("task_id") is None or not item.get("employee_id") or not item.get("alert_type"):
                continue
            stored_type = _resolve_alert_type(str(item["alert_type"]), allowed_alert_types)
            if stored_type:
                active_pairs.add((int(item["task_id"]), str(item["employee_id"]), stored_type))

        task_ids = [int(item["task_id"]) for item in task_context if item.get("task_id") is not None]
        if not task_ids:
            return {"resolved_count": 0}

        cur.execute(
            f"""
            SELECT alert_id, task_id, employee_id, alert_type
            FROM alert
            WHERE task_id = ANY(%s)
              AND alert_type::text = ANY(%s)
              AND {open_condition}
            """,
            (task_ids, list(MANAGED_ALERT_TYPES)),
        )
        rows = cur.fetchall()
        for alert_id, task_id, employee_id, alert_type in rows:
            key = (int(task_id), str(employee_id), str(alert_type))
            should_resolve = task_completion.get(int(task_id), False) or key not in active_pairs
            if not should_resolve:
                continue

            updates = []
            params: List[Any] = []
            if "is_resolved" in alert_columns:
                updates.append("is_resolved = TRUE")
            if "status" in alert_columns:
                updates.append("status = %s")
                params.append("resolved")
            if "resolved_at" in alert_columns:
                updates.append("resolved_at = CURRENT_TIMESTAMP")
            if not updates:
                continue

            cur.execute(
                f"UPDATE alert SET {', '.join(updates)} WHERE alert_id = %s",
                params + [alert_id],
            )
            resolved_count += cur.rowcount or 0

        conn.commit()
        return {"resolved_count": resolved_count}
    except Exception:
        _safe_rollback(conn)
        raise
    finally:
        _safe_close_cursor(cur)
        release_connection(conn)


def sync_timeline_status_node(state: AlertAgentState) -> AlertAgentState:
    """Apply automatic timeline status transitions before alert detection."""
    return {
        "timeline_status_updates": sync_timeline_task_statuses(
            project_id=state.get("project_id")
        )
    }


def build_deadline_alert_graph():
    """Compile the alert workflow graph."""
    graph = StateGraph(AlertAgentState)
    graph.add_node("sync_timeline", sync_timeline_status_node)
    graph.add_node("load_context", load_deadline_context_node)
    graph.add_node("detect_alerts", detect_deadline_alerts_node)
    graph.add_node("detect_timeline_alerts", detect_timeline_alerts_node)
    graph.add_node("persist_alerts", persist_deadline_alerts_node)
    graph.add_node("resolve_alerts", resolve_deadline_alerts_node)
    graph.set_entry_point("sync_timeline")
    graph.add_edge("sync_timeline", "load_context")
    graph.add_edge("load_context", "detect_alerts")
    graph.add_edge("detect_alerts", "detect_timeline_alerts")
    graph.add_edge("detect_timeline_alerts", "persist_alerts")
    graph.add_edge("persist_alerts", "resolve_alerts")
    graph.add_edge("resolve_alerts", END)
    return graph.compile()


def run_deadline_alert_agent(
    project_id: int | None = None, due_soon_days: int = 3
) -> Dict[str, Any]:
    """Run the deadline alert graph and return a compact summary."""
    normalized_due_soon_days = max(1, int(due_soon_days or 3))
    result: Dict[str, Any] | None = None
    for attempt in range(2):
        try:
            app = build_deadline_alert_graph()
            result = app.invoke(
                {
                    "project_id": project_id,
                    "due_soon_days": normalized_due_soon_days,
                }
            )
            break
        except Exception as exc:
            if attempt == 0 and _is_db_connection_error(exc):
                continue
            raise
    if result is None:
        raise RuntimeError("Deadline alert agent did not return a result.")

    inserted_alerts = result.get("inserted_alerts") or []
    return {
        "project_id": project_id,
        "due_soon_days": normalized_due_soon_days,
        "timeline_status_updates": result.get("timeline_status_updates") or {},
        "task_count": len(result.get("task_context") or []),
        "detected_count": len(result.get("candidate_alerts") or []),
        "inserted_count": len(inserted_alerts),
        "resolved_count": int(result.get("resolved_count") or 0),
        "inserted_alerts": inserted_alerts,
    }
