import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Accept both the correct name and the legacy typo that may exist on Render.
// Priority: SUPABASE_DB_URL → SUPABASE_BD_URL (typo fallback) → crash.
const rawUrl =
  process.env.SUPABASE_DB_URL ??
  process.env.SUPABASE_BD_URL;

if (!rawUrl) {
  throw new Error(
    "[db] Neither SUPABASE_DB_URL nor SUPABASE_BD_URL is set. " +
    "Set SUPABASE_DB_URL to the direct Supabase Postgres connection string."
  );
}

// Always SSL for Supabase — rejectUnauthorized:false is intentional
// (TLS tunnel enforced by the connection string; we need encryption, not cert pinning).
//
// Pool size: configurable via DB_POOL_MAX so it can be tuned per Render plan
// without a code change. Default raised from 20 -> 30 — at fleet scale
// (hundreds of concurrently active drivers) a burst of order/status/location
// requests can queue up quickly on a small pool. If you outgrow this, prefer
// Supabase's connection pooler (Session or Transaction mode / pgbouncer,
// port 6543) over just raising max further — Supabase itself caps direct
// Postgres connections per plan, and the pooler is built for exactly this.
const poolMax = Number(process.env.DB_POOL_MAX) || 30;

export const pool = new Pool({
  connectionString:      rawUrl,
  ssl:                   { rejectUnauthorized: false },
  max:                   poolMax,
  idleTimeoutMillis:     30_000, // close idle connections after 30 s
  connectionTimeoutMillis: 5_000, // throw if a connection can't be acquired in 5 s
});

export const db = drizzle(pool, { schema });

export * from "./schema";
