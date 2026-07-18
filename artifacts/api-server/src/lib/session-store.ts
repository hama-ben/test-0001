/**
 * Server-side session store.
 *
 * Maps a randomly-issued sessionToken (UUID) → { userId, userType }.
 * Tokens are stored in memory, matching the existing pattern used by
 * pendingStore and resetTokenStore in auth.ts.
 *
 * Lifetime: tokens survive until explicit logout or the 30-day TTL.
 * On server restart all tokens are cleared — clients re-authenticate
 * automatically via the login screen.
 *
 * Thread safety: Node.js is single-threaded; Map operations are atomic.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionEntry {
  userId: string;
  userType: string;
  expiresAt: number;
}

const sessions = new Map<string, SessionEntry>();

// Sweep expired sessions every hour.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions) {
    if (entry.expiresAt < now) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

/**
 * Store a new session. Called after successful login or OTP verification.
 */
export function storeSession(token: string, userId: string, userType: string): void {
  sessions.set(token, { userId, userType, expiresAt: Date.now() + SESSION_TTL_MS });
}

/**
 * Validate a token. Returns the session entry if valid, null otherwise.
 */
export function resolveSession(token: string): SessionEntry | null {
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return entry;
}

/**
 * Invalidate a session. Called on logout.
 */
export function deleteSession(token: string): void {
  sessions.delete(token);
}
