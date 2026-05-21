"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "./apiClient";
import {
  SESSION_COOKIE_NAME,
  encodeSessionCookie,
  isAuthenticatedUser,
  normalizeUser,
} from "./auth";
import { safeLocalStorageSet } from "./storage";

function safeParseUser(rawValue) {
  if (!rawValue) return null;
  try {
    return normalizeUser(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

function writeSessionCookie(user) {
  if (typeof document === "undefined") return;
  const encoded = encodeSessionCookie(user);
  if (!encoded) return;
  document.cookie = `${SESSION_COOKIE_NAME}=${encoded}; path=/; max-age=2592000; SameSite=Lax`;
}

export function persistUserSession(user) {
  const normalized = normalizeUser(user);
  if (!normalized || typeof window === "undefined") {
    return normalized;
  }

  safeLocalStorageSet("user", JSON.stringify(normalized));
  writeSessionCookie(normalized);
  return normalized;
}

export function clearUserSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("user");
  } catch {}
  document.cookie = `${SESSION_COOKIE_NAME}=; Max-Age=0; path=/; SameSite=Lax`;
}

export function readStoredUser() {
  if (typeof window === "undefined") return null;

  const fromStorage = safeParseUser(window.localStorage.getItem("user"));
  if (fromStorage) return fromStorage;

  const cookiePart = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!cookiePart) return null;
  const cookieValue = cookiePart.slice(SESSION_COOKIE_NAME.length + 1);
  try {
    return normalizeUser(JSON.parse(decodeURIComponent(cookieValue)));
  } catch {
    return null;
  }
}

export async function syncCurrentUserProfile(fallbackUser = null) {
  const baseline = normalizeUser(fallbackUser) || readStoredUser();

  try {
    const profile = await apiClient("/auth/profile", { method: "GET" });
    const merged = normalizeUser({ ...baseline, ...profile });
    if (merged) {
      persistUserSession(merged);
    }
    return merged;
  } catch {
    if (baseline) {
      persistUserSession(baseline);
    }
    return baseline;
  }
}

export function useSessionUser({ requireAuth = false } = {}) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const stored = readStoredUser();

      if (!stored) {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
          if (requireAuth) {
            router.replace("/login");
          }
        }
        return;
      }

      if (!cancelled) {
        setUser(stored);
      }

      const synced = await syncCurrentUserProfile(stored);
      if (cancelled) return;

      setUser(synced || stored);
      setIsLoading(false);

      if (requireAuth && !isAuthenticatedUser(synced || stored)) {
        router.replace("/login");
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, [requireAuth, router]);

  return {
    user,
    isLoading,
  };
}
