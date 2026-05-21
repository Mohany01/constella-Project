export const USER_ROLES = {
  PROJECT_MANAGER: "PROJECT_MANAGER",
  EMPLOYEE: "EMPLOYEE",
};

export const SESSION_COOKIE_NAME = "constella_user";

const MANAGER_ROLE_ALIASES = new Set([
  "project_manager",
  "project manager",
  "projectmanager",
  "pm",
  USER_ROLES.PROJECT_MANAGER,
]);

const EMPLOYEE_ROLE_ALIASES = new Set([
  "employee",
  "user",
  "member",
  "staff",
  USER_ROLES.EMPLOYEE,
]);

export function normalizeRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (MANAGER_ROLE_ALIASES.has(normalized)) {
    return USER_ROLES.PROJECT_MANAGER;
  }

  if (EMPLOYEE_ROLE_ALIASES.has(normalized)) {
    return USER_ROLES.EMPLOYEE;
  }

  return USER_ROLES.EMPLOYEE;
}

export function getRoleLabel(role) {
  return normalizeRole(role) === USER_ROLES.PROJECT_MANAGER
    ? "Project Manager"
    : "Employee";
}

export function normalizeUser(user = {}) {
  if (!user || typeof user !== "object") {
    return null;
  }

  const normalized = {
    id:
      user.id ??
      user.user_id ??
      user.employee_id ??
      user.employeeId ??
      user.sub ??
      null,
    name:
      user.name ??
      user.full_name ??
      user.fullName ??
      user.username ??
      "",
    email: user.email ?? user.user_email ?? user.employee_email ?? "",
    role: normalizeRole(user.role),
    department: user.department ?? "",
  };

  if (!normalized.id && !normalized.email && !normalized.name) {
    return null;
  }

  return normalized;
}

export function isAuthenticatedUser(user) {
  return Boolean(user?.id || user?.email || user?.name);
}

export function encodeSessionCookie(user) {
  const normalized = normalizeUser(user);
  if (!normalized) return "";
  return encodeURIComponent(JSON.stringify(normalized));
}

export function decodeSessionCookie(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return normalizeUser(parsed);
  } catch {
    return null;
  }
}

export function readUserFromCookieString(cookieHeader = "") {
  if (!cookieHeader) return null;

  const cookieParts = String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const sessionPart = cookieParts.find((part) =>
    part.startsWith(`${SESSION_COOKIE_NAME}=`)
  );

  if (!sessionPart) return null;
  const cookieValue = sessionPart.slice(SESSION_COOKIE_NAME.length + 1);
  return decodeSessionCookie(cookieValue);
}
