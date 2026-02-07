"""CV skill extractor pipeline built with LangGraph."""

from __future__ import annotations

from io import BytesIO
from typing import Any, List, TypedDict, cast
import json
import os

from .common_imports import (
    BaseModel,
    ChatPromptTemplate,
    Document,
    END,
    Field,
    List as TList,
    PdfReader,
    StateGraph,
    TypedDict as TTypedDict,
    cast as tcast,
    json as cjson,
    load_env,
    make_llm,
)

# Load environment variables (API keys, etc.)
load_env()

# Initialize ChatGroq (shared instance, zero temperature for determinism)
llm = make_llm()


# -----------------------------
# 2. DATA SCHEMAS (Pydantic)
# -----------------------------

class SkillsExtraction(BaseModel):
    """Schema for detailed skills extraction."""

    hard_skills: TList[str] = Field(
        description="Functional capabilities (e.g., Supply Chain Management, Data Analysis, System Design)."
    )
    soft_skills: TList[str] = Field(
        description="Interpersonal traits (e.g., Leadership, Collaboration). Ignore generic fluff."
    )
    tools_and_tech: TList[str] = Field(
        description=(
            "Specific software, hardware, AND programming languages (e.g., Python, Odoo, Excel, AWS)."
        )
    )
    languages: TList[str] = Field(
        description="Spoken/Human languages only (e.g., English, Arabic, German)."
    )


class SkillsSummary(BaseModel):
    """Schema for the final summarized skills."""

    core_hard_skills: TList[str] = Field(
        description="Top 15 most important functional skills (High-level domains)."
    )
    core_soft_skills: TList[str] = Field(
        description="Top 8 distinct, high-impact soft skills."
    )
    core_tools_and_tech: TList[str] = Field(
        description="Top 15 critical tools, frameworks, and programming languages."
    )
    core_languages: TList[str] = Field(
        description="All spoken human languages found."
    )


# -----------------------------
# 3. GRAPH STATE
# -----------------------------

class GraphState(TTypedDict):
    cv_text: str
    initial_skills: dict
    refined_skills: dict
    final_summary: dict


# -----------------------------
# 4. NODES (With Specialized Prompts)
# -----------------------------

def extraction_node(state: GraphState):
    cv_text = state["cv_text"]

    system_msg = """You are an expert ATS (Applicant Tracking System). Extract skills from the CV with strict categorization:

1. **Hard Skills (Domains/Capabilities):** Abstract professional abilities.
   - Example: "Supply Chain Management", "Data Analysis", "Web Development", "Accounting".
   - DO NOT put specific tools here.

2. **Tools & Tech (Software/Languages):** Specific instruments used to perform the work.
   - Include: Programming Languages (Python, Java), Software (Odoo, Excel), Frameworks (React, TensorFlow).
   - Normalize names: "Microsoft Excel" -> "Excel", "React.js" -> "React".

3. **Soft Skills:** High-value interpersonal traits.
   - Example: "Leadership", "Collaboration", "Crisis Management".
   - IGNORE fluff like "Hard worker", "Motivated", "Fast learner".

4. **Languages:** Human spoken languages only (English, Arabic).

Return valid JSON."""

    prompt = ChatPromptTemplate.from_messages([("system", system_msg), ("human", "{cv_text}")])

    chain = prompt | llm.with_structured_output(SkillsExtraction)
    result = chain.invoke({"cv_text": cv_text})

    return {"initial_skills": dict(result) if not isinstance(result, dict) else result}


def reflection_node(state: GraphState):
    cv_text = state["cv_text"]
    initial_skills = state["initial_skills"]

    system_msg = """You are a QA Auditor for CV data. Review the extracted skills:

1. **Clean & Standardize:** - Merge "Machine Learning" and "ML" -> "Machine Learning".
   - Ensure "Python" is in Tools, not Hard Skills.
   - Ensure "Data Analysis" is in Hard Skills, not Tools.

2. **Remove Noise:**
   - Delete generic soft skills (e.g., "Punctual").
   - Delete job titles or company names if they were mistakenly extracted.

3. **Check Missing:** - If the CV mentions "Django", ensure "Python" is also added if missing.
   - If the CV mentions "Inventory Control", ensure "Inventory Management" is present.
"""

    prompt = ChatPromptTemplate.from_messages(
        [("system", system_msg), ("human", "Original CV Text:\n{cv_text}\n\nInitial JSON:\n{initial_json}")]
    )

    chain = prompt | llm.with_structured_output(SkillsExtraction)

    result = chain.invoke(
        {
            "cv_text": cv_text,
            "initial_json": cjson.dumps(initial_skills, ensure_ascii=False),
        }
    )

    return {"refined_skills": dict(result) if not isinstance(result, dict) else result}


def summary_node(state: GraphState):
    refined_skills = state["refined_skills"]

    system_msg = """Final Summarization Task:
1. Select the top **Core** skills that define this candidate's professional identity.
2. Prioritize skills that appear most relevant to their most recent roles.
3. Limit counts:
   - Max 15 Core Hard Skills
   - Max 15 Core Tools/Tech
   - Max 8 Core Soft Skills
4. Ensure strictly clean output (no duplicates).
"""

    prompt = ChatPromptTemplate.from_messages(
        [("system", system_msg), ("human", "Refined Skills:\n{skills_json}")]
    )

    chain = prompt | llm.with_structured_output(SkillsSummary)

    result = chain.invoke({"skills_json": cjson.dumps(refined_skills, ensure_ascii=False)})

    return {"final_summary": dict(result) if not isinstance(result, dict) else result}


# -----------------------------
# 5. BUILD THE GRAPH
# -----------------------------

workflow = StateGraph(GraphState)

workflow.add_node("extract", extraction_node)
workflow.add_node("reflect", reflection_node)
workflow.add_node("summarize", summary_node)

workflow.set_entry_point("extract")
workflow.add_edge("extract", "reflect")
workflow.add_edge("reflect", "summarize")
workflow.add_edge("summarize", END)

app = workflow.compile()


# -----------------------------
# 6. FILE HELPERS & API ENTRY
# -----------------------------

def _load_cv_text_from_bytes(file_bytes: bytes, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        reader = PdfReader(BytesIO(file_bytes))
        return "\n".join([page.extract_text() or "" for page in reader.pages])
    if ext in (".docx", ".doc"):
        doc = Document(BytesIO(file_bytes))
        return "\n".join([p.text for p in doc.paragraphs])
    if ext == ".txt":
        return file_bytes.decode("utf-8", errors="ignore")
    raise RuntimeError("Unsupported file type. Use PDF, DOCX, or TXT.")


def extract_skills_from_bytes(file_bytes: bytes, filename: str) -> dict:
    cv_text = _load_cv_text_from_bytes(file_bytes, filename)
    if not cv_text.strip():
        raise RuntimeError("Could not extract text from the uploaded file.")

    initial_state: GraphState = {"cv_text": cv_text}  # type: ignore
    final_state = cast(dict, app.invoke(initial_state))
    return {
        "summary": final_state.get("final_summary", {}),
        "initial_extraction": final_state.get("initial_skills", {}),
        "refined_extraction": final_state.get("refined_skills", {}),
    }
