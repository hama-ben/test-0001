/**
 * token-refresh.ts
 *
 * Concurrent-safe Supabase JWT refresh module.
 *
 * Why this exists:
 * - Supabase access tokens expire after 1 hour.
 * - Multiple in-flight requests that all receive a 401 must NOT each trigger
 *   an independent refresh — that would race and rotate the refresh token out
 *   from under each other, causing random session loss.
 * - A single shared promise ensures only one refresh call is in-flight at a
 *   time; all concurrent callers await the same result.
 *
 * Usage:
 *   // At app startup (main.tsx):
 *   import { tokenRefresher, scheduleProactiveRefresh } from "@/lib/token-refresh";
 *   import { setTokenRefresher } from "@workspace/api-client-react";
 *   setTokenRefresher(tokenRefresher);
 *   scheduleProactiveRefresh();
 */

import { useAuth, syncSupabaseSession } from "@/hooks/use-auth";

// ── Refresh lock ─────────────────────────────────────────────────────────────
// Shared promise: if a refresh is already in-flight every caller awaits it.
let _refreshPromise: Promise<string | null> | null = null;

/** Base URL for the API — mirrors the Vite proxy path. */
const API_BASE = "/api";

// ── Core refresh call ────────────────────────────────────────────────────────

async function _doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      // Refresh token invalid or revoked — force logout
      _forceLogout();
      return null;
    }

    const json = (await res.json()) as { sessionToken?: string; refreshToken?: string };
    if (!json.sessionToken) {
      _forceLogout();
      return null;
    }

    // Persist the new tokens
    localStorage.setItem("sessionToken", json.sessionToken);
    if (json.refreshToken) {
      localStorage.setItem("refreshToken", json.refreshToken);
    }

    // Sync the Zustand store (store only holds sessionToken in-memory)
    try {
      const { setAuth } = useAuth.getState();
      const userId   = localStorage.getItem("userId") ?? "";
      const name     = localStorage.getItem("name") ?? "";
      const email    = localStorage.getItem("email") ?? "";
      const userType = localStorage.getItem("userType") ?? "";
      setAuth({ userId, name, email, userType, sessionToken: json.sessionToken, refreshToken: json.refreshToken });
    } catch {
      // If the Zustand store isn't available (e.g. SSR/test), that's fine —
      // the localStorage update is sufficient for customFetch to pick up.
    }

    // ── Sync Supabase client session (Step 4) ────────────────────────────────
    // Keep the Supabase client's internal session in lock-step with the
    // backend-issued tokens.  Without this, the client's session goes stale
    // after the first token rotation and RLS / Realtime subscriptions break.
    const newRefreshToken =
      json.refreshToken ?? localStorage.getItem("refreshToken") ?? "";
    if (json.sessionToken && newRefreshToken) {
      syncSupabaseSession(json.sessionToken, newRefreshToken);
    }

    return json.sessionToken;
  } catch {
    // Network error — don't log out, let the caller handle it
    return null;
  }
}

function _forceLogout(): void {
  try {
    useAuth.getState().logout();
    // Navigate to login — using location directly avoids a React import here
    window.location.href = "/";
  } catch {
    // If the store isn't ready yet, just clear localStorage
    localStorage.removeItem("sessionToken");
    localStorage.removeItem("refreshToken");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * refreshAccessToken — serialised, concurrent-safe.
 * Returns the new access token, or null if refresh is impossible.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh().finally(() => {
      _refreshPromise = null;
    });
  }
  return _refreshPromise;
}

/**
 * tokenRefresher — plug this into customFetch via setTokenRefresher().
 * It is called on every 401 response; if it returns a token the request
 * is retried once with the new Authorization header.
 */
export async function tokenRefresher(): Promise<string | null> {
  return refreshAccessToken();
}

// ── JWT expiry helpers ────────────────────────────────────────────────────────

function getTokenExpiry(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Returns the number of milliseconds until the token expires.
 * A negative value means it has already expired.
 */
export function msUntilExpiry(token: string | null): number | null {
  const exp = getTokenExpiry(token);
  if (exp === null) return null;
  return exp * 1000 - Date.now();
}

// ── Proactive refresh scheduler ───────────────────────────────────────────────

/** Refresh this many milliseconds before actual expiry. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000; // 5 minutes

let _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a proactive token refresh based on the JWT exp claim.
 * Cancels any previously scheduled timer and sets a new one.
 * Re-schedules itself after each successful refresh.
 *
 * Call once at app startup; returns a cleanup function.
 */
export function scheduleProactiveRefresh(): () => void {
  function schedule() {
    if (_scheduleTimer !== null) {
      clearTimeout(_scheduleTimer);
      _scheduleTimer = null;
    }

    const token = localStorage.getItem("sessionToken");
    const ms    = msUntilExpiry(token);

    if (ms === null) return; // No token or can't parse — nothing to schedule

    const delay = Math.max(0, ms - REFRESH_BEFORE_MS);

    _scheduleTimer = setTimeout(async () => {
      _scheduleTimer = null;
      const newToken = await refreshAccessToken();
      if (newToken) {
        // Reschedule for the new token's expiry
        schedule();
      }
      // If refresh failed, _forceLogout() was already called inside _doRefresh
    }, delay);
  }

  schedule();

  return () => {
    if (_scheduleTimer !== null) {
      clearTimeout(_scheduleTimer);
      _scheduleTimer = null;
    }
  };
}
