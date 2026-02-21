"""
Team Builder node for LangGraph workflows.
"""

from .common_imports import (
    BaseModel,
    List,
    Dict,
    Any,
    Field,
    TypedDict,
    json,
    RootModel,
    Tuple,
)
from .project_analyzer_node import ProjectAnalysisOutput
from .db import get_connection, release_connection

import numpy as np

# -----------------------------
# 1. DATA SCHEMAS (Pydantic)
# -----------------------------

class EmployeeSkill(BaseModel):
    """Represents the skills of a single employee."""
    employee_id: str | None = None
    name: str | None = None
    filename: str
    summary: Dict[str, List[str]]

class AllEmployeeSkills(RootModel[List[EmployeeSkill]]):
    """Represents a list of all employee skills."""
    pass

class EmployeeAssignment(BaseModel):
    """A single task assigned to an employee."""
    task_name: str
    start_day: int
    end_day: int
    skills_match: List[str]
    missing_skills: List[str]
    semantic_match_score: float = 0.0

class TeamMember(BaseModel):
    """Represents a team member and all their assigned tasks."""
    employee_filename: str
    assignments: List[EmployeeAssignment]

class TeamBuilderOutput(BaseModel):
    """The final output of the team builder node."""
    team: List[TeamMember]
    unassigned_tasks: List[str]
    rationale: str

class TeamBuilderState(TypedDict, total=False):
    """The state for the team builder graph."""
    num_employees: int
    project_analysis: Dict[str, Any]
    employee_skills: List[Dict[str, Any]]
    team: Dict[str, Any]


# -----------------------------
# 2. HELPER FUNCTIONS
# -----------------------------
from app.skill_matching import initialize_db


def load_employee_skills_from_db() -> List[EmployeeSkill]:
    """Fetch employee skills from the database and normalize to EmployeeSkill models."""
    conn = get_connection()
    if conn is None:
        raise RuntimeError("Database connection not available.")

    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT e.id, e.name, s.name
            FROM employee e
            LEFT JOIN employee_skill es ON e.id = es.emp_id
            LEFT JOIN skill s ON es.skill_id = s.skill_id
            ORDER BY e.name, e.email
            """
        )
        rows = cur.fetchall()
    finally:
        cur.close()
        release_connection(conn)

    employees: Dict[str, Dict[str, Any]] = {}
    for emp_id, name, skill_name in rows:
        key = str(emp_id)
        display_name = (name or "Employee").strip() or "Employee"
        entry = employees.setdefault(
            key,
            {
                "employee_id": key,
                "name": display_name,
                "filename": display_name,
                "summary": {"skills": []},
            },
        )
        if skill_name:
            entry["summary"]["skills"].append(skill_name)

    return [EmployeeSkill(**payload) for payload in employees.values()]


def is_employee_available(schedule: List[Tuple[int, int]], task_start: int, task_duration: int) -> bool:
    """Checks if an employee is available for a task."""
    task_end = task_start + task_duration
    for busy_start, busy_end in schedule:
        if task_start < busy_end and task_end > busy_start:
            return False  # Overlap
    return True

# -----------------------------
# 3. TEAM BUILDER NODE
# -----------------------------

def team_builder_node(state: TeamBuilderState) -> Dict[str, Any]:
    """
    Analyzes project requirements and available employee skills to form the best possible team.
    This version uses a more advanced matching algorithm that finds the best subset of
    employee skills for each task.
    """
    print("--- NODE: TEAM BUILDER ---")
    project_analysis_file = "project_analysis.json"
    output_filename = "team_composition.json"
    num_employees = state.get("num_employees", 3)
    MIN_SEMANTIC_SCORE_THRESHOLD = 0.2 
    SKILL_SIMILARITY_THRESHOLD = 0.5

    # --- Initialize Embedding Function ---
    try:
        _, embedding_function = initialize_db(model_name="all-mpnet-base-v2")
        print("✅ Initialized embedding function.")
    except Exception as e:
        print(f"❌ Error initializing embedding function: {e}")
        return {"team": {"team": [], "unassigned_tasks": [], "rationale": f"Failed to initialize embedding function: {e}"}}

    # --- Load and Validate Inputs ---
    try:
        if state.get("project_analysis"):
            project_payload = state["project_analysis"]
            if isinstance(project_payload, ProjectAnalysisOutput):
                project_analysis = project_payload
            else:
                project_analysis = ProjectAnalysisOutput(**project_payload)
        else:
            with open(project_analysis_file, "r", encoding="utf-8") as f:
                project_data = json.load(f)
            project_analysis = ProjectAnalysisOutput(**project_data)
        project_tasks = project_analysis.tasks
        print("✅ Loaded and validated project analysis")
    except (FileNotFoundError, json.JSONDecodeError, Exception) as e:
        print(f"❌ Error loading or validating project analysis: {e}")
        return {"team": {"team": [], "unassigned_tasks": [], "rationale": f"Failed to load project analysis: {e}"}}

    try:
        if state.get("employee_skills"):
            employee_payload = state["employee_skills"]
            employee_skills_data = AllEmployeeSkills.model_validate(employee_payload).root
        else:
            employee_skills_data = load_employee_skills_from_db()
        print("✅ Loaded and validated employee skills")
    except Exception as e:
        print(f"❌ Error loading or validating employee skills: {e}")
        return {"team": {"team": [], "unassigned_tasks": [], "rationale": f"Failed to load employee skills: {e}"}}

    # --- 1. Prepare Employee Data ---
    employees: Dict[str, Dict[str, Any]] = {}
    for index, emp in enumerate(employee_skills_data):
        key = emp.employee_id or f"emp-{index}"
        display_name = (emp.name or emp.filename or "Employee").strip() or "Employee"
        employees[key] = {
            "display_name": display_name,
            "skills": list(
                set(
                    skill.lower()
                    for category in emp.summary.values()
                    for skill in category
                    if category
                )
            ),
            "schedule": [],
        }

    # --- 2. Sort tasks by start day ---
    sorted_tasks = sorted(project_tasks, key=lambda t: t.start_days_from_kickoff)
    
    # --- 3. Assign tasks using the new scoring logic ---
    assignments: Dict[str, List[EmployeeAssignment]] = {emp_id: [] for emp_id in employees}
    unassigned_tasks = []
    current_team_members = set()

    for task in sorted_tasks:
        task_skills = [skill.lower() for skill in task.skills if skill]
        if not task_skills:
            unassigned_tasks.append(task.name)
            continue

        task_start = task.start_days_from_kickoff
        task_duration = task.duration_days
        
        candidate_scores = []
        
        # --- Iterate through all employees to find the best candidate ---
        for emp_id, emp_data in employees.items():
            emp_skills_list = emp_data["skills"]
            
            if not emp_skills_list:
                candidate_scores.append({"employee_id": emp_id, "match_score": 0})
                continue

            # --- New scoring logic: Average of best matches for each task skill ---
            task_skill_embeddings = np.array(embedding_function(task_skills))
            emp_skill_embeddings = np.array(embedding_function(emp_skills_list))

            # Normalize embeddings
            task_skill_norms = np.linalg.norm(task_skill_embeddings, axis=1, keepdims=True)
            emp_skill_norms = np.linalg.norm(emp_skill_embeddings, axis=1, keepdims=True)
            task_skill_embeddings = np.divide(task_skill_embeddings, task_skill_norms, where=task_skill_norms != 0)
            emp_skill_embeddings = np.divide(emp_skill_embeddings, emp_skill_norms, where=emp_skill_norms != 0)

            # Cosine similarity matrix
            similarity_matrix = np.dot(task_skill_embeddings, emp_skill_embeddings.T)
            similarity_matrix = np.clip(similarity_matrix, -1.0, 1.0)

            # For each task skill, find the highest similarity score among employee skills
            max_sim_scores_per_task_skill = np.max(similarity_matrix, axis=1)
            
            # The final score is the average of these best matches
            average_score = np.mean(max_sim_scores_per_task_skill)
            candidate_scores.append({"employee_id": emp_id, "match_score": average_score})

        # --- Sort candidates by the new match score ---
        # Sort by match_score (descending) and then employee_id (descending) to ensure determinism
        sorted_candidates = sorted(candidate_scores, key=lambda x: (x["match_score"], x["employee_id"]), reverse=True)

        assigned = False
        for candidate in sorted_candidates:
            emp_id = candidate["employee_id"]
            match_score = candidate["match_score"]

            if match_score < MIN_SEMANTIC_SCORE_THRESHOLD:
                continue

            if not is_employee_available(employees[emp_id]["schedule"], task_start, task_duration):
                continue
            
            is_in_team = emp_id in current_team_members
            can_add_to_team = len(current_team_members) < num_employees

            if is_in_team or can_add_to_team:
                task_end = task_start + task_duration
                employees[emp_id]["schedule"].append((task_start, task_end))
                current_team_members.add(emp_id)
                
                emp_skills_list = employees[emp_id]["skills"]
                emp_skills_set = set(emp_skills_list)
                task_skills_set = set(task_skills)

                # --- Skill matching logic remains for final output ---
                direct_matches = emp_skills_set.intersection(task_skills_set)
                semantically_matched_skills = set()
                remaining_task_skills = list(task_skills_set - direct_matches)

                if remaining_task_skills and emp_skills_list:
                    # We've already calculated the similarity matrix, let's reuse it
                    # Find indices of remaining and employee skills
                    remaining_indices = [task_skills.index(s) for s in remaining_task_skills]
                    
                    # Use the sub-matrix for remaining skills
                    sub_similarity_matrix = similarity_matrix[remaining_indices, :]
                    max_sim_scores = np.max(sub_similarity_matrix, axis=1)
                    
                    for i, skill in enumerate(remaining_task_skills):
                        if max_sim_scores[i] >= SKILL_SIMILARITY_THRESHOLD:
                            semantically_matched_skills.add(skill)

                skills_match = list(direct_matches.union(semantically_matched_skills))
                missing_skills = list(task_skills_set - set(skills_match))

                assignment = EmployeeAssignment(
                    task_name=task.name,
                    start_day=task_start,
                    end_day=task_end,
                    skills_match=skills_match,
                    missing_skills=missing_skills,
                    semantic_match_score=match_score
                )
                assignments[emp_id].append(assignment)
                assigned = True
                break

        if not assigned:
            unassigned_tasks.append(task.name)
    # --- 4. Format the output ---
    team_members = [
        TeamMember(
            employee_filename=employees[emp_id]["display_name"],
            assignments=emp_assignments,
        )
        for emp_id, emp_assignments in assignments.items()
        if emp_assignments
    ]
    
    # --- 5. Validate and Save Output ---
    try:
        rationale = (
            f"Requested a team of {num_employees}. Formed a team of {len(team_members)} "
            f"based on semantic skill matching and availability. "
            f"{len(unassigned_tasks)} tasks could not be assigned."
        )
        team_composition = TeamBuilderOutput(
            team=team_members,
            unassigned_tasks=unassigned_tasks,
            rationale=rationale,
        )
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(team_composition.model_dump(round_trip=True), f, indent=2)
        print(f"✅ Team composition saved to {output_filename}")
        
    except Exception as e:
        error_payload = {"team": [], "unassigned_tasks": [t.name for t in project_tasks], "rationale": f"Validation failed for team output: {e}"}
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(error_payload, f, indent=2)
        print(f"❌ Error saving team composition. Details saved to {output_filename}")
        return {"team": error_payload}

    return {"team": team_composition.model_dump()}
