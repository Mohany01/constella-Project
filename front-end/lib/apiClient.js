const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiClient(url, options = {}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${url}`, {
    headers,
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    let detail = null;
    if (Array.isArray(data?.detail)) {
      detail = data.detail.map(e => `${e.loc?.at(-1)}: ${e.msg}`).join(", ");
    } else if (typeof data?.detail === "string") {
      detail = data.detail;
    } else if (typeof data?.message === "string") {
      detail = data.message;
    }
    throw new Error(detail || `Request failed with status ${res.status}`);
  }

  return data;
}
