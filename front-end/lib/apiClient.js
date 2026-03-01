import { safeLocalStorageSet } from "./storage";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let refreshPromise = null;

const getFriendlyMessage = (status) => {
  if (status >= 500) {
    return "Something went wrong on our side. Please try again.";
  }
  switch (status) {
    case 401:
    case 403:
      return "Please sign in again.";
    case 404:
      return "Not found.";
    case 422:
      return "Some fields are invalid. Please review and try again.";
    default:
      return "Request failed. Please try again.";
  }
};

const logDebugId = (data, status) => {
  const debugId = data?.error?.debugId;
  if (!debugId) return;
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production") return;
  const logLine = `[api] ${status} debugId=${debugId}`;
  if (status >= 500) {
    console.error(logLine);
    return;
  }
  console.warn(logLine);
};

const buildRequestOptions = (options = {}) => {
  const { _retry, ...rest } = options;
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const isFormData = rest.body instanceof FormData;
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(rest.headers || {}),
  };

  return {
    ...rest,
    headers,
    credentials: "include",
  };
};

const getApiErrorMessage = (data, status) => {
  const nestedMessage =
    (typeof data?.error?.message === "string" && data.error.message.trim()) ||
    "";
  const detailMessage =
    (typeof data?.detail === "string" && data.detail.trim()) || "";

  if (status === 400) {
    const raw = nestedMessage || detailMessage || "";
    if (raw.toLowerCase().includes("already exists")) {
      return "Email already exists.";
    }
    return "Something went wrong.";
  }

  if (nestedMessage) {
    return nestedMessage;
  }
  if (detailMessage) {
    return detailMessage;
  }
  return getFriendlyMessage(status);
};

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.access_token) {
          throw new Error("Refresh failed");
        }
        if (typeof window !== "undefined") {
          safeLocalStorageSet("token", payload.access_token);
        }
        return payload.access_token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

export async function apiClient(url, options = {}) {
  const requestOptions = buildRequestOptions(options);
  const isLoginRequest = url === "/auth/login";
  let res;
  try {
    res = await fetch(`${BASE_URL}${url}`, requestOptions);
  } catch {
    throw new Error("Network error. Please check your connection.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (res.status === 401) {
    if (isLoginRequest) {
      logDebugId(data, res.status);
      throw new Error(getApiErrorMessage(data, res.status));
    }

    if (!options._retry) {
      try {
        await refreshAccessToken();
        return await apiClient(url, { ...options, _retry: true });
      } catch {
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
          window.location.href = "/login";
        }
        throw new Error("Please sign in again.");
      }
    }
    logDebugId(data, res.status);
    throw new Error("Please sign in again.");
  }

  if (res.status === 403) {
    logDebugId(data, res.status);
    throw new Error("Please sign in again.");
  }

  if (!res.ok) {
    logDebugId(data, res.status);
    throw new Error(getApiErrorMessage(data, res.status));
  }

  return data;
}
