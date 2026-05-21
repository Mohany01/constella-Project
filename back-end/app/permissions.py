from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import Depends, HTTPException, status

from app.auth_guard import get_current_user
from app.db import get_connection, release_connection

PROJECT_MANAGER_ROLE_ALIASES = {
    "project manager",
    "project_manager",
    "projectmanager",
    "pm",
}


def get_table_columns(cur, table_name: str) -> Set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row[0] for row in cur.fetchall()}


def get_employee_link_column(columns: Set[str]) -> Optional[str]:
    for column in ("employee_id", "emp_id", "member_id", "owner_employee_id"):
        if column in columns:
            return column
    return None


def find_project_member_table(cur) -> Tuple[Optional[str], Optional[str]]:
    candidate_tables = [
        "project_employee",
        "project_team",
        "project_member",
        "project_stakeholder",
    ]
    for table in candidate_tables:
        columns = get_table_columns(cur, table)
        if not columns or "project_id" not in columns:
            continue
        employee_column = get_employee_link_column(columns)
        if employee_column:
            return table, employee_column
    return None, None


def _normalize_role_name(value: Any) -> str:
    return str(value or "").strip()


def get_role_name_select_expression(cur) -> str:
    employee_columns = get_table_columns(cur, "employee")
    role_columns = get_table_columns(cur, "role")

    if "role" in employee_columns:
        return "COALESCE(NULLIF(BTRIM(e.role::text), ''), '')"

    if "role_id" in employee_columns and "role_id" in role_columns and "role_name" in role_columns:
        return """
        COALESCE(
            NULLIF(BTRIM(r.role_name::text), ''),
            NULLIF(BTRIM(e.role_id::text), ''),
            ''
        )
        """

    if "role_id" in employee_columns:
        return "COALESCE(NULLIF(BTRIM(e.role_id::text), ''), '')"

    return "''"


def fetch_current_employee(cur, user: Dict[str, Any]) -> Dict[str, Any]:
    user_id = str(user.get("id") or "").strip()
    email = str(user.get("email") or "").strip()
    if not user_id and not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED"},
        )

    employee_columns = get_table_columns(cur, "employee")
    if not employee_columns:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

    role_columns = get_table_columns(cur, "role")
    role_join = ""
    if "role_id" in employee_columns and "role_id" in role_columns:
        role_join = "LEFT JOIN role r ON r.role_id = e.role_id"

    role_expression = get_role_name_select_expression(cur)
    role_id_expression = (
        "e.role_id::text AS role_id"
        if "role_id" in employee_columns
        else "NULL::text AS role_id"
    )
    department_expression = (
        "e.department_id::text AS department_id"
        if "department_id" in employee_columns
        else "NULL::text AS department_id"
    )
    manager_expression = (
        "e.manager_id::text AS manager_id"
        if "manager_id" in employee_columns
        else "NULL::text AS manager_id"
    )

    where_parts: List[str] = []
    params: List[Any] = []
    if user_id and "employee_id" in employee_columns:
        where_parts.append("e.employee_id::text = %s")
        params.append(user_id)
    if email and "email" in employee_columns:
        where_parts.append("LOWER(TRIM(e.email)) = LOWER(TRIM(%s))")
        params.append(email)

    if not where_parts:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

    cur.execute(
        f"""
        SELECT
            e.employee_id::text AS employee_id,
            e.full_name,
            e.email,
            {role_expression} AS role,
            {role_id_expression},
            {department_expression},
            {manager_expression}
        FROM employee e
        {role_join}
        WHERE {" OR ".join(where_parts)}
        LIMIT 1
        """,
        params,
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED"},
        )

    return {
        "id": str(row[0]),
        "employee_id": str(row[0]),
        "name": row[1] or "",
        "email": row[2] or "",
        "role": _normalize_role_name(row[3]),
        "role_id": str(row[4]) if row[4] is not None else "",
        "department_id": str(row[5]) if row[5] is not None else "",
        "manager_id": str(row[6]) if row[6] is not None else "",
    }


def get_current_employee(user=Depends(get_current_user)) -> Dict[str, Any]:
    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()
    try:
        return fetch_current_employee(cur, user)
    finally:
        cur.close()
        release_connection(conn)


def is_project_manager(employee: Dict[str, Any]) -> bool:
    role_name = _normalize_role_name(employee.get("role")).lower().replace("-", " ")
    role_name = " ".join(role_name.split())
    return role_name in PROJECT_MANAGER_ROLE_ALIASES


def require_project_manager(
    employee: Dict[str, Any] = Depends(get_current_employee),
) -> Dict[str, Any]:
    if not is_project_manager(employee):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN"},
        )
    return employee


def get_employee_identifiers(employee: Dict[str, Any]) -> List[str]:
    identifiers: List[str] = []
    for value in (
        employee.get("employee_id"),
        employee.get("id"),
        employee.get("email"),
    ):
        text = str(value or "").strip()
        if text and text not in identifiers:
            identifiers.append(text)
    return identifiers


def _get_owned_project_ids(cur, employee: Dict[str, Any]) -> Set[int]:
    project_columns = get_table_columns(cur, "project")
    if "project_id" not in project_columns or "manager_id" not in project_columns:
        return set()

    employee_id = str(employee.get("employee_id") or employee.get("id") or "").strip()
    if not employee_id:
        return set()

    cur.execute(
        """
        SELECT project_id
        FROM project
        WHERE manager_id::text = %s
        """,
        (employee_id,),
    )
    return {int(row[0]) for row in cur.fetchall() if row[0] is not None}


def get_accessible_project_ids(cur, employee: Dict[str, Any]) -> Set[int]:
    if is_project_manager(employee):
        return _get_owned_project_ids(cur, employee)

    employee_id = str(employee.get("employee_id") or employee.get("id") or "").strip()
    if not employee_id:
        return set()

    project_ids: Set[int] = set()

    member_table, member_employee_col = find_project_member_table(cur)
    if member_table and member_employee_col:
        cur.execute(
            f"""
            SELECT DISTINCT project_id
            FROM {member_table}
            WHERE {member_employee_col}::text = %s
            """,
            (employee_id,),
        )
        project_ids.update(int(row[0]) for row in cur.fetchall() if row[0] is not None)

    task_columns = get_table_columns(cur, "task")
    if "project_id" in task_columns and "owner_employee_id" in task_columns:
        cur.execute(
            """
            SELECT DISTINCT project_id
            FROM task
            WHERE owner_employee_id::text = %s
            """,
            (employee_id,),
        )
        project_ids.update(int(row[0]) for row in cur.fetchall() if row[0] is not None)

    employee_task_columns = get_table_columns(cur, "employee_task")
    employee_task_employee_col = get_employee_link_column(employee_task_columns)
    if "task_id" in employee_task_columns and employee_task_employee_col:
        cur.execute(
            f"""
            SELECT DISTINCT t.project_id
            FROM employee_task et
            JOIN task t ON t.task_id = et.task_id
            WHERE et.{employee_task_employee_col}::text = %s
            """,
            (employee_id,),
        )
        project_ids.update(int(row[0]) for row in cur.fetchall() if row[0] is not None)

    return project_ids


def can_view_project(cur, employee: Dict[str, Any], project_id: int) -> bool:
    return int(project_id) in get_accessible_project_ids(cur, employee)


def can_view_project_team(cur, employee: Dict[str, Any], project_id: int) -> bool:
    return can_view_project(cur, employee, project_id)


def can_manage_project(employee: Dict[str, Any], project: Optional[Dict[str, Any]] = None) -> bool:
    return is_project_manager(employee)


def can_manage_task(employee: Dict[str, Any], task: Optional[Dict[str, Any]] = None) -> bool:
    return is_project_manager(employee)


def can_view_task_record(employee: Dict[str, Any], task: Optional[Dict[str, Any]]) -> bool:
    if not task:
        return False
    employee_id = str(employee.get("employee_id") or employee.get("id") or "").strip()
    if not employee_id:
        return False

    if is_project_manager(employee):
        project_manager_id = str(
            task.get("project_manager_id")
            or task.get("manager_id")
            or task.get("project_manager")
            or ""
        ).strip()
        return bool(project_manager_id and project_manager_id == employee_id)

    owner_id = str(task.get("owner_employee_id") or "").strip()
    if owner_id and owner_id == employee_id:
        return True

    assignee_ids = []
    for field in ("assigneeIds", "memberIds"):
        values = task.get(field)
        if isinstance(values, list):
            assignee_ids.extend(str(value).strip() for value in values if value is not None)
    for field in ("assigned_to", "assignedTo"):
        value = task.get(field)
        if value is not None:
            assignee_ids.append(str(value).strip())

    return employee_id in {value for value in assignee_ids if value}


def can_view_task(cur, employee: Dict[str, Any], task_id: int) -> bool:
    employee_id = str(employee.get("employee_id") or employee.get("id") or "").strip()
    if not employee_id:
        return False

    if is_project_manager(employee):
        project_columns = get_table_columns(cur, "project")
        if "manager_id" not in project_columns:
            return False
        cur.execute(
            """
            SELECT 1
            FROM task t
            JOIN project p ON p.project_id = t.project_id
            WHERE t.task_id = %s
              AND p.manager_id::text = %s
            LIMIT 1
            """,
            (task_id, employee_id),
        )
        return cur.fetchone() is not None

    task_columns = get_table_columns(cur, "task")
    employee_task_columns = get_table_columns(cur, "employee_task")
    employee_task_employee_col = get_employee_link_column(employee_task_columns)

    access_parts: List[str] = []
    params: List[Any] = []
    if "owner_employee_id" in task_columns:
        access_parts.append("t.owner_employee_id::text = %s")
        params.append(employee_id)
    if "task_id" in employee_task_columns and employee_task_employee_col:
        access_parts.append(f"et.{employee_task_employee_col}::text = %s")
        params.append(employee_id)

    if not access_parts:
        return False

    join_clause = (
        "LEFT JOIN employee_task et ON et.task_id = t.task_id"
        if "task_id" in employee_task_columns and employee_task_employee_col
        else ""
    )

    cur.execute(
        f"""
        SELECT 1
        FROM task t
        {join_clause}
        WHERE t.task_id = %s
          AND ({" OR ".join(access_parts)})
        LIMIT 1
        """,
        [task_id] + params,
    )
    return cur.fetchone() is not None


def can_move_task(cur, employee: Dict[str, Any], task_id: int) -> bool:
    return can_view_task(cur, employee, task_id)


def ensure_project_access(cur, employee: Dict[str, Any], project_id: int) -> None:
    cur.execute("SELECT 1 FROM project WHERE project_id = %s LIMIT 1", (project_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"})
    if not can_view_project(cur, employee, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})


def ensure_project_team_access(cur, employee: Dict[str, Any], project_id: int) -> None:
    cur.execute("SELECT 1 FROM project WHERE project_id = %s LIMIT 1", (project_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"})
    if not can_view_project_team(cur, employee, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})


def ensure_project_management_access(
    cur,
    employee: Dict[str, Any],
    project_id: Optional[int] = None,
) -> None:
    if not can_manage_project(employee):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})
    if project_id is None:
        return
    cur.execute("SELECT 1 FROM project WHERE project_id = %s LIMIT 1", (project_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"})
    if int(project_id) not in get_accessible_project_ids(cur, employee):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})


def ensure_task_view_access(cur, employee: Dict[str, Any], task_id: int) -> None:
    cur.execute("SELECT 1 FROM task WHERE task_id = %s LIMIT 1", (task_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"})
    if not can_view_task(cur, employee, task_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})


def ensure_task_move_access(cur, employee: Dict[str, Any], task_id: int) -> None:
    cur.execute("SELECT 1 FROM task WHERE task_id = %s LIMIT 1", (task_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"})
    if not can_move_task(cur, employee, task_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})
