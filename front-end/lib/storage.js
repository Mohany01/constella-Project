export function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (error?.name !== "QuotaExceededError") return false;

    if (!String(key).startsWith("profile_photo_")) {
      return false;
    }

    const photoKeys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("profile_photo_") && k !== key) photoKeys.push(k);
    }
    photoKeys.forEach((k) => window.localStorage.removeItem(k));

    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}
