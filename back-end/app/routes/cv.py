from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, constr

from app.extractor_with_langgraph import extract_skills_from_bytes
from app.db import get_connection, release_connection
from app.auth_guard import get_current_user

router = APIRouter(prefix="/cv", tags=["CV"])

class SkillSaveRequest(BaseModel):
    skills: List[constr(min_length=1, max_length=100)]


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
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/save-skills")
def save_skills(payload: SkillSaveRequest, user=Depends(get_current_user)):
    skills = [s.strip() for s in payload.skills if s and s.strip()]
    if not skills:
        return {"saved_skills": 0}

    emp_id = user.get("id")
    if not emp_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available.")
    cur = conn.cursor()

    try:
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

            cur.execute(
                "SELECT 1 FROM employee_skill WHERE emp_id = %s AND skill_id = %s",
                (emp_id, skill_id),
            )
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO employee_skill (emp_id, skill_id) VALUES (%s, %s)",
                    (emp_id, skill_id),
                )
                saved += 1

        conn.commit()
        return {"saved_skills": saved}
    finally:
        cur.close()
        release_connection(conn)
