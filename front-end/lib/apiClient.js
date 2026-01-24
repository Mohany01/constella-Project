export async function apiClient(path, options = {}) {
  const { headers = {}, ...rest } = options;

  const response = await fetch(path, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  // Attempt to parse JSON; fallback to text so we always return something useful.
  const text = await response.text();
  const data = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      text ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data ?? { message: "Success" };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
