from __future__ import annotations

from typing import Optional, Any, Dict, List
from datetime import datetime, timedelta
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.common_imports import HumanMessage, PdfReader, json
from app.db import get_connection, release_connection
from app.auth_guard import get_current_user
from app.project_analyzer_node import project_analyzer_node, ProjectAnalysisOutput
from app.team_builder_node import team_builder_node


router = APIRouter(prefix="/projects", tags=["projects"])

MAX_PDF_CHARS = 8000
TASK_HOURS_PER_DAY = int(os.getenv("TASK_HOURS_PER_DAY", "8"))


class TeamBuildRequest(BaseModel):
    project_name: str = Field(..., min_length=1)
    analysis: Dict[str, Any] = Field(default_factory=dict)
    num_employees: int = Field(3, ge=1, le=50)


class TeamAssignmentInput(BaseModel):
    task_name: str = Field(..., min_length=1)


class TeamMemberInput(BaseModel):
    employee_id: Optional[str] = None
    employee_filename: Optional[str] = None
    assignments: List[TeamAssignmentInput] = Field(default_factory=list)


class TeamSaveRequest(BaseModel):
    project_id: int = Field(..., ge=1)
    team: List[TeamMemberInput] = Field(default_factory=list)
    unassigned_tasks: List[str] = Field(default_factory=list)
    num_employees: Optional[int] = None


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


def _find_project_member_table(cur):
    """Find a project-member join table that stores employee IDs."""
    candidate_tables = [
        "project_employee",
        "project_team",
        "project_member",
        "project_stakeholder",
    ]
    employee_columns = ("emp_id", "employee_id", "member_id")
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
        cur.execute(
            """
            SELECT project_id, name, description, budget, start_date, end_date, deadline, manager_id
            FROM project
            WHERE manager_id = %s
            ORDER BY project_id DESC
            """,
            (manager_id,),
        )
        rows = cur.fetchall()
        project_ids = [row[0] for row in rows]
        tasks_by_project: Dict[int, List[Dict[str, Any]]] = {
            project_id: [] for project_id in project_ids
        }

        if project_ids:
            task_columns = _get_table_columns(cur, "task")
            if "project_id" in task_columns and "name" in task_columns:
                select_cols = [
                    col
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
                    )
                    if col in task_columns
                ]
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
                    tasks_by_id: Dict[int, Dict[str, Any]] = {}
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
                            and "name" in skill_columns
                        ):
                            cur.execute(
                                """
                                SELECT ts.task_id, s.name
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

        projects: List[Dict[str, Any]] = []
        for row in rows:
            project_dict = _project_row_to_dict(row)
            if project_dict:
                project_id = project_dict.get("project_id")
                project_dict["tasks"] = tasks_by_project.get(project_id, [])
                projects.append(project_dict)
        return {"projects": projects}
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
        if payload.project_id:
            cur.execute(
                """
                UPDATE project
                SET name = %s,
                    description = %s,
                    budget = %s
                WHERE project_id = %s AND manager_id = %s
                RETURNING project_id, name, description, budget, start_date, end_date, deadline, manager_id
                """,
                (
                    name,
                    (payload.description or "").strip() or None,
                    payload.budget,
                    payload.project_id,
                    manager_id,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO project (name, description, budget, start_date, end_date, deadline, manager_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING project_id, name, description, budget, start_date, end_date, deadline, manager_id
                """,
                (
                    name,
                    (payload.description or "").strip() or None,
                    payload.budget,
                    None,
                    None,
                    None,
                    manager_id,
                ),
            )

        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found.")

        if payload.tasks is not None:
            task_columns = _get_table_columns(cur, "task")
            if "project_id" not in task_columns or "name" not in task_columns:
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
                    "name": task.name,
                    "description": (task.description or "").strip() or None,
                    "status": "Not Started",
                    "estimated_hours": estimated_hours,
                    "priority": "Medium",
                    "deadline": task_deadline,
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
                    and "name" in skill_columns
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
                                "SELECT skill_id FROM skill WHERE name = %s",
                                (clean_name,),
                            )
                            row_skill = cur.fetchone()
                            if row_skill:
                                skill_id = row_skill[0]
                            else:
                                cur.execute(
                                    "INSERT INTO skill (name) VALUES (%s) RETURNING skill_id",
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

        conn.commit()
        return _project_row_to_dict(row)
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
        cur.execute(
            """
            UPDATE project
            SET start_date = %s,
                deadline = %s,
                end_date = %s
            WHERE project_id = %s AND manager_id = %s
            RETURNING project_id, name, description, budget, start_date, end_date, deadline, manager_id
            """,
            (
                start_time,
                deadline,
                deadline,
                payload.project_id,
                manager_id,
            ),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found.")
        conn.commit()
        return _project_row_to_dict(row)
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
        cur.execute(
            "SELECT project_id FROM project WHERE project_id = %s AND manager_id = %s",
            (payload.project_id, manager_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

        cur.execute(
            "SELECT task_id, name FROM task WHERE project_id = %s",
            (payload.project_id,),
        )
        task_rows = cur.fetchall()
        if not task_rows:
            raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"})

        task_map = {row[1]: row[0] for row in task_rows}
        task_ids = [row[0] for row in task_rows]

        cur.execute("SELECT id, name FROM employee")
        emp_rows = cur.fetchall()
        emp_by_name = {}
        for emp_id, name in emp_rows:
            if name:
                key = str(name).strip().lower()
                if key and key not in emp_by_name:
                    emp_by_name[key] = str(emp_id)

        assignments = []
        team_emp_ids = set()
        for member in payload.team:
            emp_id = member.employee_id
            if not emp_id and member.employee_filename:
                emp_id = emp_by_name.get(str(member.employee_filename).strip().lower())
            if not emp_id:
                continue
            team_emp_ids.add(str(emp_id))
            for assignment in member.assignments:
                task_id = task_map.get(assignment.task_name)
                if task_id:
                    assignments.append((str(emp_id), int(task_id)))

        # Clear existing assignments for this project.
        cur.execute(
            "DELETE FROM employee_task WHERE task_id = ANY(%s)",
            (task_ids,),
        )

        if assignments:
            cur.executemany(
                """
                INSERT INTO employee_task (emp_id, task_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                assignments,
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

        conn.commit()
        return {"saved": len(assignments)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"}) from exc
    finally:
        cur.close()
        release_connection(conn)
