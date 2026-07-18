import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Idempotent schema bootstrap — runs every time the server starts.
 * Uses CREATE TABLE IF NOT EXISTS so it is safe to run against a
 * database that already has all tables.  Any new column added to an
 * existing table must be expressed as a separate ALTER TABLE … ADD
 * COLUMN IF NOT EXISTS statement below.
 */
const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS "users" (
  "id"                      text        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"                    text        NOT NULL,
  "email"                   text        NOT NULL,
  "phone"                   text        NOT NULL,
  "password_hash"           text        NOT NULL,
  "user_type"               text        NOT NULL,
  "wilaya"                  text        NOT NULL DEFAULT '',
  "commune"                 text        NOT NULL DEFAULT '',
  "account_status"          text        NOT NULL DEFAULT 'pending',
  "subscription_expires_at" timestamp,
  "free_trial_claimed"      boolean     NOT NULL DEFAULT false,
  CONSTRAINT "users_email_unique" UNIQUE("email"),
  CONSTRAINT "users_phone_unique" UNIQUE("phone")
);

CREATE TABLE IF NOT EXISTS "driver_status" (
  "driver_id"      text      PRIMARY KEY NOT NULL,
  "current_status" text      NOT NULL DEFAULT 'مغلق',
  "updated_at"     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "driver_details" (
  "driver_id"              text PRIMARY KEY NOT NULL,
  "wilaya"                 text NOT NULL DEFAULT '',
  "commune"                text NOT NULL DEFAULT '',
  "truck_front_photo_url"  text,
  "driver_license_url"     text,
  "truck_video_url"        text,
  "truck_side_photo_url"   text
);

CREATE TABLE IF NOT EXISTS "orders" (
  "id"           text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      text      NOT NULL,
  "driver_id"    text,
  "water_volume" text      NOT NULL,
  "barrel_count" integer   NOT NULL DEFAULT 0,
  "total_price"  numeric   NOT NULL,
  "latitude"     text,
  "longitude"    text,
  "status"       text      NOT NULL DEFAULT 'معلق',
  "created_at"   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "subscription_payments" (
  "id"            text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id"     text      NOT NULL,
  "receipt_image" text      NOT NULL,
  "status"        text      NOT NULL DEFAULT 'pending',
  "admin_notes"   text,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "reviewed_at"   timestamp
);

CREATE TABLE IF NOT EXISTS "ratings" (
  "id"             text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id"       text      NOT NULL,
  "rater_user_id"  text      NOT NULL,
  "rated_user_id"  text      NOT NULL,
  "rater_type"     text      NOT NULL,
  "stars"          integer   NOT NULL,
  "dispute_reason" text,
  "is_disputed"    boolean   NOT NULL DEFAULT false,
  "dispute_count"  integer   NOT NULL DEFAULT 0,
  "created_at"     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "announcements" (
  "id"              text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title"           text      NOT NULL,
  "content"         text      NOT NULL,
  "target_audience" text      NOT NULL DEFAULT 'all',
  "badge_text"      text,
  "is_active"       boolean   NOT NULL DEFAULT true,
  "created_at"      timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "saved_locations" (
  "id"         text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    text      NOT NULL,
  "label"      text      NOT NULL,
  "latitude"   text      NOT NULL,
  "longitude"  text      NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "announcement_reads" (
  "id"              text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" text      NOT NULL,
  "user_id"         text      NOT NULL,
  "user_type"       text      NOT NULL,
  "read_at"         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "announcement_reads_unique" UNIQUE ("announcement_id", "user_id", "user_type")
);

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id"          text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"     text,
  "message"     text      NOT NULL,
  "sender_type" text      NOT NULL DEFAULT 'user',
  "admin_id"    text,
  "status"      text      NOT NULL DEFAULT 'pending',
  "created_at"  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_devices" (
  "id"           text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      text      NOT NULL,
  "device_id"    text      NOT NULL,
  "device_label" text      NOT NULL DEFAULT '',
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at"  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "driver_appeals" (
  "id"             text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id"      text      NOT NULL,
  "message"        text      NOT NULL,
  "status"         text      NOT NULL DEFAULT 'pending',
  "admin_response" text,
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "reviewed_at"    timestamp
);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"           text      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      text      NOT NULL,
  "subscription" jsonb     NOT NULL,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "driver_locations" (
  "driver_id"  text             PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "latitude"   double precision NOT NULL,
  "longitude"  double precision NOT NULL,
  "updated_at" timestamptz      NOT NULL DEFAULT now()
);

-- REPLICA IDENTITY FULL is required so that Supabase Realtime postgres_changes
-- sends ALL column values (including latitude/longitude) in UPDATE event payloads.
-- Without this, only the primary key is included in the WAL diff.
ALTER TABLE "driver_locations" REPLICA IDENTITY FULL;

-- Enable RLS so Supabase Realtime will honour the subscription filter.
-- Without RLS enabled, postgres_changes subscriptions are blocked by Supabase.
ALTER TABLE "driver_locations" ENABLE ROW LEVEL SECURITY;

-- Allow the anon role to READ all driver locations.
-- ⚠️ Known limitation: any holder of the public anon key can query every driver's
-- position — identity-scoping is not possible without real Supabase Auth sessions.
-- This matches the existing architectural constraint on the orders / support_messages tables.
DO $rl_sel$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'driver_locations'
      AND policyname = 'allow_anon_select'
  ) THEN
    CREATE POLICY "allow_anon_select"
      ON "driver_locations" FOR SELECT TO anon USING (true);
  END IF;
END $rl_sel$;

-- Allow the anon role to INSERT / UPDATE driver locations (driver frontend writes its own row).
-- Same identity-scoping caveat as above.
DO $rl_all$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'driver_locations'
      AND policyname = 'allow_anon_upsert'
  ) THEN
    CREATE POLICY "allow_anon_upsert"
      ON "driver_locations" FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $rl_all$;

-- Add driver_locations to the supabase_realtime publication so that
-- postgres_changes subscribers actually receive row-change events.
-- Without this step the subscription connects but fires nothing (silent failure).
DO $pub$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname     = 'supabase_realtime'
      AND schemaname  = 'public'
      AND tablename   = 'driver_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
  END IF;
END $pub$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6 — Identity-scoped RLS (apply only after confirming Supabase Auth
-- sessions flow correctly from the frontend — i.e. supabase.auth.getSession()
-- returns a non-null, non-anonymous session in the browser console after login).
--
-- All policies use auth.uid()::text to cast Supabase's uuid UID to the text
-- type used by this project's id columns.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── orders ────────────────────────────────────────────────────────────────────
-- Users may only see their own orders (as consumer) or orders they are
-- assigned to (as driver). The API server (direct Postgres, bypasses RLS)
-- continues to work without change.
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;

DO $ord_sel$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='auth_select_orders') THEN
    CREATE POLICY "auth_select_orders" ON "orders"
      FOR SELECT TO authenticated
      USING (auth.uid()::text = user_id OR auth.uid()::text = driver_id);
  END IF;
END $ord_sel$;

DO $ord_ins$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='auth_insert_orders') THEN
    CREATE POLICY "auth_insert_orders" ON "orders"
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $ord_ins$;

DO $ord_upd$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='auth_update_orders') THEN
    CREATE POLICY "auth_update_orders" ON "orders"
      FOR UPDATE TO authenticated
      USING (auth.uid()::text = user_id OR auth.uid()::text = driver_id);
  END IF;
END $ord_upd$;

-- ── support_messages ──────────────────────────────────────────────────────────
-- A user can only read their own support thread; the admin uses the service
-- role (bypasses RLS) so admin read access is unaffected.
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;

DO $sm_sel$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_messages' AND policyname='auth_select_support_messages') THEN
    CREATE POLICY "auth_select_support_messages" ON "support_messages"
      FOR SELECT TO authenticated
      USING (auth.uid()::text = user_id);
  END IF;
END $sm_sel$;

DO $sm_ins$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_messages' AND policyname='auth_insert_support_messages') THEN
    CREATE POLICY "auth_insert_support_messages" ON "support_messages"
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $sm_ins$;

-- ── announcements ─────────────────────────────────────────────────────────────
-- Any authenticated user may read announcements; only the API server (service
-- role) writes them.
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;

DO $ann_sel$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='announcements' AND policyname='auth_select_announcements') THEN
    CREATE POLICY "auth_select_announcements" ON "announcements"
      FOR SELECT TO authenticated
      USING (is_active = true);
  END IF;
END $ann_sel$;

-- ── driver_locations — replace blanket-anon policies with identity-scoped ones ─
-- Drop the open anon policies added in the previous migration step and replace
-- them with tighter authenticated-only policies.

DO $dl_drop_sel$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_locations' AND policyname='allow_anon_select') THEN
    DROP POLICY "allow_anon_select" ON "driver_locations";
  END IF;
END $dl_drop_sel$;

DO $dl_drop_all$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_locations' AND policyname='allow_anon_upsert') THEN
    DROP POLICY "allow_anon_upsert" ON "driver_locations";
  END IF;
END $dl_drop_all$;

-- Driver can read their own row; consumer can read a driver's row only while
-- there is an active order (status = 'قيد التوصيل') linking them.
-- Uses EXISTS + schema-qualified public.orders for clarity and index efficiency.
DO $dl_sel$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_locations' AND policyname='auth_select_driver_locations') THEN
    CREATE POLICY "auth_select_driver_locations" ON "driver_locations"
      FOR SELECT TO authenticated
      USING (
        -- The driver can always read their own current-position row
        auth.uid()::text = driver_id
        OR
        -- A consumer can read a driver's position only while an active delivery
        -- links them: the consumer's user_id must match an order whose driver_id
        -- matches this row, and the order must still be in transit.
        EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.driver_id  = driver_locations.driver_id
            AND o.user_id    = auth.uid()::text
            AND o.status     = 'قيد التوصيل'
        )
      );
  END IF;
END $dl_sel$;

-- Only the driver may write their own location row.
DO $dl_upd$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_locations' AND policyname='auth_upsert_driver_locations') THEN
    CREATE POLICY "auth_upsert_driver_locations" ON "driver_locations"
      FOR ALL TO authenticated
      USING (auth.uid()::text = driver_id)
      WITH CHECK (auth.uid()::text = driver_id);
  END IF;
END $dl_upd$;

-- ── Step 1 — Generalise driver_appeals for any user type ────────────────────
-- Add reason column (nullable — legacy rows have NULL, new rows store
-- "rejected" or "banned" set at submission time by the appeals route).
ALTER TABLE "driver_appeals" ADD COLUMN IF NOT EXISTS "reason" text;

-- ── Additive column migrations (always safe to re-run) ─────────────────────

ALTER TABLE "ratings"        ADD COLUMN IF NOT EXISTS "comment" text;

ALTER TABLE "driver_details" ADD COLUMN IF NOT EXISTS "is_legacy_driver"  boolean NOT NULL DEFAULT false;
ALTER TABLE "driver_details" ADD COLUMN IF NOT EXISTS "trial_granted_at"  timestamp;

-- One-time backfill: any driver who has no docs yet is a legacy driver
-- (registered before the document upload feature was added).
-- ON CONFLICT DO NOTHING prevents double-runs from failing.
UPDATE "driver_details"
SET "is_legacy_driver" = true
WHERE "truck_front_photo_url" IS NULL
  AND "driver_license_url" IS NULL
  AND "is_legacy_driver" = false;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at"              timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_approval_granted"  boolean NOT NULL DEFAULT false;

-- Support chat: two-way conversation between users and admin
ALTER TABLE "support_messages" ADD COLUMN IF NOT EXISTS "sender_type" text NOT NULL DEFAULT 'user';
ALTER TABLE "support_messages" ADD COLUMN IF NOT EXISTS "admin_id"    text;

-- Subscription duration: how many months the driver paid for
ALTER TABLE "subscription_payments" ADD COLUMN IF NOT EXISTS "months" integer NOT NULL DEFAULT 1;
`;

export async function runMigrations(): Promise<void> {
  logger.info("Running DB schema bootstrap…");
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    logger.info("✅ DB schema ready");
  } catch (err: unknown) {
    const cause  = (err as { cause?: unknown })?.cause ?? err;
    const pgCode = (cause as { code?: string })?.code ?? (err as { code?: string })?.code;
    const msg    = err instanceof Error ? err.message : String(err);

    // 23505 = unique_violation — happens when two server instances race to
    // CREATE TABLE at the same time. The table exists (or is being created)
    // so the schema is fine; continue normally instead of aborting.
    if (pgCode === "23505") {
      logger.warn({ pgCode, err: msg }, "⚠️  Schema race detected (table already exists) — continuing");
      return;
    }

    logger.error({ pgCode, err: msg }, "❌ DB schema bootstrap failed — server cannot start");
    throw err;
  } finally {
    client.release();
  }
}
