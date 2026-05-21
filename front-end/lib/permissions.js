import { USER_ROLES, normalizeRole } from "./auth";

export const TASK_STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  DONE: "done",
};

export const TASK_STATUS_META = [
  { id: TASK_STATUS.TODO, title: "To Do", accent: "purple" },
  { id: TASK_STATUS.IN_PROGRESS, title: "In Progress", accent: "blue" },
  { id: TASK_STATUS.REVIEW, title: "Review", accent: "orange" },
  { id: TASK_STATUS.DONE, title: "Done", accent: "green" },
];

const TASK_STATUS_ALIASES = new Map([
  ["", TASK_STATUS.TODO],
  ["todo", TASK_STATUS.TODO],
  ["to do", TASK_STATUS.TODO],
  ["to_do", TASK_STATUS.TODO],
  ["not_started", TASK_STATUS.TODO],
  ["not started", TASK_STATUS.TODO],
  ["pending", TASK_STATUS.TODO],
  ["new", TASK_STATUS.TODO],
  ["progress", TASK_STATUS.IN_PROGRESS],
  ["inprogress", TASK_STATUS.IN_PROGRESS],
  ["in progress", TASK_STATUS.IN_PROGRESS],
  ["in_progress", TASK_STATUS.IN_PROGRESS],
  ["doing", TASK_STATUS.IN_PROGRESS],
  ["review", TASK_STATUS.REVIEW],
  ["in review", TASK_STATUS.REVIEW],
  ["qa", TASK_STATUS.REVIEW],
  ["blocked", TASK_STATUS.REVIEW],
  ["done", TASK_STATUS.DONE],
  ["completed", TASK_STATUS.DONE],
  ["complete", TASK_STATUS.DONE],
]);

function pushMemberValue(set, value) {
  if (value === null || value === undefined) return;
  const cleaned = String(value).trim().toLowerCase();
  if (cleaned) {
    set.add(cleaned);
  }
}

function collectMemberKeys(set, entry) {
  if (!entry) return set;

  if (Array.isArray(entry)) {
    entry.forEach((item) => collectMemberKeys(set, item));
    return set;
  }

  if (typeof entry === "string" || typeof entry === "number") {
    pushMemberValue(set, entry);
    return set;
  }

  if (typeof entry !== "object") return set;

  [
    entry.id,
    entry.user_id,
    entry.userId,
    entry.employee_id,
    entry.employeeId,
    entry.email,
    entry.user_email,
    entry.employee_email,
    entry.name,
    entry.full_name,
    entry.fullName,
    entry.username,
    entry.assigned_to,
    entry.assignedTo,
  ].forEach((value) => pushMemberValue(set, value));

  if (Array.isArray(entry.memberIds)) {
    entry.memberIds.forEach((value) => pushMemberValue(set, value));
  }

  if (Array.isArray(entry.assigneeIds)) {
    entry.assigneeIds.forEach((value) => pushMemberValue(set, value));
  }

  if (Array.isArray(entry.assignees)) {
    entry.assignees.forEach((value) => collectMemberKeys(set, value));
  }

  if (Array.isArray(entry.members)) {
    entry.members.forEach((value) => collectMemberKeys(set, value));
  }

  return set;
}

export function normalizeTaskStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return TASK_STATUS_ALIASES.get(normalized) || TASK_STATUS.TODO;
}

export function statusToDatabaseValue(column) {
  switch (normalizeTaskStatus(column)) {
    case TASK_STATUS.IN_PROGRESS:
      return "In Progress";
    case TASK_STATUS.REVIEW:
      return "Review";
    case TASK_STATUS.DONE:
      return "completed";
    case TASK_STATUS.TODO:
    default:
      return "Not Started";
  }
}

export function clampProgress(value, status = TASK_STATUS.TODO) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(100, parsed));
  }

  if (status === TASK_STATUS.DONE) return 100;
  if (status === TASK_STATUS.REVIEW) return 80;
  if (status === TASK_STATUS.IN_PROGRESS) return 55;
  return 10;
}

export function getUserAccessKeys(user) {
  const keys = new Set();
  collectMemberKeys(keys, user);
  return keys;
}

export function getProjectMembers(project) {
  const members = [];

  if (Array.isArray(project?.assignedUsers)) {
    members.push(...project.assignedUsers);
  }
  if (Array.isArray(project?.members)) {
    members.push(...project.members);
  }
  if (Array.isArray(project?.projectMembers)) {
    members.push(...project.projectMembers);
  }
  if (Array.isArray(project?.employees)) {
    members.push(...project.employees);
  }
  if (Array.isArray(project?.teamMembers)) {
    members.push(...project.teamMembers);
  }
  if (Array.isArray(project?.assignedEmployees)) {
    members.push(...project.assignedEmployees);
  }
  if (Array.isArray(project?.users)) {
    members.push(...project.users);
  }
  if (Array.isArray(project?.team?.team)) {
    members.push(...project.team.team);
  }

  return members;
}

export function getTaskAssignees(task = {}, project = null) {
  const assignees = [];

  if (Array.isArray(task.assignees)) assignees.push(...task.assignees);
  if (Array.isArray(task.members)) assignees.push(...task.members);
  if (Array.isArray(task.assigneeIds)) assignees.push(...task.assigneeIds);
  if (Array.isArray(task.memberIds)) assignees.push(...task.memberIds);
  if (task.assignedTo) assignees.push(task.assignedTo);
  if (task.assigned_to) assignees.push(task.assigned_to);
  if (task.user_id) assignees.push(task.user_id);
  if (task.employee_id) assignees.push(task.employee_id);

  if (
    project?.team?.team &&
    (task?.name || task?.title || task?.task_name || task?.projectTaskName)
  ) {
    const taskName = String(
      task.name || task.title || task.task_name || task.projectTaskName
    );
    project.team.team.forEach((member) => {
      const assignments = Array.isArray(member?.assignments)
        ? member.assignments
        : [];
      if (
        assignments.some(
          (assignment) => String(assignment?.task_name || "") === taskName
        )
      ) {
        assignees.push(member);
      }
    });
  }

  return assignees;
}

function doesUserMatchEntries(user, entries) {
  const userKeys = getUserAccessKeys(user);
  if (!userKeys.size) return false;

  const entryKeys = new Set();
  collectMemberKeys(entryKeys, entries);

  for (const key of userKeys) {
    if (entryKeys.has(key)) {
      return true;
    }
  }

  return false;
}

export function isProjectManager(user) {
  return normalizeRole(user?.role) === USER_ROLES.PROJECT_MANAGER;
}

function normalizeIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isOwnedProject(user, project = null) {
  if (!user || !project) return false;

  const currentUserId = normalizeIdentity(
    user?.employee_id ?? user?.employeeId ?? user?.id
  );
  const currentUserEmail = normalizeIdentity(user?.email);
  const managerId = normalizeIdentity(project?.manager_id ?? project?.managerId);
  const managerEmail = normalizeIdentity(
    project?.manager_email ?? project?.managerEmail
  );

  if (currentUserId && managerId) {
    return currentUserId === managerId;
  }

  if (currentUserEmail && managerEmail) {
    return currentUserEmail === managerEmail;
  }

  return false;
}

export function canManageProjects(user) {
  return isProjectManager(user);
}

export function canManageProject(user, project = null) {
  if (!isProjectManager(user)) return false;
  if (!project) return true;
  return isOwnedProject(user, project);
}

export function canManageTasks(user, project = null) {
  if (!isProjectManager(user)) return false;
  if (!project) return true;
  return isOwnedProject(user, project);
}

export function canManageTask(user, task = null, project = null) {
  return canManageTasks(user, project);
}

export function canAssignTask(user, project = null) {
  return canManageTasks(user, project);
}

export function canViewTask(user, task, project = null) {
  if (!user) return false;
  if (isProjectManager(user)) {
    return isOwnedProject(user, project);
  }
  return doesUserMatchEntries(user, getTaskAssignees(task, project));
}

export function canMoveTask(user, task, project = null) {
  if (!user) return false;
  if (isProjectManager(user)) {
    return isOwnedProject(user, project);
  }
  return canViewTask(user, task, project);
}

export function canViewProject(user, project) {
  if (!user || !project) return false;
  if (isProjectManager(user)) {
    return isOwnedProject(user, project);
  }

  if (doesUserMatchEntries(user, getProjectMembers(project))) {
    return true;
  }

  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  return tasks.some((task) => canViewTask(user, task, project));
}

export function canViewProjectTeam(user, project) {
  return canViewProject(user, project);
}

export function filterProjectsByAccess(user, projects = []) {
  return (Array.isArray(projects) ? projects : []).filter((project) =>
    canViewProject(user, project)
  );
}

export function filterTasksByAccess(user, tasks = [], projectLookup = null) {
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    const project = typeof projectLookup === "function"
      ? projectLookup(task)
      : null;
    return canViewTask(user, task, project);
  });
}
