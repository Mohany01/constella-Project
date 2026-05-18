"""Learning path node that turns team-builder skill gaps into per-employee plans."""

from __future__ import annotations

from typing import Any, Dict

from langchain_core.messages import SystemMessage
from langgraph.prebuilt import create_react_agent
from pydantic import ValidationError

from .common_imports import (
    AIMessage,
    BaseMessage,
    BaseModel,
    Field,
    HumanMessage,
    List,
    RootModel,
    json,
    load_env,
    make_llm,
    os,
)

load_env()


class EmployeeGapInput(BaseModel):
    employee_id: str
    employee_email: str | None = None
    employee_name: str
    skill_gaps: List[str] = Field(default_factory=list)


class EmployeePlan(BaseModel):
    employee_id: str
    employee_email: str | None = None
    employee_name: str
    learning_plan: List[str]


class LearningPlanOutput(BaseModel):
    employees: List[EmployeePlan]


class TeamAssignmentInput(BaseModel):
    missing_skills: List[str] = Field(default_factory=list)


class TeamMemberInput(BaseModel):
    employee_id: str
    employee_email: str | None = None
    employee_filename: str | None = None
    assignments: List[TeamAssignmentInput] = Field(default_factory=list)


class TeamBuilderPayload(BaseModel):
    team: List[TeamMemberInput] = Field(default_factory=list)


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


def _dedupe_keep_order(values: List[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for value in values:
        cleaned = str(value).strip()
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        ordered.append(cleaned)
    return ordered


def parse_team_gaps_from_state(state: List[BaseMessage]) -> List[Dict[str, Any]]:
    """Parse team-builder output from a HumanMessage and aggregate gaps per employee."""
    for msg in state:
        if not isinstance(msg, HumanMessage):
            continue
        try:
            payload = TeamBuilderPayload(**json.loads(extract_json_string(msg.content)))
        except (json.JSONDecodeError, ValidationError, TypeError):
            continue

        employees: List[Dict[str, Any]] = []
        for member in payload.team:
            all_gaps: List[str] = []
            for assignment in member.assignments:
                all_gaps.extend(assignment.missing_skills)

            skill_gaps = _dedupe_keep_order(all_gaps)
            if not skill_gaps:
                continue

            employees.append(
                EmployeeGapInput(
                    employee_id=str(member.employee_id),
                    employee_email=member.employee_email,
                    employee_name=(member.employee_filename or "Employee").strip()
                    or "Employee",
                    skill_gaps=skill_gaps,
                ).model_dump()
            )
        return employees
    return []


def build_employee_prompt(employees: List[Dict[str, Any]]) -> str:
    lines = [
        "Create a learning plan for each employee based on their missing skills.",
        "Recommend concise, practical steps and include resource links when useful.",
    ]
    for emp in employees:
        lines.append(f"- Employee ID: {emp['employee_id']}")
        lines.append(f"  Name: {emp['employee_name']}")
        lines.append(f"  Missing Skills: {', '.join(emp['skill_gaps'])}")
    return "\n".join(lines)


def _build_agent():
    tools = []
    if os.getenv("USE_TAVILY", "1") == "1":
        try:
            from langchain_community.tools import TavilySearchResults

            tools = [TavilySearchResults(max_results=1)]
        except Exception:
            tools = []
    return create_react_agent(model=make_llm(), tools=tools)


SYSTEM_PROMPT = """
You generate structured JSON learning paths for employees.

Rules:
1. Return valid JSON only.
2. Do not include markdown or commentary.
3. Follow this schema exactly:
{
  "employees": [
    {
      "employee_id": "string",
      "employee_email": "string or null",
      "employee_name": "string",
      "learning_plan": ["string", "string", "string"]
    }
  ]
}
4. Each employee must have 4 to 7 actionable steps.
5. Tailor the steps to the listed missing skills.
6. Include short direct resource links when useful.
"""


def learning_path_node(state: List[BaseMessage]) -> List[BaseMessage]:
    """LangGraph-style node that returns one JSON message of employee learning paths."""
    employees = parse_team_gaps_from_state(state)
    if not employees:
        return [
            AIMessage(
                content=json.dumps(
                    {
                        "employees": [],
                        "error": "No employee skill gaps found in team builder output.",
                    }
                )
            )
        ]

    agent = _build_agent()
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=build_employee_prompt(employees)),
    ]
    result = agent.invoke({"messages": messages})
    raw = result["messages"][-1].content
    json_text = extract_json_string(raw)

    try:
        parsed = json.loads(json_text)
        validated = LearningPlanOutput(**parsed)
        json_text = validated.model_dump_json(indent=2)
    except Exception as exc:
        json_text = json.dumps(
            {"employees": [], "error": f"Validation failed: {exc}", "raw_response": raw}
        )

    return [AIMessage(content=json_text)]
