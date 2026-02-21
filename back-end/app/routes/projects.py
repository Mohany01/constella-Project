from __future__ import annotations

from typing import Optional, Any, Dict

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.common_imports import HumanMessage, PdfReader, json
from app.project_analyzer_node import project_analyzer_node, ProjectAnalysisOutput
from app.team_builder_node import team_builder_node


router = APIRouter(prefix="/projects", tags=["projects"])

MAX_PDF_CHARS = 8000


class TeamBuildRequest(BaseModel):
    project_name: str = Field(..., min_length=1)
    analysis: Dict[str, Any] = Field(default_factory=dict)
    num_employees: int = Field(3, ge=1, le=50)


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
        raise HTTPException(status_code=400, detail=f"Unable to read PDF: {exc}") from exc


@router.post("/analyze")
async def analyze_project(
    name: str = Form(...),
    description: Optional[str] = Form(None),
    skills: Optional[str] = Form(None),
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

    parts = [f"Project name: {name.strip()}"]
    if description and description.strip():
        parts.append(f"Description: {description.strip()}")
    if pdf_text:
        parts.append(f"Brief: {pdf_text}")

    payload = {
        "skills": skill_list,
        "description": "\n\n".join(parts),
    }

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
        raise HTTPException(status_code=500, detail=f"Analyzer failed: {exc}") from exc

    return {"project_name": name.strip(), "analysis": analysis}


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
        raise HTTPException(status_code=400, detail=f"Invalid analysis payload: {exc}") from exc

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
        raise HTTPException(status_code=500, detail=f"Team builder failed: {exc}") from exc

    return {
        "project_name": project_name,
        "team": result.get("team", {}),
        "num_employees": payload.num_employees,
    }
