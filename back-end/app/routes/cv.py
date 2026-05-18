from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, constr

from app.extractor_with_langgraph import extract_skills_from_bytes
from app.db import get_connection, release_connection
from app.auth_guard import get_current_user

router = APIRouter(prefix="/cv", tags=["CV"])

class SkillSaveRequest(BaseModel):
    skills: Optional[List[constr(min_length=1, max_length=100)]] = None
    skills_by_category: Optional[Dict[str, List[constr(min_length=1, max_length=100)]]] = None


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


def _get_skill_name_column(skill_columns: set[str]) -> str:
    for column in ("skill_name", "name", "title", "label"):
        if column in skill_columns:
            return column
    raise HTTPException(status_code=500, detail="Skill table has no supported name column.")


def _get_skill_category_column(skill_columns: set[str]) -> str | None:
    for column in ("category", "skill_category", "type"):
        if column in skill_columns:
            return column
    return None


def _get_employee_skill_employee_column(employee_skill_columns: set[str]) -> str:
    for column in ("employee_id", "emp_id", "id"):
        if column in employee_skill_columns:
            return column
    raise HTTPException(
        status_code=500,
        detail="Employee skill table has no supported employee id column.",
    )


@router.post("/extract")
async def extract_cv(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    try:
        file_bytes = await file.read()
        result = extract_skills_from_bytes(file_bytes, file.filename)
        summary = result.get("summary", {})

        # Flatten skills from summary into a unique set.
        skill_names = set()
        for key in (
            "core_hard_skills",
            "core_soft_skills",
            "core_tools_and_tech",
            "core_languages",
        ):
            values = summary.get(key, []) or []
            for value in values:
                if isinstance(value, str) and value.strip():
                    skill_names.add(value.strip())

        return {
            "filename": file.filename,
            "skills": sorted(skill_names),
            **result,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"}) from exc

@router.post("/save-skills")
def save_skills(payload: SkillSaveRequest, user=Depends(get_current_user)):
    category_map = {
        "core_hard_skills": "hard_skill",
        "core_soft_skills": "soft_skill",
        "core_tools_and_tech": "tool_tech",
        "core_languages": "language",
    }

    normalized_by_category: Dict[str, List[str]] = {}
    if payload.skills_by_category:
        for key, values in payload.skills_by_category.items():
            category = category_map.get(key)
            if not category:
                continue
            cleaned = [v.strip() for v in (values or []) if isinstance(v, str) and v.strip()]
            if cleaned:
                normalized_by_category[category] = sorted(set(cleaned))

    categorized_lookup: Dict[str, str] = {}
    for category, values in normalized_by_category.items():
        for name in values:
            categorized_lookup[name] = category

    flat_skills = [s.strip() for s in (payload.skills or []) if isinstance(s, str) and s.strip()]
    merged_skills = sorted(set(flat_skills + list(categorized_lookup.keys())))
    skills = merged_skills

    emp_id = user.get("id")
    if not emp_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        skill_columns = _get_table_columns(cur, "skill")
        employee_skill_columns = _get_table_columns(cur, "employee_skill")
        skill_name_col = _get_skill_name_column(skill_columns)
        skill_category_col = _get_skill_category_column(skill_columns)
        employee_skill_employee_col = _get_employee_skill_employee_column(
            employee_skill_columns
        )
        desired_skill_ids = set()
        saved = 0
        for name in sorted(set(skills)):
            select_cols = ["skill_id"]
            if skill_category_col:
                select_cols.append(skill_category_col)
            cur.execute(
                f"SELECT {', '.join(select_cols)} FROM skill WHERE {skill_name_col} = %s",
                (name,),
            )
            row = cur.fetchone()
            if row:
                skill_id = row[0]
                existing_category = row[1] if skill_category_col and len(row) > 1 else None
            else:
                category = categorized_lookup.get(name)
                insert_data = {skill_name_col: name}
                if skill_category_col:
                    insert_data[skill_category_col] = category
                insert_columns = list(insert_data)
                placeholders = ", ".join(["%s"] * len(insert_columns))
                cur.execute(
                    f"""
                    INSERT INTO skill ({", ".join(insert_columns)})
                    VALUES ({placeholders})
                    RETURNING skill_id
                    """,
                    [insert_data[column] for column in insert_columns],
                )
                skill_id = cur.fetchone()[0]
                existing_category = category
            desired_skill_ids.add(skill_id)

            category = categorized_lookup.get(name)
            if skill_category_col and category and category != existing_category:
                cur.execute(
                    f"""
                    UPDATE skill
                    SET {skill_category_col} = %s
                    WHERE skill_id = %s
                    """,
                    (category, skill_id),
                )

            cur.execute(
                f"""
                SELECT 1
                FROM employee_skill
                WHERE {employee_skill_employee_col}::text = %s AND skill_id = %s
                """,
                (emp_id, skill_id),
            )
            if not cur.fetchone():
                cur.execute(
                    f"""
                    INSERT INTO employee_skill ({employee_skill_employee_col}, skill_id)
                    VALUES (%s, %s)
                    """,
                    (emp_id, skill_id),
                )
                saved += 1

        conn.commit()
        return {"saved_skills": saved}
    finally:
        cur.close()
        release_connection(conn)


@router.get("/skill-suggestions")
def skill_suggestions(
    category: str = Query(...),
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(8, ge=1, le=20),
    user=Depends(get_current_user),
):
    allowed_categories = {"hard_skill", "soft_skill", "tool_tech", "language"}
    if category not in allowed_categories:
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"})

    prefix = q.strip()
    if not prefix:
        return {"suggestions": []}

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        skill_columns = _get_table_columns(cur, "skill")
        skill_name_col = _get_skill_name_column(skill_columns)
        skill_category_col = _get_skill_category_column(skill_columns)
        category_filter = f"s.{skill_category_col} = %s AND " if skill_category_col else ""
        params = []
        if skill_category_col:
            params.append(category)
        params.extend([f"{prefix}%", limit])
        cur.execute(
            f"""
            SELECT DISTINCT s.{skill_name_col}
            FROM employee_skill es
            JOIN skill s ON s.skill_id = es.skill_id
            WHERE {category_filter}s.{skill_name_col} ILIKE %s
            ORDER BY s.{skill_name_col}
            LIMIT %s
            """,
            params,
        )
        suggestions = [row[0] for row in cur.fetchall() if row and row[0]]
        return {"suggestions": suggestions}
    finally:
        cur.close()
        release_connection(conn)
