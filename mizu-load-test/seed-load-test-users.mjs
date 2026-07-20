/**
 * Seeds test accounts for load testing — 500 drivers + 50 consumers spread
 * across 5 fake "communes" (so the region-scoped Socket.io fix can be
 * verified: each commune's order should only wake up that commune's ~100
 * drivers, not all 500).
 *
 * Run against a STAGING Supabase project + database. Do NOT run against
 * production — this creates real Supabase Auth users and DB rows.
 *
 * Usage:
 *   npm install @supabase/supabase-js pg
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... node seed-load-test-users.mjs
 *
 * Output: writes load-test-accounts.json — {drivers: [...], consumers: [...]}
 * consumed by the k6 and Artillery scripts.
 */
import { WebSocket } from "ws";
globalThis.WebSocket = WebSocket;

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { writeFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL env vars.");
  process.exit(1);
}

const DRIVERS_PER_COMMUNE = 100;
const CONSUMERS_PER_COMMUNE = 10;
const COMMUNES = [
  { wilaya: "الجزائر", commune: "LOADTEST-ALGER" },
  { wilaya: "وهران", commune: "LOADTEST-ORAN" },
  { wilaya: "قسنطينة", commune: "LOADTEST-CONSTANTINE" },
  { wilaya: "بليدة", commune: "LOADTEST-BLIDA" },
  { wilaya: "سطيف", commune: "LOADTEST-SETIF" },
];
const TEST_PASSWORD = "LoadTest#2026!";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function createAccount({ email, phone, name, userType, wilaya, commune }) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`auth create failed for ${email}: ${error?.message}`);

  const id = data.user.id;

  await pool.query(
    `INSERT INTO users (id, name, email, phone, password_hash, user_type, wilaya, commune, account_status, first_approval_granted, free_trial_claimed, created_at)
     VALUES ($1,$2,$3,$4,'supabase-managed',$5,$6,$7,'approved', true, true, now())
     ON CONFLICT (id) DO NOTHING`,
    [id, name, email, phone, userType, wilaya, commune]
  );

  if (userType === "سائق") {
    await pool.query(
      `INSERT INTO driver_details (driver_id, wilaya, commune, truck_front_photo_url, driver_license_url, is_legacy_driver)
       VALUES ($1,$2,$3,'loadtest/placeholder.jpg','loadtest/placeholder.jpg', true)
       ON CONFLICT (driver_id) DO NOTHING`,
      [id, wilaya, commune]
    );
  }

  return { id, email, password: TEST_PASSWORD, wilaya, commune };
}

async function main() {
  const drivers = [];
  const consumers = [];
  let seq = 0;

  for (const { wilaya, commune } of COMMUNES) {
    for (let i = 0; i < DRIVERS_PER_COMMUNE; i++) {
      seq++;
      const email = `loadtest.driver.${seq}@mizu-test.local`;
      const phone = `06${String(seq).padStart(8, "0")}`;
      const acc = await createAccount({
        email, phone, name: `LoadTest Driver ${seq}`, userType: "سائق", wilaya, commune,
      });
      drivers.push(acc);
      if (seq % 25 === 0) console.log(`  ${seq} drivers created...`);
    }
    for (let i = 0; i < CONSUMERS_PER_COMMUNE; i++) {
      seq++;
      const email = `loadtest.consumer.${seq}@mizu-test.local`;
      const phone = `07${String(seq).padStart(8, "0")}`;
      const acc = await createAccount({
        email, phone, name: `LoadTest Consumer ${seq}`, userType: "مستهلك", wilaya, commune,
      });
      consumers.push(acc);
    }
    console.log(`✅ Commune ${commune}: 100 drivers + 10 consumers`);
  }

  writeFileSync("load-test-accounts.json", JSON.stringify({ drivers, consumers }, null, 2));
  console.log(`\nDone: ${drivers.length} drivers, ${consumers.length} consumers → load-test-accounts.json`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
