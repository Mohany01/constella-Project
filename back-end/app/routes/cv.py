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
        desired_skill_ids = set()
        saved = 0
        for name in sorted(set(skills)):
            cur.execute("SELECT skill_id FROM skill WHERE name = %s", (name,))
            row = cur.fetchone()
            if row:
                skill_id = row[0]
            else:
                cur.execute(
                    "INSERT INTO skill (name) VALUES (%s) RETURNING skill_id",
                    (name,),
                )
                skill_id = cur.fetchone()[0]
            desired_skill_ids.add(skill_id)

            cur.execute(
                "SELECT 1 FROM employee_skill WHERE emp_id = %s AND skill_id = %s",
                (emp_id, skill_id),
            )
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO employee_skill (emp_id, skill_id, category) VALUES (%s, %s, %s)",
                    (emp_id, skill_id, categorized_lookup.get(name)),
                )
                saved += 1
            else:
                category = categorized_lookup.get(name)
                if category:
                    cur.execute(
                        """
                        UPDATE employee_skill
                        SET category = %s
                        WHERE emp_id = %s AND skill_id = %s
                          AND (category IS NULL OR category::text <> %s)
                        """,
                        (category, emp_id, skill_id, category),
                    )

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
        cur.execute(
            """
            SELECT DISTINCT s.name
            FROM employee_skill es
            JOIN skill s ON s.skill_id = es.skill_id
            WHERE es.category::text = %s
              AND s.name ILIKE %s
            ORDER BY s.name
            LIMIT %s
            """,
            (category, f"{prefix}%", limit),
        )
        suggestions = [row[0] for row in cur.fetchall() if row and row[0]]
        return {"suggestions": suggestions}
    finally:
        cur.close()
        release_connection(conn)
