const BASE_URL = "http://localhost:8000"; // FastAPI port

export async function apiClient(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    if (data?.detail) {
      if (Array.isArray(data.detail)) {
        throw new Error(
          data.detail.map(e => `${e.loc.at(-1)}: ${e.msg}`).join(", ")
        );
      }
      throw new Error(data.detail);
    }
    throw new Error(`Request failed with status ${res.status}`);
  }

  return data;
}
