// Startup env diagnostics — printed before any module that reads env vars.
console.log("[startup] SUPABASE_DB_URL present:", !!process.env.SUPABASE_DB_URL);
console.log("[startup] SUPABASE_BD_URL present:", !!process.env.SUPABASE_BD_URL); // typo check
console.log("[startup] NODE_ENV:", process.env.NODE_ENV);

// Node.js 20 has no native WebSocket — polyfill before any Supabase import.
import WebSocket from "ws";
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { ensureDriverBucket } from "./lib/storage-init";
import { initRealtimeBroadcast } from "./lib/supabase-server";
import { initSocketServer } from "./lib/socket-server";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Wrap Express in a raw http.Server so Socket.io can share the same port.
const httpServer = createServer(app);
initSocketServer(httpServer);

// Run DB migrations before accepting any traffic.
// Uses CREATE TABLE IF NOT EXISTS — safe to run on every cold start.
runMigrations()
  .then(() => {
    httpServer.listen(port, () => {
      logger.info({ port }, "Server listening");

      ensureDriverBucket().catch((e) =>
        logger.error({ err: e }, "Unexpected error in ensureDriverBucket")
      );

      // Supabase Realtime — secondary broadcast layer (cross-network fallback).
      initRealtimeBroadcast();
    });
  })
  .catch((err) => {
    logger.error({ err }, "DB migration failed — aborting startup");
    process.exit(1);
  });
