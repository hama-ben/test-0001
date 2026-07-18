import { create } from "zustand";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";

interface AuthState {
  userId: string | null;
  name: string | null;
  email: string | null;
  userType: string | null;
  sessionToken: string | null;
  setAuth: (data: {
    userId: string;
    name: string;
    email: string;
    userType: string;
    sessionToken?: string;
    refreshToken?: string;
  }) => void;
  logout: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase session sync
//
// Calls supabase.auth.setSession() so the shared Supabase client runs every
// Realtime subscription and direct query under the user's real JWT identity
// instead of as anonymous.  Must be called:
//   • after login / OTP verify (via setAuth)
//   • on page-boot rehydration (store factory below, tracked by _bootReady)
//   • after every token refresh (token-refresh.ts)
//   • NOT after logout — use supabase.auth.signOut() there instead.
//
// The Supabase JS v2 client stores the session in-memory synchronously on the
// first microtask, so Realtime subscriptions that happen later in the same
// event loop will pick up the correct token.  The returned Promise settles
// after any background token-exchange the library performs.
// ─────────────────────────────────────────────────────────────────────────────

/** Settles when the boot-time setSession() call finishes. Components that
 *  open Realtime subscriptions can await this to eliminate any race window. */
let _bootReady: Promise<void> = Promise.resolve();

export function getSessionBootReady(): Promise<void> {
  return _bootReady;
}

export function syncSupabaseSession(
  sessionToken: string,
  refreshToken: string
): Promise<void> {
  const p = supabase.auth
    .setSession({ access_token: sessionToken, refresh_token: refreshToken })
    .then(() => undefined)
    .catch((err) => {
      console.warn("[auth] supabase.auth.setSession failed:", err);
    });
  return p;
}

export const useAuth = create<AuthState>((set) => {
  const storedUserId       = localStorage.getItem("userId");
  const storedName         = localStorage.getItem("name");
  const storedEmail        = localStorage.getItem("email");
  const storedUserType     = localStorage.getItem("userType");
  const storedSessionToken = localStorage.getItem("sessionToken");
  const storedRefreshToken = localStorage.getItem("refreshToken");

  // All API calls carry: Authorization: Bearer <supabase_access_token>
  setAuthTokenGetter(() => localStorage.getItem("sessionToken"));

  // ── App-boot rehydration (Step 3) ──────────────────────────────────────────
  // If the user was already logged in from a previous session, restore the
  // Supabase client session immediately so RLS and Realtime work from the
  // very first subscription, without waiting for a page interaction.
  // We track the in-flight promise in _bootReady so components can await it
  // before opening a postgres_changes subscription to avoid an anon-first window.
  if (storedSessionToken && storedRefreshToken) {
    _bootReady = syncSupabaseSession(storedSessionToken, storedRefreshToken);
  }

  return {
    userId:       storedUserId,
    name:         storedName,
    email:        storedEmail,
    userType:     storedUserType,
    sessionToken: storedSessionToken,

    setAuth: (data) => {
      localStorage.setItem("userId",       data.userId);
      localStorage.setItem("name",         data.name);
      localStorage.setItem("email",        data.email);
      localStorage.setItem("userType",     data.userType);
      localStorage.setItem("sessionToken", data.sessionToken ?? "");
      if (data.refreshToken) {
        localStorage.setItem("refreshToken", data.refreshToken);
      }

      // ── Sync Supabase client identity (Step 3) ────────────────────────────
      // Establish (or replace) the real user session on the shared Supabase
      // client so that all subsequent queries and Realtime subscriptions carry
      // the user's JWT rather than running as the anonymous role.
      if (data.sessionToken && data.refreshToken) {
        syncSupabaseSession(data.sessionToken, data.refreshToken);
      }

      set({
        userId:       data.userId,
        name:         data.name,
        email:        data.email,
        userType:     data.userType,
        sessionToken: data.sessionToken ?? null,
      });
    },

    logout: () => {
      localStorage.removeItem("userId");
      localStorage.removeItem("name");
      localStorage.removeItem("email");
      localStorage.removeItem("userType");
      localStorage.removeItem("sessionToken");
      localStorage.removeItem("refreshToken");

      // ── Clear Supabase client session (Step 5) ────────────────────────────
      // Drop the client back to anonymous so stale JWT is not reused for any
      // Realtime subscription or direct query after the user logs out.
      supabase.auth.signOut().catch((err) => {
        console.warn("[auth] supabase.auth.signOut failed (network):", err);
        // Best-effort fallback: force the in-memory session to an invalid state
        // so subsequent Realtime calls don't carry the dead JWT.
        // This works because setSession with expired/garbage tokens causes the
        // library to drop back to the anonymous role on the next request.
        supabase.auth
          .setSession({ access_token: "", refresh_token: "" })
          .catch(() => {/* ignore — we already logged the primary error */});
      });

      set({ userId: null, name: null, email: null, userType: null, sessionToken: null });
    },
  };
});
