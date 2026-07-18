import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { authRateLimiter } from "./middlewares/auth-rate-limit";

const app: Express = express();

// Trust exactly one proxy hop (Render's load balancer, Replit's proxy, etc.)
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// when it sees the X-Forwarded-For header set by the reverse proxy in front of us.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS — allow all origins.
// The API is consumed by:
//   - The Replit web preview (dynamic *.replit.dev origin)
//   - The Android WebView (origin: capacitor://localhost or https://localhost)
//   - Future web/mobile clients
// All authentication is header-based (X-Session-Token, X-User-Id), not
// cookie-based, so an open CORS policy carries no additional risk.
app.use(cors({ origin: true, credentials: true }));

// Gzip/deflate compression for all responses (JSON API + the built SPA in
// production). Cuts outbound bandwidth significantly — text/JSON responses
// typically compress 60-80%. This directly reduces Render bandwidth usage.
app.use(compression());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Auth rate limiter — scoped to /api/auth/* only.
// /api/health and /api/healthz are on a different path and are never affected.
app.use("/api/auth", authRateLimiter);

app.use("/api", router);

// ── Production: serve the built Vite frontend from the same server ────────────
// In production there is no separate Vite dev server, so the API server
// serves the pre-built SPA files and falls back to index.html for all
// non-API paths so client-side routing works correctly.
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, "../../talabati/dist/public");

  app.use(express.static(frontendDist));

  app.get("*splat", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });

  logger.info({ frontendDist }, "Serving static frontend in production");
}

export default app;
