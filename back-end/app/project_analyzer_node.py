"""Project analyzer node built with LangGraph-compatible patterns."""

# -----------------------------
# 1. CONFIG & SETUP
# -----------------------------
from .common_imports import (
    Any,
    AIMessage,
    BaseMessage,
    BaseModel,
    Field,
    HumanMessage,
    List,
    os,
    Tuple,
    json,
    load_env,
    make_llm,
    validator,
)

import tkinter as tk
from tkinter import filedialog

from pypdf import PdfReader
# Load environment variables (API keys, etc.)
load_env()

# Initialize ChatGroq (shared instance, zero temperature for determinism)
llm = make_llm()


def select_pdf_file():
    """Opens a file dialog to select a PDF file."""
    root = tk.Tk()
    root.withdraw()  # Hide the main window
    file_path = filedialog.askopenfilename(
        title="Select a PDF file",
        filetypes=[("PDF files", "*.pdf")]
    )
    return file_path


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extracts text from a PDF file."""
    try:
        reader = PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        return text
    except Exception as e:
        print(f"Error reading PDF: {e}")
        return ""


class ProjectInput(BaseModel):
    """Structured representation of the project query passed in by the user."""

    skills: List[str] = Field(default_factory=list, description="Initial skills the user believes are needed")
    description: str = Field("", description="Freeform project description")

    @validator("skills", pre=True, always=True)
    def _coerce_skills(cls, value):
        if not value:
            return []
        if isinstance(value, list):
            return [str(s).strip() for s in value if str(s).strip()]
        if isinstance(value, str):
            return [s.strip() for s in value.split(",") if s.strip()]
        return []


class ProjectTask(BaseModel):
    """Single decomposed task with dependencies and required skills."""

    name: str
    description: str = ""
    depends_on: List[str] = Field(default_factory=list, description="Task names this task depends on")
    skills: List[str] = Field(default_factory=list, description="Skills/tools required for this task")
    start_days_from_kickoff: int = Field(
        0, description="Estimated start offset in days from project kickoff"
    )
    duration_days: int = Field(
        1, description="Estimated duration in days for the task once started"
    )


from .skills_graph import create_skills_graph, get_skill_relatives
class ProjectAnalysisOutput(BaseModel):
    """LLM output schema for the project analyzer."""

    provided_skills: List[str] = Field(default_factory=list)
    tasks: List[ProjectTask] = Field(default_factory=list)
    all_skills: List[str] = Field(
        default_factory=list,
        description="A comprehensive list of all skills including expanded skills from the graph."
    )
    rationale: str = Field("", description="Short explanation of why these skills are needed")


def extract_json_string(content: Any) -> str:
    """Extract JSON string from plain text or markdown fences."""
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = ""
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text += block.get("text", "")
            elif isinstance(block, str):
                text += block
    else:
        text = str(content)

    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 1)[1]
        if "```" in text:
            text = text.split("```", 1)[0]
    if text.lower().startswith("json"):
        text = text[4:]
    return text.strip()


def parse_project_from_state(state: List[BaseMessage]) -> Tuple[List[str], str]:
    """Pull provided skills and description from the first HumanMessage."""

    for msg in state:
        if not isinstance(msg, HumanMessage):
            continue

        # Try JSON payload first
        try:
            payload = json.loads(extract_json_string(msg.content))
            parsed = ProjectInput(**payload)
            return parsed.skills, parsed.description
        except Exception:
            pass

        # Try heuristic: lines starting with "Skills:" and "Description:".
        text = str(msg.content)
        skills = []
        description = text
        for line in text.splitlines():
            if line.lower().startswith("skills:"):
                skills_str = line.split(":", 1)[1]
                skills = [s.strip() for s in skills_str.split(",") if s.strip()]
            if line.lower().startswith("description:"):
                description = line.split(":", 1)[1].strip()

        if skills or description:
            return skills, description

    return [], ""


def project_analyzer_node(state: List[BaseMessage]) -> List[BaseMessage]:
    """LangGraph node that returns an AIMessage with a skills analysis JSON."""

    provided_skills, description = parse_project_from_state(state)

    prompt = f"""
You are a project skill analyst.

Given a project description and an initial list of skills, produce a task breakdown with dependencies and per-task skills. Return JSON only.

Project description:
{description or "(none provided)"}

Initial skills (may be empty): {', '.join(provided_skills) if provided_skills else '(none)'}

Rules:
- Output valid JSON matching this schema exactly:
{{
  "provided_skills": ["string", ...],
  "tasks": [
    {{
      "name": "string",
      "description": "string",
      "depends_on": ["string", ...],
      "skills": ["string", ...],
      "start_days_from_kickoff": 0,
      "duration_days": 0
    }}
  ],
  "all_skills": [],
  "rationale": "string"
}}
- Break the project into 6–12 concrete tasks with clear sequencing; `depends_on` should reference other task names (use [] for the first tasks).
- Each task's `skills` should list only the skills/tools specific to that task (no sentences).
- Provide rough timing: `start_days_from_kickoff` as an integer offset (0 for day one), and `duration_days` as how long the task takes once started.
- Keep skills concise (skill or tool names only, no sentences).
- `rationale` should be 1-2 sentences explaining why these skills are needed.
"""

    response = llm.invoke(prompt)
    raw = response.content
    json_text = extract_json_string(raw)
    output_filename = "project_analysis.json"

    try:
        parsed = json.loads(json_text)
        validated = ProjectAnalysisOutput(**parsed)

        # --- Skill Expansion ---
        skills_graph = create_skills_graph()
        all_skills = set(validated.provided_skills)
        for task in validated.tasks:
            for skill in task.skills:
                all_skills.add(skill.lower())

        expanded_skills = set(all_skills)
        for skill in all_skills:
            parents, children = get_skill_relatives(skills_graph, skill)
            if parents:
                for p in parents:
                    expanded_skills.add(p)
            if children:
                for c in children:
                    expanded_skills.add(c)
        
        validated.all_skills = sorted(list(expanded_skills))
        # --- End Skill Expansion ---

        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(validated.model_dump(), f, indent=2)
        print(f"✅ Project analysis saved to {output_filename}")
        json_text = validated.model_dump_json(indent=2)
    except Exception as e:
        error_payload = {
            "provided_skills": provided_skills,
            "tasks": [],
            "all_skills": [],
            "rationale": f"Validation failed: {e}",
            "raw_response": raw,
        }
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(error_payload, f, indent=2)
        print(f"❌ Error in project analysis. Details saved to {output_filename}")
        json_text = json.dumps(error_payload, indent=2)


    return [AIMessage(content=json_text)]



