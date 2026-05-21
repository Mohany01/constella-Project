import {
  TASK_STATUS,
  clampProgress,
  getProjectMembers,
  getTaskAssignees,
  normalizeTaskStatus,
  statusToDatabaseValue,
} from "./permissions";

function createStableTaskId(project, task, index) {
  const parts = [
    project?.project_id || project?.id || "project",
    task?.id || task?.task_id || task?.name || task?.title || index,
  ];
  return parts.join(":");
}

function getDisplayName(entry, fallback = "User") {
  if (!entry || typeof entry !== "object") return fallback;
  return (
    entry.name ||
    entry.full_name ||
    entry.employee_filename ||
    entry.email ||
    entry.employee_email ||
    fallback
  );
}

function getMemberIdentity(entry, fallbackIndex = 0) {
  if (!entry || typeof entry !== "object") {
    return {
      id: `member-${fallbackIndex}`,
      name: "User",
      email: "",
    };
  }

  const id =
    entry.id ??
    entry.user_id ??
    entry.userId ??
    entry.employee_id ??
    entry.employeeId ??
    entry.email ??
    entry.employee_email ??
    `member-${fallbackIndex}`;

  return {
    id: String(id),
    name: getDisplayName(entry),
    email: entry.email || entry.employee_email || "",
    role: entry.role || entry.employee_role || "",
  };
}

function buildProjectMemberDirectory(project) {
  const members = [];
  const directory = new Map();

  getProjectMembers(project)
    .map((member, index) => getMemberIdentity(member, index))
    .forEach((member) => {
      const primaryKey = String(member.id || member.email || member.name || "")
        .trim()
        .toLowerCase();
      if (primaryKey && directory.has(primaryKey)) {
        return;
      }
      members.push(member);
      [member.id, member.email, member.name].forEach((value) => {
        const key = String(value || "").trim().toLowerCase();
        if (key && !directory.has(key)) {
          directory.set(key, member);
        }
      });
    });

  members.forEach((member) => {
    [member.id, member.email, member.name].forEach((value) => {
      const key = String(value || "").trim().toLowerCase();
      if (key && !directory.has(key)) {
        directory.set(key, member);
      }
    });
  });

  return {
    members,
    directory,
  };
}

function getTag(task) {
  if (task?.category) return task.category;
  if (task?.tag) return task.tag;
  if (Array.isArray(task?.skills) && task.skills.length > 0) {
    return task.skills[0];
  }
  return "General";
}

function resolveProjectName(project, task) {
  const projectName =
    task?.project?.name ||
    task?.project_name ||
    project?.name ||
    project?.project_name;
  return String(projectName || "").trim() || "No Project";
}

function normalizeAssignees(task, project) {
  const { directory } = buildProjectMemberDirectory(project);
  const seen = new Set();

  return getTaskAssignees(task, project)
    .map((entry, index) => {
      if (typeof entry === "string" || typeof entry === "number") {
        const key = String(entry).trim().toLowerCase();
        const matched = directory.get(key);
        return matched || { id: String(entry), name: String(entry), email: "" };
      }
      return getMemberIdentity(entry, index);
    })
    .filter((entry) => {
      const key = String(entry?.id || entry?.email || entry?.name || "")
        .trim()
        .toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function extractTasksFromProject(project = {}) {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];

  return tasks.map((task, index) => {
    const status = normalizeTaskStatus(task?.status);
    const assignees = normalizeAssignees(task, project);
    const title = task?.title || task?.name || `Task ${index + 1}`;

    return {
      id: createStableTaskId(project, task, index),
      rawTaskId: task?.id ?? task?.task_id ?? null,
      projectId: String(project?.project_id ?? project?.id ?? ""),
      projectName: resolveProjectName(project, task),
      projectDescription: project?.description || "",
      title,
      projectTaskName: task?.name || title,
      description: task?.description || "",
      status,
      tag: getTag(task),
      progress: clampProgress(task?.progress, status),
      assignees,
      assigneeIds: assignees.map((item) => item.id),
      rawTask: task,
      taskIndex: index,
      project,
    };
  });
}

export function buildBoardTasks(projects = []) {
  return (Array.isArray(projects) ? projects : []).flatMap((project) =>
    extractTasksFromProject(project)
  );
}

export function serializeTaskForSave(task, existingTask = {}) {
  const status = normalizeTaskStatus(task?.status);
  const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
  const primaryAssignee = assignees[0] || null;

  return {
    ...existingTask,
    id: existingTask?.id ?? task?.rawTaskId ?? task?.id,
    name: task?.projectTaskName || task?.title || existingTask?.name || "Untitled task",
    title: task?.title || task?.projectTaskName || existingTask?.title || "Untitled task",
    description: task?.description || "",
    depends_on: Array.isArray(existingTask?.depends_on)
      ? existingTask.depends_on
      : [],
    skills: Array.isArray(existingTask?.skills) ? existingTask.skills : [],
    start_days_from_kickoff: existingTask?.start_days_from_kickoff ?? 0,
    duration_days: existingTask?.duration_days ?? 1,
    status: statusToDatabaseValue(status),
    category: task?.tag || existingTask?.category || "General",
    tag: task?.tag || existingTask?.tag || "General",
    progress: clampProgress(task?.progress, status),
    assignedTo: primaryAssignee?.id || null,
    assigned_to: primaryAssignee?.id || null,
    assigneeIds: assignees.map((item) => item.id),
    memberIds: assignees.map((item) => item.id),
    assignees: assignees.map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
    })),
  };
}

export function replaceProjectTask(project, nextTask) {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  const existingTask = tasks[nextTask.taskIndex] || null;
  const serialized = serializeTaskForSave(nextTask, existingTask || {});
  const nextTasks = [...tasks];

  if (existingTask) {
    nextTasks[nextTask.taskIndex] = serialized;
  } else {
    nextTasks.push(serialized);
  }

  return {
    ...project,
    tasks: nextTasks,
  };
}

export function removeProjectTask(project, taskToRemove) {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  return {
    ...project,
    tasks: tasks.filter((_, index) => index !== taskToRemove.taskIndex),
  };
}

export function addProjectTask(project, taskDraft) {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  return {
    ...project,
    tasks: [...tasks, serializeTaskForSave(taskDraft)],
  };
}

export function getProjectMemberOptions(project) {
  return buildProjectMemberDirectory(project).members;
}

export function buildTeamPayloadFromTasks(project, nextTasks = []) {
  const existingTeam = Array.isArray(project?.team?.team) ? project.team.team : [];
  const tasksByName = new Map(
    nextTasks.map((task) => [task.projectTaskName || task.title, task])
  );

  const team = existingTeam.map((member, index) => {
    const normalizedMember = getMemberIdentity(member, index);
    const memberAssignments = [];

    tasksByName.forEach((task) => {
      if (!task.assigneeIds.includes(normalizedMember.id)) return;

      const currentAssignments = Array.isArray(member?.assignments)
        ? member.assignments
        : [];
      const existingAssignment = currentAssignments.find(
        (assignment) =>
          String(assignment?.task_name || "") ===
          String(task.projectTaskName || task.title)
      );

      memberAssignments.push(
        existingAssignment || {
          task_name: task.projectTaskName || task.title,
          start_day: task.rawTask?.start_days_from_kickoff ?? 0,
          end_day:
            (task.rawTask?.start_days_from_kickoff ?? 0) +
            Math.max(1, Number.parseInt(task.rawTask?.duration_days, 10) || 1),
          skills_match: [],
          missing_skills: [],
          semantic_match_score: 0,
        }
      );
    });

    return {
      ...member,
      assignments: memberAssignments,
    };
  });

  return {
    team,
    unassigned_tasks: nextTasks
      .filter((task) => task.assigneeIds.length === 0)
      .map((task) => task.projectTaskName || task.title),
    num_employees: project?.team?.num_employees ?? team.length,
    rationale: project?.team?.rationale || "",
  };
}

export function inferTaskStatusFromProgress(progress) {
  const safeProgress = clampProgress(progress, TASK_STATUS.TODO);
  if (safeProgress >= 100) return TASK_STATUS.DONE;
  if (safeProgress >= 75) return TASK_STATUS.REVIEW;
  if (safeProgress >= 35) return TASK_STATUS.IN_PROGRESS;
  return TASK_STATUS.TODO;
}
