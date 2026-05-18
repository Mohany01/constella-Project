from __future__ import annotations

from typing import Optional, Any, Dict, List
from datetime import datetime, timedelta
from email.message import EmailMessage
import os
import smtplib

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.common_imports import HumanMessage, PdfReader, json
from app.db import get_connection, release_connection
from app.alert_agent import advance_ready_tasks, run_deadline_alert_agent
from app.auth_guard import get_current_user
from app.learning_path_node import learning_path_node
from app.project_analyzer_node import project_analyzer_node, ProjectAnalysisOutput
from app.team_builder_node import team_builder_node


router = APIRouter(prefix="/projects", tags=["projects"])

MAX_PDF_CHARS = 8000
TASK_HOURS_PER_DAY = int(os.getenv("TASK_HOURS_PER_DAY", "8"))
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME)
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")


def _resolve_task_duration(task: Dict[str, Any]) -> int:
    duration = task.get("duration_days")
    if duration is None:
        estimated = task.get("estimated_hours")
        if estimated is not None:
            try:
                duration = max(1, int((float(estimated) + TASK_HOURS_PER_DAY - 1) // TASK_HOURS_PER_DAY))
            except Exception:
                duration = 1
        else:
            duration = 1
    try:
        return max(1, int(duration))
    except Exception:
        return 1


class TeamBuildRequest(BaseModel):
    project_name: str = Field(..., min_length=1)
    analysis: Dict[str, Any] = Field(default_factory=dict)
    num_employees: int = Field(3, ge=1, le=50)


class TeamAssignmentInput(BaseModel):
    task_name: str = Field(..., min_length=1)
    missing_skills: List[str] = Field(default_factory=list)


class TeamMemberInput(BaseModel):
    employee_id: Optional[str] = None
    employee_email: Optional[str] = None
    employee_filename: Optional[str] = None
    assignments: List[TeamAssignmentInput] = Field(default_factory=list)


class TeamSaveRequest(BaseModel):
    project_id: int = Field(..., ge=1)
    team: List[TeamMemberInput] = Field(default_factory=list)
    unassigned_tasks: List[str] = Field(default_factory=list)
    num_employees: Optional[int] = None


class LearningPathAssignmentInput(BaseModel):
    task_name: Optional[str] = None
    missing_skills: List[str] = Field(default_factory=list)


class LearningPathTeamMemberInput(BaseModel):
    employee_id: str = Field(..., min_length=1)
    employee_email: Optional[str] = None
    employee_filename: Optional[str] = None
    assignments: List[LearningPathAssignmentInput] = Field(default_factory=list)


class SendLearningPathsRequest(BaseModel):
    team: List[LearningPathTeamMemberInput] = Field(default_factory=list)


class NotificationReadRequest(BaseModel):
    notification_id: int = Field(..., ge=1)


class AlertRunRequest(BaseModel):
    project_id: Optional[int] = Field(None, ge=1)
    due_soon_days: int = Field(3, ge=1, le=30)


class AlertResolveRequest(BaseModel):
    alert_id: int = Field(..., ge=1)


class ProjectTaskInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = ""
    depends_on: Optional[List[str]] = None
    skills: Optional[List[str]] = None
    start_days_from_kickoff: int = Field(0, ge=0)
    duration_days: int = Field(1, ge=1)


class ProjectSaveRequest(BaseModel):
    project_id: Optional[int] = None
    name: str = Field(..., min_length=1)
    description: Optional[str] = ""
    budget: Optional[float] = None
    tasks: Optional[List[ProjectTaskInput]] = None


class ProjectStartRequest(BaseModel):
    project_id: int = Field(..., ge=1)
    duration_days: int = Field(..., ge=1, le=3650)


class TaskStatusUpdateRequest(BaseModel):
    status: str = Field(..., min_length=1, max_length=40)


TASK_STATUS_ALIASES = {
    "not started": "Not Started",
    "todo": "Not Started",
    "to do": "Not Started",
    "in progress": "In Progress",
    "in_progress": "In Progress",
    "doing": "In Progress",
    "blocked": "Blocked",
    "done": "Completed",
    "complete": "Completed",
    "completed": "Completed",
}


def _normalize_task_status(status_value: str) -> str:
    normalized = str(status_value or "").strip().replace("_", " ").lower()
    status_label = TASK_STATUS_ALIASES.get(normalized)
    if not status_label:
        allowed = ", ".join(sorted(set(TASK_STATUS_ALIASES.values())))
        raise HTTPException(
            status_code=400,
            detail=f"Invalid task status. Allowed values: {allowed}.",
        )
    return status_label


def _is_completed_task_status(status_value: str) -> bool:
    return str(status_value or "").strip().lower() in {"completed", "complete", "done"}


def _get_table_columns(cur, table_name: str):
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row[0] for row in cur.fetchall()}


def _get_task_name_column(task_columns) -> Optional[str]:
    if "name" in task_columns:
        return "name"
    if "task_name" in task_columns:
        return "task_name"
    return None


def _get_project_name_column(project_columns) -> Optional[str]:
    if "project_name" in project_columns:
        return "project_name"
    if "name" in project_columns:
        return "name"
    if "title" in project_columns:
        return "title"
    return None


def _get_project_budget_column(project_columns) -> Optional[str]:
    if "planned_budget" in project_columns:
        return "planned_budget"
    if "budget" in project_columns:
        return "budget"
    return None


def _get_employee_link_column(columns) -> Optional[str]:
    for column in ("employee_id", "emp_id", "member_id", "owner_employee_id"):
        if column in columns:
            return column
    return None


def _project_select_clause(project_columns) -> str:
    project_name_col = _get_project_name_column(project_columns)
    project_budget_col = _get_project_budget_column(project_columns)
    if "project_id" not in project_columns or not project_name_col:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

    return ", ".join(
        [
            "project_id",
            f"{project_name_col} AS name",
            "description" if "description" in project_columns else "NULL AS description",
            f"{project_budget_col} AS budget" if project_budget_col else "NULL AS budget",
            "start_date" if "start_date" in project_columns else "NULL AS start_date",
            "end_date" if "end_date" in project_columns else "NULL AS end_date",
            "deadline" if "deadline" in project_columns else "NULL AS deadline",
            "manager_id" if "manager_id" in project_columns else "NULL AS manager_id",
        ]
    )


def _current_employee_identifiers(cur, user) -> List[str]:
    """Return all DB employee identifiers that may represent the current user."""
    identifiers: List[str] = []

    def add_identifier(value: Any) -> None:
        if value is None:
            return
        text = str(value).strip()
        if text and text not in identifiers:
            identifiers.append(text)

    add_identifier(user.get("id"))
    email = str(user.get("email") or "").strip()
    employee_columns = _get_table_columns(cur, "employee")
    selectable = [
        column for column in ("id", "employee_id") if column in employee_columns
    ]
    if not selectable:
        return identifiers

    where_parts = []
    params: List[Any] = []
    if email and "email" in employee_columns:
        where_parts.append("email = %s")
        params.append(email)
    if user.get("id"):
        if "id" in employee_columns:
            where_parts.append("id::text = %s")
            params.append(str(user.get("id")))
        if "employee_id" in employee_columns:
            where_parts.append("employee_id::text = %s")
            params.append(str(user.get("id")))

    if not where_parts:
        return identifiers

    cur.execute(
        f"""
        SELECT {", ".join(selectable)}
        FROM employee
        WHERE {" OR ".join(where_parts)}
        LIMIT 1
        """,
        params,
    )
    row = cur.fetchone()
    if row:
        for value in row:
            add_identifier(value)
    return identifiers


def _find_project_member_table(cur):
    """Find a project-member join table that stores employee IDs."""
    candidate_tables = [
        "project_employee",
        "project_team",
        "project_member",
        "project_stakeholder",
    ]
    employee_columns = ("employee_id", "emp_id", "member_id")
    for table in candidate_tables:
        columns = _get_table_columns(cur, table)
        if not columns or "project_id" not in columns:
            continue
        for emp_col in employee_columns:
            if emp_col in columns:
                return table, emp_col
    return None, None


def _compute_task_deadline(project_start, start_offset, duration_days):
    if not project_start:
        return None
    safe_start = max(0, int(start_offset or 0))
    safe_duration = max(1, int(duration_days or 1))
    return project_start + timedelta(days=safe_start + safe_duration)


def _refresh_task_deadlines_for_project(cur, project_id: int, project_start) -> int:
    """Set task deadlines from the project start and each task's timeline offset."""
    if not project_start:
        return 0

    task_columns = _get_table_columns(cur, "task")
    if "task_id" not in task_columns or "project_id" not in task_columns or "deadline" not in task_columns:
        return 0

    select_cols = ["task_id"]
    if "start_days_from_kickoff" in task_columns:
        select_cols.append("start_days_from_kickoff")
    else:
        select_cols.append("0 AS start_days_from_kickoff")
    if "duration_days" in task_columns:
        select_cols.append("duration_days")
    elif "estimated_hours" in task_columns:
        select_cols.append("estimated_hours")
    else:
        select_cols.append("1 AS duration_days")

    cur.execute(
        f"""
        SELECT {", ".join(select_cols)}
        FROM task
        WHERE project_id = %s
        """,
        (project_id,),
    )
    cols = [desc[0] for desc in cur.description]
    updated_count = 0
    for row in cur.fetchall():
        task = dict(zip(cols, row))
        if "duration_days" in task:
            duration_days = task.get("duration_days")
        else:
            duration_days = _resolve_task_duration(task)
        deadline = _compute_task_deadline(
            project_start,
            task.get("start_days_from_kickoff", 0),
            duration_days,
        )
        update_data = {"deadline": deadline}
        if "start_date" in task_columns:
            update_data["start_date"] = project_start + timedelta(
                days=max(0, int(task.get("start_days_from_kickoff", 0) or 0))
            )
        set_clause = ", ".join(f"{column} = %s" for column in update_data)
        cur.execute(
            f"UPDATE task SET {set_clause} WHERE task_id = %s",
            list(update_data.values()) + [task["task_id"]],
        )
        updated_count += cur.rowcount or 0
    return updated_count


def _serialize_date(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _serialize_task_value(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _notification_row_to_dict(row: Any) -> Dict[str, Any]:
    notification_id, employee_id, notif_type, title, is_read, created_at = row
    return {
        "id": notification_id,
        "employee_id": str(employee_id),
        "type": notif_type,
        "title": title,
        "is_read": bool(is_read),
        "created_at": _serialize_date(created_at),
    }


def _alert_row_to_dict(row: Any) -> Dict[str, Any]:
    if isinstance(row, dict):
        alert_id = row.get("alert_id")
        task_id = row.get("task_id")
        project_id = row.get("project_id")
        message = row.get("message")
        alert_type = row.get("alert_type")
        alert_date = row.get("alert_date")
        severity = row.get("severity")
        employee_id = row.get("employee_id")
        if "is_resolved" in row:
            is_resolved = row.get("is_resolved", False)
        else:
            status_value = str(row.get("status") or "").strip().lower()
            is_resolved = bool(row.get("resolved_at")) or status_value in {"resolved", "closed"}
    else:
        (
            alert_id,
            task_id,
            project_id,
            message,
            alert_type,
            alert_date,
            severity,
            employee_id,
            is_resolved,
        ) = row
    return {
        "alert_id": int(alert_id),
        "task_id": int(task_id) if task_id is not None else None,
        "project_id": int(project_id) if project_id is not None else None,
        "message": message,
        "alert_type": alert_type,
        "alert_date": _serialize_date(alert_date),
        "severity": severity,
        "employee_id": str(employee_id) if employee_id is not None else None,
        "is_resolved": bool(is_resolved),
    }


def _send_learning_path_email(
    recipient_email: str, employee_name: str, learning_plan: List[str]
) -> None:
    if not SMTP_HOST or not SMTP_FROM_EMAIL:
        raise HTTPException(status_code=500, detail="SMTP is not configured.")

    steps_html = "".join(f"<li>{step}</li>" for step in learning_plan)
    steps_text = "\n".join(f"{index}. {step}" for index, step in enumerate(learning_plan, start=1))

    msg = EmailMessage()
    msg["Subject"] = "Constella | Your Learning Path"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = recipient_email
    msg.set_content(
        f"Hello {employee_name},\n\n"
        "Your personalized learning path is ready.\n\n"
        f"{steps_text}\n\n"
        "Constella Team"
    )
    msg.add_alternative(
        f"""
        <!doctype html>
        <html>
          <body style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                    <tr>
                      <td style="padding:24px;">
                        <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Constella</p>
                        <h1 style="margin:0 0 12px 0;font-size:24px;color:#111827;">Your Learning Path</h1>
                        <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hello {employee_name}, here is your personalized learning path based on your current skill gaps.</p>
                        <ol style="margin:0;padding-left:20px;color:#111827;line-height:1.7;">{steps_html}</ol>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
        """,
        subtype="html",
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to send learning path email.") from exc


def _insert_notification(cur, employee_id: str, notif_type: str, title: str) -> None:
    cur.execute(
        """
        INSERT INTO notifications (employee_id, type, title)
        VALUES (%s, %s, %s)
        """,
        (employee_id, notif_type, title),
    )


def _build_task_assignment_notification_title(project_name: str, task_name: str) -> str:
    safe_project = (project_name or "Project").strip() or "Project"
    safe_task = (task_name or "Task").strip() or "Task"
    return f"You were assigned to {safe_project}: {safe_task}"


def _generate_learning_path_employees(team_members: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    team_payload = {"team": team_members}
    messages = learning_path_node([HumanMessage(content=json.dumps(team_payload))])
    try:
        learning_payload = json.loads(messages[-1].content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc

    if learning_payload.get("error"):
        raise HTTPException(status_code=400, detail=learning_payload["error"])

    employees = learning_payload.get("employees", [])
    if not employees:
        raise HTTPException(status_code=400, detail="No learning paths were generated.")
    return employees


def _send_generated_learning_paths(cur, employees: List[Dict[str, Any]]) -> Dict[str, Any]:
    sent = []
    skipped = []
    failed = []

    for employee in employees:
        employee_id = str(employee.get("employee_id") or "").strip()
        employee_email = str(employee.get("employee_email") or "").strip()
        employee_name = str(employee.get("employee_name") or "Employee").strip() or "Employee"
        learning_plan = employee.get("learning_plan") or []

        if not employee_id or not learning_plan:
            skipped.append(
                {
                    "employee_id": employee_id,
                    "employee_name": employee_name,
                    "reason": "Missing employee ID or learning plan.",
                }
            )
            continue

        if not employee_email:
            cur.execute(
                "SELECT email, full_name FROM employee WHERE employee_id::text = %s",
                (employee_id,),
            )
            row = cur.fetchone()
            if row:
                employee_email = str(row[0] or "").strip()
                if row[1]:
                    employee_name = str(row[1]).strip() or employee_name

        if not employee_email:
            skipped.append(
                {
                    "employee_id": employee_id,
                    "employee_name": employee_name,
                    "reason": "Employee email not found.",
                }
            )
            continue

        try:
            _send_learning_path_email(employee_email, employee_name, learning_plan)
            _insert_notification(
                cur,
                employee_id,
                "learning_path_sent",
                "Learning path sent to your email",
            )
            sent.append(
                {
                    "employee_id": employee_id,
                    "employee_name": employee_name,
                    "employee_email": employee_email,
                }
            )
        except HTTPException as exc:
            failed.append(
                {
                    "employee_id": employee_id,
                    "employee_name": employee_name,
                    "employee_email": employee_email,
                    "reason": exc.detail,
                }
            )

    return {
        "generated": len(employees),
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "employees": employees,
    }


def _project_row_to_dict(row):
    if not row:
        return None
    (
        project_id,
        name,
        description,
        budget,
        start_date,
        end_date,
        deadline,
        manager_id,
    ) = row
    return {
        "project_id": project_id,
        "name": name,
        "description": description,
        "budget": budget,
        "start_date": _serialize_date(start_date),
        "end_date": _serialize_date(end_date),
        "deadline": _serialize_date(deadline),
        "manager_id": manager_id,
    }


@router.get("")
def list_projects(user=Depends(get_current_user)):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        project_columns = _get_table_columns(cur, "project")
        project_select = _project_select_clause(project_columns)
        cur.execute(
            f"""
            SELECT {project_select}
            FROM project
            WHERE manager_id::text = %s
            ORDER BY project_id DESC
            """,
            (str(manager_id),),
        )
        rows = cur.fetchall()
        project_ids = [row[0] for row in rows]
        tasks_by_project: Dict[int, List[Dict[str, Any]]] = {
            project_id: [] for project_id in project_ids
        }

        tasks_by_id: Dict[int, Dict[str, Any]] = {}
        if project_ids:
            task_columns = _get_table_columns(cur, "task")
            task_name_col = _get_task_name_column(task_columns)
            if "project_id" in task_columns and task_name_col:
                select_cols = [
                    col for col in ("task_id", "project_id") if col in task_columns
                ]
                select_cols.append(f"{task_name_col} AS name")
                select_cols.extend(
                    col
                    for col in (
                        "description",
                        "status",
                        "estimated_hours",
                        "priority",
                        "deadline",
                        "start_days_from_kickoff",
                        "duration_days",
                    )
                    if col in task_columns
                )
                if select_cols:
                    cur.execute(
                        f"""
                        SELECT {", ".join(select_cols)}
                        FROM task
                        WHERE project_id = ANY(%s)
                        ORDER BY task_id
                        """,
                        (project_ids,),
                    )
                    task_rows = cur.fetchall()
                    task_cols = [desc[0] for desc in cur.description]
                    for row in task_rows:
                        task = dict(zip(task_cols, row))
                        if "deadline" in task:
                            task["deadline"] = _serialize_task_value(task["deadline"])
                        task.setdefault("depends_on", [])
                        task.setdefault("skills", [])
                        project_id = task.get("project_id")
                        if project_id in tasks_by_project:
                            tasks_by_project[project_id].append(task)
                        if "task_id" in task and task["task_id"] is not None:
                            tasks_by_id[task["task_id"]] = task

                    task_ids = list(tasks_by_id.keys())
                    if task_ids:
                        task_dependency_columns = _get_table_columns(
                            cur, "task_dependency"
                        )
                        dep_id_cols = [
                            col
                            for col in (
                                "dependent_on_task_id",
                                "depends_on_task_id",
                                "dependency_task_id",
                                "depends_on_id",
                                "dependency_id",
                            )
                            if col in task_dependency_columns
                        ]
                        dep_name_cols = [
                            col
                            for col in ("depends_on_name", "dependency_name")
                            if col in task_dependency_columns
                        ]

                        if task_dependency_columns and "task_id" in task_dependency_columns:
                            select_dep_cols = ["task_id"]
                            if dep_id_cols:
                                select_dep_cols.append(dep_id_cols[0])
                            elif dep_name_cols:
                                select_dep_cols.append(dep_name_cols[0])
                            if len(select_dep_cols) > 1:
                                if "project_id" in task_dependency_columns:
                                    cur.execute(
                                        f"""
                                        SELECT {", ".join(select_dep_cols)}
                                        FROM task_dependency
                                        WHERE project_id = ANY(%s)
                                        """,
                                        (project_ids,),
                                    )
                                else:
                                    cur.execute(
                                        f"""
                                        SELECT {", ".join(select_dep_cols)}
                                        FROM task_dependency
                                        WHERE task_id = ANY(%s)
                                        """,
                                        (task_ids,),
                                    )
                                dep_rows = cur.fetchall()
                                dep_cols = [desc[0] for desc in cur.description]
                                for dep_row in dep_rows:
                                    dep = dict(zip(dep_cols, dep_row))
                                    task_id = dep.get("task_id")
                                    if task_id not in tasks_by_id:
                                        continue
                                    if dep_id_cols and dep_id_cols[0] in dep:
                                        dep_task_id = dep.get(dep_id_cols[0])
                                        dep_task = tasks_by_id.get(dep_task_id)
                                        if dep_task and dep_task.get("name"):
                                            tasks_by_id[task_id]["depends_on"].append(
                                                dep_task["name"]
                                            )
                                    elif dep_name_cols and dep_name_cols[0] in dep:
                                        dep_name = dep.get(dep_name_cols[0])
                                        if dep_name:
                                            tasks_by_id[task_id]["depends_on"].append(
                                                dep_name
                                            )

                        task_skill_columns = _get_table_columns(cur, "task_skill")
                        skill_columns = _get_table_columns(cur, "skill")
                        if (
                            task_skill_columns
                            and "task_id" in task_skill_columns
                            and "skill_id" in task_skill_columns
                            and "skill_id" in skill_columns
                            and "skill_name" in skill_columns
                        ):
                            cur.execute(
                                """
                                SELECT ts.task_id, s.skill_name
                                FROM task_skill ts
                                JOIN skill s ON s.skill_id = ts.skill_id
                                WHERE ts.task_id = ANY(%s)
                                """,
                                (task_ids,),
                            )
                            skill_rows = cur.fetchall()
                            for task_id, skill_name in skill_rows:
                                if task_id in tasks_by_id:
                                    tasks_by_id[task_id]["skills"].append(skill_name)

        team_by_project: Dict[int, Dict[str, Any]] = {}
        if project_ids and tasks_by_id:
            task_name_col = _get_task_name_column(_get_table_columns(cur, "task"))
            employee_task_columns = _get_table_columns(cur, "employee_task")
            employee_task_employee_col = _get_employee_link_column(employee_task_columns)
            assignment_rows = []
            if (
                task_name_col
                and "task_id" in employee_task_columns
                and employee_task_employee_col
            ):
                cur.execute(
                    f"""
                    SELECT t.project_id,
                           e.employee_id,
                           e.full_name,
                           e.email,
                           e.role_id::text AS role,
                           t.task_id,
                           t.{task_name_col}
                    FROM employee_task et
                    JOIN task t ON t.task_id = et.task_id
                    JOIN employee e ON e.employee_id::text = et.{employee_task_employee_col}::text
                    WHERE t.project_id = ANY(%s)
                    ORDER BY t.project_id, e.full_name, t.{task_name_col}
                    """,
                    (project_ids,),
                )
                assignment_rows = cur.fetchall()

            members_map: Dict[int, Dict[str, Dict[str, Any]]] = {}
            assigned_tasks: Dict[int, set] = {}

            for proj_id, emp_id, emp_name, emp_email, emp_role, task_id, task_name in assignment_rows:
                task = tasks_by_id.get(task_id, {})
                start_day = task.get("start_days_from_kickoff") or 0
                duration = _resolve_task_duration(task)
                end_day = start_day + duration
                skills = task.get("skills") or []
                assigned_tasks.setdefault(proj_id, set()).add(task_name)

                project_members = members_map.setdefault(proj_id, {})
                member_entry = project_members.setdefault(
                    str(emp_id),
                    {
                        "employee_id": str(emp_id),
                        "employee_filename": emp_name or "Member",
                        "employee_email": emp_email,
                        "employee_role": emp_role,
                        "assignments": [],
                    },
                )
                member_entry["assignments"].append(
                    {
                        "task_name": task_name,
                        "start_day": int(start_day),
                        "end_day": int(end_day),
                        "skills_match": [],
                        "missing_skills": skills,
                        "semantic_match_score": 0,
                    }
                )

            for proj_id in project_ids:
                if proj_id not in members_map and proj_id not in assigned_tasks:
                    continue
                team_list = list(members_map.get(proj_id, {}).values())
                unassigned = []
                for task in tasks_by_project.get(proj_id, []):
                    task_name = task.get("name")
                    if task_name and task_name not in assigned_tasks.get(proj_id, set()):
                        unassigned.append(task_name)
                team_by_project[proj_id] = {
                    "team": team_list,
                    "unassigned_tasks": unassigned,
                    "num_employees": len(team_list),
                    "rationale": "Loaded from saved assignments.",
                }

        projects: List[Dict[str, Any]] = []
        for row in rows:
            project_dict = _project_row_to_dict(row)
            if project_dict:
                project_id = project_dict.get("project_id")
                project_dict["tasks"] = tasks_by_project.get(project_id, [])
                if project_id in team_by_project:
                    project_dict["team"] = team_by_project[project_id]
                projects.append(project_dict)
        return {"projects": projects}
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


def _load_project_tasks(cur, project_id: int):
    tasks_by_project: Dict[int, List[Dict[str, Any]]] = {project_id: []}
    tasks_by_id: Dict[int, Dict[str, Any]] = {}

    task_columns = _get_table_columns(cur, "task")
    task_name_col = _get_task_name_column(task_columns)
    if "project_id" not in task_columns or not task_name_col:
        return tasks_by_project, tasks_by_id

    select_cols = [
        col for col in ("task_id", "project_id") if col in task_columns
    ]
    select_cols.append(f"{task_name_col} AS name")
    select_cols.extend(
        col
        for col in (
            "description",
            "status",
            "estimated_hours",
            "priority",
            "deadline",
            "start_days_from_kickoff",
            "duration_days",
        )
        if col in task_columns
    )
    if not select_cols:
        return tasks_by_project, tasks_by_id

    cur.execute(
        f"""
        SELECT {", ".join(select_cols)}
        FROM task
        WHERE project_id = %s
        ORDER BY task_id
        """,
        (project_id,),
    )
    task_rows = cur.fetchall()
    task_cols = [desc[0] for desc in cur.description]
    for row in task_rows:
        task = dict(zip(task_cols, row))
        if "deadline" in task:
            task["deadline"] = _serialize_task_value(task["deadline"])
        task.setdefault("depends_on", [])
        task.setdefault("skills", [])
        tasks_by_project[project_id].append(task)
        if "task_id" in task and task["task_id"] is not None:
            tasks_by_id[task["task_id"]] = task

    task_ids = list(tasks_by_id.keys())
    if not task_ids:
        return tasks_by_project, tasks_by_id

    task_dependency_columns = _get_table_columns(cur, "task_dependency")
    dep_id_cols = [
        col
        for col in (
            "dependent_on_task_id",
            "depends_on_task_id",
            "dependency_task_id",
            "depends_on_id",
            "dependency_id",
        )
        if col in task_dependency_columns
    ]
    dep_name_cols = [
        col
        for col in ("depends_on_name", "dependency_name")
        if col in task_dependency_columns
    ]

    if task_dependency_columns and "task_id" in task_dependency_columns:
        select_dep_cols = ["task_id"]
        if dep_id_cols:
            select_dep_cols.append(dep_id_cols[0])
        elif dep_name_cols:
            select_dep_cols.append(dep_name_cols[0])
        if len(select_dep_cols) > 1:
            if "project_id" in task_dependency_columns:
                cur.execute(
                    f"""
                    SELECT {", ".join(select_dep_cols)}
                    FROM task_dependency
                    WHERE project_id = %s
                    """,
                    (project_id,),
                )
            else:
                cur.execute(
                    f"""
                    SELECT {", ".join(select_dep_cols)}
                    FROM task_dependency
                    WHERE task_id = ANY(%s)
                    """,
                    (task_ids,),
                )
            dep_rows = cur.fetchall()
            dep_cols = [desc[0] for desc in cur.description]
            for dep_row in dep_rows:
                dep = dict(zip(dep_cols, dep_row))
                task_id = dep.get("task_id")
                if task_id not in tasks_by_id:
                    continue
                if dep_id_cols and dep_id_cols[0] in dep:
                    dep_task_id = dep.get(dep_id_cols[0])
                    dep_task = tasks_by_id.get(dep_task_id)
                    if dep_task and dep_task.get("name"):
                        tasks_by_id[task_id]["depends_on"].append(dep_task["name"])
                elif dep_name_cols and dep_name_cols[0] in dep:
                    dep_name = dep.get(dep_name_cols[0])
                    if dep_name:
                        tasks_by_id[task_id]["depends_on"].append(dep_name)

    task_skill_columns = _get_table_columns(cur, "task_skill")
    skill_columns = _get_table_columns(cur, "skill")
    if (
        task_skill_columns
        and "task_id" in task_skill_columns
        and "skill_id" in task_skill_columns
        and "skill_id" in skill_columns
        and "skill_name" in skill_columns
    ):
        cur.execute(
            """
            SELECT ts.task_id, s.skill_name
            FROM task_skill ts
            JOIN skill s ON s.skill_id = ts.skill_id
            WHERE ts.task_id = ANY(%s)
            """,
            (task_ids,),
        )
        skill_rows = cur.fetchall()
        for task_id, skill_name in skill_rows:
            if task_id in tasks_by_id:
                tasks_by_id[task_id]["skills"].append(skill_name)

    return tasks_by_project, tasks_by_id


def _load_project_team(cur, project_id: int, tasks_by_project, tasks_by_id):
    members_map: Dict[str, Dict[str, Any]] = {}
    assigned_task_names: set = set()

    if tasks_by_id:
        task_name_col = _get_task_name_column(_get_table_columns(cur, "task"))
        employee_task_columns = _get_table_columns(cur, "employee_task")
        employee_task_employee_col = _get_employee_link_column(employee_task_columns)
        if (
            not task_name_col
            or "task_id" not in employee_task_columns
            or not employee_task_employee_col
        ):
            return {
                "team": [],
                "unassigned_tasks": [],
                "num_employees": 0,
                "rationale": "Loaded from saved assignments.",
            }
        cur.execute(
            f"""
            SELECT t.project_id,
                   e.employee_id,
                   e.full_name,
                   e.email,
                   e.role_id::text AS role,
                   t.task_id,
                   t.{task_name_col}
            FROM employee_task et
            JOIN task t ON t.task_id = et.task_id
            JOIN employee e ON e.employee_id::text = et.{employee_task_employee_col}::text
            WHERE t.project_id = %s
            ORDER BY e.full_name, t.{task_name_col}
            """,
            (project_id,),
        )
        assignment_rows = cur.fetchall()

        for _, emp_id, emp_name, emp_email, emp_role, task_id, task_name in assignment_rows:
            task = tasks_by_id.get(task_id, {})
            start_day = task.get("start_days_from_kickoff") or 0
            duration = _resolve_task_duration(task)
            end_day = start_day + duration
            skills = task.get("skills") or []
            assigned_task_names.add(task_name)

            member_entry = members_map.setdefault(
                str(emp_id),
                {
                    "employee_id": str(emp_id),
                    "employee_filename": emp_name or "Member",
                    "employee_email": emp_email,
                    "employee_role": emp_role,
                    "assignments": [],
                },
            )
            member_entry["assignments"].append(
                {
                    "task_name": task_name,
                    "start_day": int(start_day),
                    "end_day": int(end_day),
                    "skills_match": [],
                    "missing_skills": skills,
                    "semantic_match_score": 0,
                }
            )

    unassigned = []
    for task in tasks_by_project.get(project_id, []):
        task_name = task.get("name")
        if task_name and task_name not in assigned_task_names:
            unassigned.append(task_name)

    team_list = list(members_map.values())
    return {
        "team": team_list,
        "unassigned_tasks": unassigned,
        "num_employees": len(team_list),
        "rationale": "Loaded from saved assignments.",
    }


@router.get("/employees")
def list_employees(user=Depends(get_current_user)):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT employee_id, full_name, email, role_id::text AS role
            FROM employee
            ORDER BY full_name, email
            """
        )
        rows = cur.fetchall()
        employees = [
            {"id": str(emp_id), "name": name, "email": email, "role": role}
            for emp_id, name, email, role in rows
        ]
        return {"employees": employees}
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.get("/{project_id}")
def get_project(
    project_id: int,
    user=Depends(get_current_user),
):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        project_columns = _get_table_columns(cur, "project")
        project_select = _project_select_clause(project_columns)
        cur.execute(
            f"""
            SELECT {project_select}
            FROM project
            WHERE project_id = %s AND manager_id::text = %s
            """,
            (project_id, str(manager_id)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

        project_dict = _project_row_to_dict(row)
        tasks_by_project, tasks_by_id = _load_project_tasks(cur, project_id)
        project_dict["tasks"] = tasks_by_project.get(project_id, [])
        team_payload = _load_project_team(
            cur, project_id, tasks_by_project, tasks_by_id
        )
        if team_payload["team"] or team_payload["unassigned_tasks"]:
            project_dict["team"] = team_payload
        return project_dict
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.get("/{project_id}/team")
def get_project_team(project_id: int, user=Depends(get_current_user)):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        cur.execute(
            "SELECT project_id FROM project WHERE project_id = %s AND manager_id::text = %s",
            (project_id, str(manager_id)),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

        tasks_by_project, tasks_by_id = _load_project_tasks(cur, project_id)
        team_payload = _load_project_team(cur, project_id, tasks_by_project, tasks_by_id)
        return {
            "project_id": project_id,
            **team_payload,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


def _extract_pdf_text(upload: UploadFile) -> str:
    if upload.content_type and upload.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        reader = PdfReader(upload.file)
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        return text.strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"}) from exc


@router.post("/analyze")
async def analyze_project(
    name: str = Form(...),
    description: Optional[str] = Form(None),
    skills: Optional[str] = Form(None),
    project_deadline_days: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    if not name.strip():
        raise HTTPException(status_code=400, detail="Project name is required.")

    pdf_text = ""
    if file:
        pdf_text = _extract_pdf_text(file)
        await file.close()
        if len(pdf_text) > MAX_PDF_CHARS:
            pdf_text = f"{pdf_text[:MAX_PDF_CHARS]}..."

    if not (description and description.strip()) and not pdf_text:
        raise HTTPException(
            status_code=400,
            detail="Provide a description or upload a PDF brief.",
        )

    skill_list = []
    if skills:
        skill_list = [item.strip() for item in skills.split(",") if item.strip()]

    deadline_days = 0
    if project_deadline_days is not None and str(project_deadline_days).strip() != "":
        try:
            deadline_days = max(0, int(project_deadline_days))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="Project duration must be a whole number of days.",
            ) from exc

    parts = [f"Project name: {name.strip()}"]
    if description and description.strip():
        parts.append(f"Description: {description.strip()}")
    if pdf_text:
        parts.append(f"Brief: {pdf_text}")

    payload = {
        "skills": skill_list,
        "description": "\n\n".join(parts),
    }
    if deadline_days > 0:
        payload["project_deadline_days"] = deadline_days

    try:
        messages = project_analyzer_node([HumanMessage(content=json.dumps(payload))])
        analysis_text = messages[-1].content if messages else "{}"
        try:
            analysis = json.loads(analysis_text)
        except Exception:
            analysis = {
                "provided_skills": skill_list,
                "tasks": [],
                "all_skills": [],
                "rationale": "Analysis returned invalid JSON.",
                "raw_response": analysis_text,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc

    return {"project_name": name.strip(), "analysis": analysis}


@router.post("/save")
def save_project(payload: ProjectSaveRequest, user=Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")

    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        project_columns = _get_table_columns(cur, "project")
        project_name_col = _get_project_name_column(project_columns)
        project_budget_col = _get_project_budget_column(project_columns)
        if not project_name_col or "manager_id" not in project_columns:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
        project_select = _project_select_clause(project_columns)
        if payload.project_id:
            update_data: Dict[str, Any] = {project_name_col: name}
            if "description" in project_columns:
                update_data["description"] = (payload.description or "").strip() or None
            if project_budget_col:
                update_data[project_budget_col] = payload.budget
            set_clause = ", ".join(f"{column} = %s" for column in update_data)
            cur.execute(
                f"""
                UPDATE project
                SET {set_clause}
                WHERE project_id = %s AND manager_id::text = %s
                RETURNING {project_select}
                """,
                list(update_data.values()) + [payload.project_id, str(manager_id)],
            )
        else:
            insert_data: Dict[str, Any] = {project_name_col: name}
            if "description" in project_columns:
                insert_data["description"] = (payload.description or "").strip() or None
            if project_budget_col:
                insert_data[project_budget_col] = payload.budget
            if "start_date" in project_columns:
                insert_data["start_date"] = None
            if "end_date" in project_columns:
                insert_data["end_date"] = None
            if "deadline" in project_columns:
                insert_data["deadline"] = None
            insert_data["manager_id"] = manager_id
            insert_columns = list(insert_data)
            placeholders = ", ".join(["%s"] * len(insert_columns))
            cur.execute(
                f"""
                INSERT INTO project ({", ".join(insert_columns)})
                VALUES ({placeholders})
                RETURNING {project_select}
                """,
                [insert_data[column] for column in insert_columns],
            )

        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found.")

        if payload.tasks is not None:
            task_columns = _get_table_columns(cur, "task")
            task_name_col = _get_task_name_column(task_columns)
            if "project_id" not in task_columns or not task_name_col:
                raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

            project_id = row[0]
            project_start = row[4]
            existing_task_ids = []
            if "task_id" in task_columns:
                cur.execute(
                    "SELECT task_id FROM task WHERE project_id = %s",
                    (project_id,),
                )
                existing_task_ids = [r[0] for r in cur.fetchall()]

            task_dependency_columns = _get_table_columns(cur, "task_dependency")
            task_skill_columns = _get_table_columns(cur, "task_skill")

            if existing_task_ids:
                if task_dependency_columns:
                    if "project_id" in task_dependency_columns:
                        cur.execute(
                            "DELETE FROM task_dependency WHERE project_id = %s",
                            (project_id,),
                        )
                    else:
                        dep_id_cols = [
                            col
                            for col in (
                                "dependent_on_task_id",
                                "depends_on_task_id",
                                "dependency_task_id",
                                "depends_on_id",
                                "dependency_id",
                            )
                            if col in task_dependency_columns
                        ]
                        where_parts = []
                        params = []
                        if "task_id" in task_dependency_columns:
                            where_parts.append("task_id = ANY(%s)")
                            params.append(existing_task_ids)
                        if dep_id_cols:
                            where_parts.append(f"{dep_id_cols[0]} = ANY(%s)")
                            params.append(existing_task_ids)
                        if where_parts:
                            cur.execute(
                                f"DELETE FROM task_dependency WHERE {' OR '.join(where_parts)}",
                                params,
                            )

                if task_skill_columns and "task_id" in task_skill_columns:
                    cur.execute(
                        "DELETE FROM task_skill WHERE task_id = ANY(%s)",
                        (existing_task_ids,),
                    )

                employee_task_columns = _get_table_columns(cur, "employee_task")
                if employee_task_columns and "task_id" in employee_task_columns:
                    cur.execute(
                        "DELETE FROM employee_task WHERE task_id = ANY(%s)",
                        (existing_task_ids,),
                    )

            cur.execute("DELETE FROM task WHERE project_id = %s", (project_id,))

            name_to_task_id = {}
            for task in payload.tasks:
                task_deadline = _compute_task_deadline(
                    project_start, task.start_days_from_kickoff, task.duration_days
                )
                estimated_hours = max(1.0, float(task.duration_days) * TASK_HOURS_PER_DAY)
                task_data = {
                    "project_id": project_id,
                    "emp_id": None,
                    "owner_employee_id": None,
                    task_name_col: task.name,
                    "description": (task.description or "").strip() or None,
                    "status": "Not Started",
                    "estimated_hours": estimated_hours,
                    "priority": "Medium",
                    "deadline": task_deadline,
                    "start_date": (
                        project_start + timedelta(days=max(0, int(task.start_days_from_kickoff or 0)))
                        if project_start
                        else None
                    ),
                    "start_days_from_kickoff": task.start_days_from_kickoff,
                    "duration_days": task.duration_days,
                }
                columns = [key for key in task_data if key in task_columns]
                if not columns:
                    continue
                values = [task_data[key] for key in columns]
                placeholders = ", ".join(["%s"] * len(columns))
                column_list = ", ".join(columns)
                if "task_id" in task_columns:
                    cur.execute(
                        f"INSERT INTO task ({column_list}) VALUES ({placeholders}) RETURNING task_id",
                        values,
                    )
                    inserted_id = cur.fetchone()[0]
                    name_to_task_id[task.name] = inserted_id
                else:
                    cur.execute(
                        f"INSERT INTO task ({column_list}) VALUES ({placeholders})",
                        values,
                    )

            if name_to_task_id:
                task_dependency_columns = task_dependency_columns or _get_table_columns(
                    cur, "task_dependency"
                )
                task_skill_columns = task_skill_columns or _get_table_columns(cur, "task_skill")
                skill_columns = _get_table_columns(cur, "skill")

                dep_id_cols = [
                    col
                    for col in (
                        "dependent_on_task_id",
                        "depends_on_task_id",
                        "dependency_task_id",
                        "depends_on_id",
                        "dependency_id",
                    )
                    if col in task_dependency_columns
                ]
                dep_name_cols = [
                    col
                    for col in ("depends_on_name", "dependency_name")
                    if col in task_dependency_columns
                ]

                if task_dependency_columns and "task_id" in task_dependency_columns:
                    for task in payload.tasks:
                        task_id = name_to_task_id.get(task.name)
                        if not task_id:
                            continue
                        depends = [d for d in (task.depends_on or []) if isinstance(d, str)]
                        if not depends:
                            continue
                        for dep_name in depends:
                            dep_data = {"task_id": task_id}
                            if "project_id" in task_dependency_columns:
                                dep_data["project_id"] = project_id
                            if dep_id_cols and dep_name in name_to_task_id:
                                dep_data[dep_id_cols[0]] = name_to_task_id[dep_name]
                            elif dep_name_cols:
                                dep_data[dep_name_cols[0]] = dep_name
                            else:
                                continue
                            dep_columns = [key for key in dep_data if key in task_dependency_columns]
                            dep_values = [dep_data[key] for key in dep_columns]
                            placeholders = ", ".join(["%s"] * len(dep_columns))
                            cur.execute(
                                f"INSERT INTO task_dependency ({', '.join(dep_columns)}) VALUES ({placeholders})",
                                dep_values,
                            )

                if (
                    task_skill_columns
                    and "task_id" in task_skill_columns
                    and "skill_id" in task_skill_columns
                    and "skill_id" in skill_columns
                    and "skill_name" in skill_columns
                ):
                    for task in payload.tasks:
                        task_id = name_to_task_id.get(task.name)
                        if not task_id:
                            continue
                        for skill_name in task.skills or []:
                            if not isinstance(skill_name, str) or not skill_name.strip():
                                continue
                            clean_name = skill_name.strip()
                            cur.execute(
                                "SELECT skill_id FROM skill WHERE skill_name = %s",
                                (clean_name,),
                            )
                            row_skill = cur.fetchone()
                            if row_skill:
                                skill_id = row_skill[0]
                            else:
                                cur.execute(
                                    "INSERT INTO skill (skill_name) VALUES (%s) RETURNING skill_id",
                                    (clean_name,),
                                )
                                skill_id = cur.fetchone()[0]
                            link_data = {"task_id": task_id, "skill_id": skill_id}
                            if "project_id" in task_skill_columns:
                                link_data["project_id"] = project_id
                            link_columns = [key for key in link_data if key in task_skill_columns]
                            link_values = [link_data[key] for key in link_columns]
                            placeholders = ", ".join(["%s"] * len(link_columns))
                            cur.execute(
                                f"INSERT INTO task_skill ({', '.join(link_columns)}) VALUES ({placeholders})",
                                link_values,
                            )

        timeline_status_updates = advance_ready_tasks(cur, project_id=row[0])
        conn.commit()
        try:
            run_deadline_alert_agent(project_id=row[0])
        except Exception:
            pass
        response = _project_row_to_dict(row)
        response["timeline_status_updates"] = timeline_status_updates
        return response
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.post("/start")
def start_project(payload: ProjectStartRequest, user=Depends(get_current_user)):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    start_time = datetime.utcnow()
    deadline = start_time + timedelta(days=payload.duration_days)

    try:
        project_columns = _get_table_columns(cur, "project")
        if "manager_id" not in project_columns:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
        update_data: Dict[str, Any] = {}
        if "start_date" in project_columns:
            update_data["start_date"] = start_time
        if "deadline" in project_columns:
            update_data["deadline"] = deadline
        if "end_date" in project_columns:
            update_data["end_date"] = deadline
        if not update_data:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
        set_clause = ", ".join(f"{column} = %s" for column in update_data)
        cur.execute(
            f"""
            UPDATE project
            SET {set_clause}
            WHERE project_id = %s AND manager_id::text = %s
            RETURNING {_project_select_clause(project_columns)}
            """,
            list(update_data.values()) + [payload.project_id, str(manager_id)],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found.")
        task_deadlines_updated = _refresh_task_deadlines_for_project(
            cur, payload.project_id, start_time
        )
        timeline_status_updates = advance_ready_tasks(cur, project_id=payload.project_id)
        conn.commit()
        try:
            run_deadline_alert_agent(project_id=payload.project_id)
        except Exception:
            pass
        response = _project_row_to_dict(row)
        response["timeline_status_updates"] = timeline_status_updates
        response["task_deadlines_updated"] = task_deadlines_updated
        return response
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.patch("/tasks/{task_id}/status")
def update_task_status(
    task_id: int,
    payload: TaskStatusUpdateRequest,
    user=Depends(get_current_user),
):
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})
    user_id = str(user_id)
    next_status = _normalize_task_status(payload.status)

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        task_columns = _get_table_columns(cur, "task")
        if "task_id" not in task_columns or "status" not in task_columns:
            raise HTTPException(status_code=400, detail="Task status is not supported by the current schema.")

        employee_task_columns = _get_table_columns(cur, "employee_task")
        employee_task_employee_col = _get_employee_link_column(employee_task_columns)
        join_employee_task = (
            "task_id" in employee_task_columns and employee_task_employee_col
        )
        access_parts = ["p.manager_id::text = %s"]
        access_params: List[Any] = [user_id]
        if "owner_employee_id" in task_columns:
            access_parts.append("t.owner_employee_id::text = %s")
            access_params.append(user_id)
        if join_employee_task:
            access_parts.append(f"et.{employee_task_employee_col}::text = %s")
            access_params.append(user_id)

        employee_task_join = (
            "LEFT JOIN employee_task et ON et.task_id = t.task_id"
            if join_employee_task
            else ""
        )
        cur.execute(
            f"""
            SELECT DISTINCT t.project_id
            FROM task t
            JOIN project p ON p.project_id = t.project_id
            {employee_task_join}
            WHERE t.task_id = %s
              AND ({" OR ".join(access_parts)})
            LIMIT 1
            """,
            [task_id] + access_params,
        )
        ownership_row = cur.fetchone()
        if not ownership_row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        project_id = int(ownership_row[0])

        update_data: Dict[str, Any] = {"status": next_status}
        if "status_updated_by" in task_columns:
            update_data["status_updated_by"] = user_id
        elif "status_changed_by" in task_columns:
            update_data["status_changed_by"] = user_id
        elif "updated_by" in task_columns:
            update_data["updated_by"] = user_id

        now = datetime.utcnow()
        if "status_updated_at" in task_columns:
            update_data["status_updated_at"] = now
        elif "status_changed_at" in task_columns:
            update_data["status_changed_at"] = now
        elif "updated_at" in task_columns:
            update_data["updated_at"] = now

        set_clause = ", ".join(f"{column} = %s" for column in update_data)
        values = list(update_data.values())

        task_name_col = _get_task_name_column(task_columns)
        returning_exprs = []
        returning_cols = []
        for col in (
            "task_id",
            "project_id",
            "name",
            "description",
            "status",
            "estimated_hours",
            "priority",
            "deadline",
            "start_days_from_kickoff",
            "duration_days",
        ):
            if col == "name":
                if task_name_col:
                    returning_exprs.append(f"{task_name_col} AS name")
                    returning_cols.append("name")
                continue
            if col in task_columns:
                returning_exprs.append(col)
                returning_cols.append(col)
        cur.execute(
            f"""
            UPDATE task
            SET {set_clause}
            WHERE task_id = %s
            RETURNING {", ".join(returning_exprs)}
            """,
            values + [task_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

        timeline_status_updates = {"activated_task_ids": [], "activated_count": 0}
        if _is_completed_task_status(next_status):
            timeline_status_updates = advance_ready_tasks(cur, project_id=project_id)

        conn.commit()

        try:
            run_deadline_alert_agent(project_id=project_id)
        except Exception:
            pass

        task = dict(zip(returning_cols, row))
        if "deadline" in task:
            task["deadline"] = _serialize_task_value(task["deadline"])
        return {
            "task": task,
            "timeline_status_updates": timeline_status_updates,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.post("/build-team")
def build_team(payload: TeamBuildRequest):
    project_name = payload.project_name.strip()
    if not project_name:
        raise HTTPException(status_code=400, detail="Project name is required.")

    if not payload.analysis:
        raise HTTPException(status_code=400, detail="Project analysis is required.")

    try:
        analysis = ProjectAnalysisOutput(**payload.analysis)
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"}) from exc

    if not analysis.tasks:
        raise HTTPException(status_code=400, detail="Analysis has no tasks to assign.")

    try:
        result = team_builder_node(
            {
                "num_employees": payload.num_employees,
                "project_analysis": analysis.model_dump(),
                "team": {},
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc

    return {
        "project_name": project_name,
        "team": result.get("team", {}),
        "num_employees": payload.num_employees,
    }


@router.post("/save-team")
def save_team(payload: TeamSaveRequest, user=Depends(get_current_user)):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        project_columns = _get_table_columns(cur, "project")
        project_name_col = _get_project_name_column(project_columns)
        if not project_name_col:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
        cur.execute(
            f"""
            SELECT project_id, {project_name_col} AS name
            FROM project
            WHERE project_id = %s AND manager_id::text = %s
            """,
            (payload.project_id, str(manager_id)),
        )
        project_row = cur.fetchone()
        if not project_row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        project_name = str(project_row[1] or "Project").strip() or "Project"

        task_columns = _get_table_columns(cur, "task")
        task_name_col = _get_task_name_column(task_columns)
        if "task_id" not in task_columns or "project_id" not in task_columns or not task_name_col:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

        cur.execute(
            f"SELECT task_id, {task_name_col} AS name FROM task WHERE project_id = %s",
            (payload.project_id,),
        )
        task_rows = cur.fetchall()
        if not task_rows:
            raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"})

        task_map = {row[1]: row[0] for row in task_rows}
        task_name_by_id = {int(row[0]): str(row[1]) for row in task_rows}
        task_ids = [row[0] for row in task_rows]
        employee_task_columns = _get_table_columns(cur, "employee_task")
        employee_task_employee_col = _get_employee_link_column(employee_task_columns)
        if "task_id" not in employee_task_columns or not employee_task_employee_col:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

        cur.execute(
            f"""
            SELECT {employee_task_employee_col}, task_id
            FROM employee_task
            WHERE task_id = ANY(%s)
            """,
            (task_ids,),
        )
        existing_assignments = {
            (str(emp_id), int(task_id))
            for emp_id, task_id in cur.fetchall()
            if emp_id is not None and task_id is not None
        }

        cur.execute("SELECT employee_id, full_name, email FROM employee")
        emp_rows = cur.fetchall()
        valid_emp_ids = set()
        emp_by_name = {}
        emp_by_email = {}
        for emp_id, name, email in emp_rows:
            emp_text = str(emp_id)
            valid_emp_ids.add(emp_text)
            if name:
                key = str(name).strip().lower()
                if key and key not in emp_by_name:
                    emp_by_name[key] = emp_text
            if email:
                key = str(email).strip().lower()
                if key and key not in emp_by_email:
                    emp_by_email[key] = emp_text

        assignments = []
        assignment_keys = set()
        team_emp_ids = set()
        for member in payload.team:
            raw_emp_id = str(member.employee_id or "").strip()
            emp_id = raw_emp_id if raw_emp_id in valid_emp_ids else None
            if not emp_id and member.employee_email:
                emp_id = emp_by_email.get(str(member.employee_email).strip().lower())
            if not emp_id and member.employee_filename:
                emp_id = emp_by_name.get(str(member.employee_filename).strip().lower())
            if not emp_id:
                continue
            team_emp_ids.add(str(emp_id))
            for assignment in member.assignments:
                task_id = task_map.get(assignment.task_name)
                if task_id:
                    key = (str(emp_id), int(task_id))
                    if key in assignment_keys:
                        continue
                    assignment_keys.add(key)
                    assignments.append(key)

        # Clear existing assignments for this project.
        cur.execute(
            "DELETE FROM employee_task WHERE task_id = ANY(%s)",
            (task_ids,),
        )

        if assignments:
            cur.executemany(
                f"""
                INSERT INTO employee_task ({employee_task_employee_col}, task_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                assignments,
            )

        new_assignments = [item for item in assignments if item not in existing_assignments]
        for employee_id, task_id in new_assignments:
            _insert_notification(
                cur,
                employee_id,
                "task_assigned",
                _build_task_assignment_notification_title(
                    project_name=project_name,
                    task_name=task_name_by_id.get(task_id, "Task"),
                ),
            )

        # Persist team members on the project (if a join table exists).
        member_table, emp_col = _find_project_member_table(cur)
        if member_table and emp_col and team_emp_ids:
            cur.execute(
                f"DELETE FROM {member_table} WHERE project_id = %s",
                (payload.project_id,),
            )
            cur.executemany(
                f"INSERT INTO {member_table} (project_id, {emp_col}) VALUES (%s, %s)",
                [(payload.project_id, emp_id) for emp_id in sorted(team_emp_ids)],
            )

        learning_paths: Dict[str, Any] = {
            "generated": 0,
            "sent": [],
            "failed": [],
            "skipped": [],
            "employees": [],
        }
        team_for_learning = [
            {
                "employee_id": member.employee_id,
                "employee_email": member.employee_email,
                "employee_filename": member.employee_filename,
                "assignments": [
                    {
                        "task_name": assignment.task_name,
                        "missing_skills": assignment.missing_skills,
                    }
                    for assignment in member.assignments
                ],
            }
            for member in payload.team
        ]

        if team_for_learning:
            try:
                employees = _generate_learning_path_employees(team_for_learning)
                learning_paths = _send_generated_learning_paths(cur, employees)
            except Exception as exc:
                learning_paths = {
                    "generated": 0,
                    "sent": [],
                    "failed": [],
                    "skipped": [],
                    "employees": [],
                    "error": exc.detail if isinstance(exc, HTTPException) else str(exc),
                }

        conn.commit()
        try:
            run_deadline_alert_agent(project_id=payload.project_id)
        except Exception:
            pass
        return {"saved": len(assignments), "learning_paths": learning_paths}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.post("/send-learning-paths")
def send_learning_paths(
    payload: SendLearningPathsRequest, user=Depends(get_current_user)
):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    if not payload.team:
        raise HTTPException(status_code=400, detail="Team data is required.")

    employees = _generate_learning_path_employees(
        [member.model_dump() for member in payload.team]
    )

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        result = _send_generated_learning_paths(cur, employees)
        conn.commit()
        return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.get("/notifications/me")
def list_my_notifications(user=Depends(get_current_user)):
    if not user.get("id"):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        # Fail soft for inbox reads when the DB pool is temporarily exhausted.
        return {"notifications": []}
    cur = conn.cursor()

    try:
        employee_identifiers = _current_employee_identifiers(cur, user)
        if not employee_identifiers:
            return {"notifications": []}
        cur.execute(
            """
            SELECT id, employee_id, type, title, is_read, created_at
            FROM notifications
            WHERE employee_id::text = ANY(%s)
            ORDER BY created_at DESC, id DESC
            """,
            (employee_identifiers,),
        )
        rows = cur.fetchall()
        return {"notifications": [_notification_row_to_dict(row) for row in rows]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.post("/alerts/run")
def run_my_alerts(payload: AlertRunRequest, user=Depends(get_current_user)):
    manager_id = user.get("id")
    if not manager_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    if payload.project_id is not None:
        conn = get_connection()
        if conn is None:
            raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT project_id FROM project WHERE project_id = %s AND manager_id::text = %s",
                (payload.project_id, str(manager_id)),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        finally:
            cur.close()
            release_connection(conn)

    try:
        return run_deadline_alert_agent(
            project_id=payload.project_id,
            due_soon_days=payload.due_soon_days,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc


@router.get("/alerts/me")
def list_my_alerts(user=Depends(get_current_user)):
    if not user.get("id"):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        # Fail soft for alerts so transient DB pool issues do not break the whole inbox UI.
        return {"alerts": []}
    cur = conn.cursor()

    try:
        alert_columns = _get_table_columns(cur, "alert")
        if not alert_columns:
            return {"alerts": []}

        select_cols = [
            col
            for col in (
                "alert_id",
                "task_id",
                "project_id",
                "message",
                "alert_type",
                "alert_date",
                "severity",
                "employee_id",
                "is_resolved",
                "status",
                "resolved_at",
            )
            if col in alert_columns
        ]
        if not select_cols:
            return {"alerts": []}

        query = f"SELECT {', '.join(select_cols)} FROM alert"
        params: List[Any] = []
        if "employee_id" in alert_columns:
            employee_identifiers = _current_employee_identifiers(cur, user)
            if not employee_identifiers:
                return {"alerts": []}
            query += " WHERE employee_id::text = ANY(%s)"
            params.append(employee_identifiers)
        order_parts = []
        if "is_resolved" in alert_columns:
            order_parts.append("is_resolved ASC")
        if "alert_date" in alert_columns:
            order_parts.append("alert_date DESC")
        if "alert_id" in alert_columns:
            order_parts.append("alert_id DESC")
        if order_parts:
            query += " ORDER BY " + ", ".join(order_parts)

        cur.execute(
            query,
            params,
        )
        rows = cur.fetchall()
        cols = [desc[0] for desc in cur.description]
        serialized = []
        for raw_row in rows:
            row_dict = dict(zip(cols, raw_row))
            row_dict.setdefault("employee_id", None)
            if "is_resolved" not in row_dict:
                status_value = str(row_dict.get("status") or "").strip().lower()
                row_dict["is_resolved"] = bool(row_dict.get("resolved_at")) or status_value in {"resolved", "closed"}
            serialized.append(_alert_row_to_dict(row_dict))
        return {"alerts": serialized}
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.patch("/alerts/resolve")
def resolve_my_alert(payload: AlertResolveRequest, user=Depends(get_current_user)):
    if not user.get("id"):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        alert_columns = _get_table_columns(cur, "alert")
        if not any(column in alert_columns for column in ("is_resolved", "status", "resolved_at")):
            raise HTTPException(status_code=400, detail="Alert resolution is not supported by the current schema.")

        where_parts = ["alert_id = %s"]
        params: List[Any] = [payload.alert_id]
        if "employee_id" in alert_columns:
            employee_identifiers = _current_employee_identifiers(cur, user)
            if not employee_identifiers:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
            where_parts.append("employee_id::text = ANY(%s)")
            params.append(employee_identifiers)

        select_cols = [
            col
            for col in (
                "alert_id",
                "task_id",
                "project_id",
                "message",
                "alert_type",
                "alert_date",
                "severity",
                "employee_id",
                "is_resolved",
                "status",
                "resolved_at",
            )
            if col in alert_columns
        ]
        updates = []
        update_params: List[Any] = []
        if "is_resolved" in alert_columns:
            updates.append("is_resolved = TRUE")
        if "status" in alert_columns:
            updates.append("status = %s")
            update_params.append("resolved")
        if "resolved_at" in alert_columns:
            updates.append("resolved_at = CURRENT_TIMESTAMP")

        cur.execute(
            f"""
            UPDATE alert
            SET {', '.join(updates)}
            WHERE {' AND '.join(where_parts)}
            RETURNING {', '.join(select_cols)}
            """,
            update_params + params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        cols = [desc[0] for desc in cur.description]
        row_dict = dict(zip(cols, row))
        row_dict.setdefault("employee_id", None)
        if "is_resolved" not in row_dict:
            status_value = str(row_dict.get("status") or "").strip().lower()
            row_dict["is_resolved"] = bool(row_dict.get("resolved_at")) or status_value in {"resolved", "closed"}
        conn.commit()
        return {"alert": _alert_row_to_dict(row_dict)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)


@router.patch("/notifications/read")
def mark_notification_read(
    payload: NotificationReadRequest, user=Depends(get_current_user)
):
    if not user.get("id"):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        employee_identifiers = _current_employee_identifiers(cur, user)
        if not employee_identifiers:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        cur.execute(
            """
            UPDATE notifications
            SET is_read = TRUE
            WHERE id = %s AND employee_id::text = ANY(%s)
            RETURNING id, employee_id, type, title, is_read, created_at
            """,
            (payload.notification_id, employee_identifiers),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
        conn.commit()
        return {"notification": _notification_row_to_dict(row)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)
