/**
 * Auth Rate Limiter
 *
 * Applied only to /api/auth/* routes.
 * - 5 attempts per 15 minutes per IP address.
 * - Returns 429 with a message when the limit is hit.
 * - Logs a warning including the offending IP on every rejection.
 * - Fail-open: if the limiter itself throws (memory pressure, etc.) the
 *   request is allowed through rather than blocking legitimate users.
 *
 * /api/health and /api/healthz are NEVER affected — they are mounted on a
 * separate path and this middleware is not applied to them.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const _limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,                  // max 5 requests per window per IP+account
  standardHeaders: "draft-7",
  legacyHeaders: false,

  // PROBLEM: keying by IP alone means many drivers behind the same mobile
  // carrier's NAT (very common — one shared public IP for thousands of
  // subscribers) exhaust each other's quota and get locked out of login.
  // FIX: key by IP + the account being targeted (email/phone from the
  // request body). Brute-forcing one account is still capped at 5/15min;
  // different drivers on the same IP no longer share a bucket.
  // ipKeyGenerator normalises IPv6 addresses to avoid trivial bypass via
  // address rotation (required by express-rate-limit v8+).
  keyGenerator: (req: Request): string => {
    const rawIp = req.ip ?? req.socket?.remoteAddress ?? "";
    const ip = ipKeyGenerator(rawIp);
    const body = req.body as { email?: string; phone?: string } | undefined;
    const identifier = body?.email ?? body?.phone ?? "";
    return `${ip}:${identifier}`;
  },

  handler: (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    logger.warn(
      { ip, path: req.path, method: req.method },
      "Rate limit triggered on auth route"
    );
    res.status(429).json({
      error: "طلبات كثيرة جداً. يرجى المحاولة مجدداً بعد 15 دقيقة.",
      code: "RATE_LIMITED",
    });
  },
});

/**
 * Fail-open wrapper: if the rate-limiter store throws for any reason,
 * we log a warning and call next() to allow the request through.
 * This ensures an infrastructure glitch never blocks legitimate users.
 */
export function authRateLimiter(req: Request, res: Response, next: NextFunction): void {
  try {
    _limiter(req, res, (err?: unknown) => {
      if (err) {
        logger.warn({ err }, "Rate limiter internal error — failing open");
        next();
        return;
      }
      next();
    });
  } catch (err) {
    logger.warn({ err }, "Rate limiter threw synchronously — failing open");
    next();
  }
}
