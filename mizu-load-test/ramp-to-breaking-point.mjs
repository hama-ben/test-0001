/**
 * Ramp-to-breaking-point test.
 *
 * Simulates organic growth instead of a sudden burst:
 *   - Every DRIVER_RAMP_INTERVAL_MS, 2 more drivers connect. Before connecting,
 *     each one goes through real onboarding: uploads truck-front + license
 *     photos, submits docs, then gets auto-approved OR randomly rejected
 *     (REJECTION_RATE, default 10%) via the same admin endpoints a human
 *     reviewer would use — scripted, not manual. A rejected driver never
 *     goes online, same as real life. Approved drivers connect to Socket.io
 *     and start sending live location updates every 5s, exactly like the
 *     real app (direct to Supabase with the anon key, matching
 *     talabati/src/lib/supabase.ts:updateDriverLocation).
 *   - Consumers create orders continuously; order-worker count is tied to
 *     driver count via an accelerating random multiplier, so demand grows
 *     FASTER than driver supply as the test progresses.
 *
 * Tracks FIVE categories separately so we can see exactly which one
 * degrades first when the server starts to struggle:
 *   1. uploads   — document/truck-photo upload + docs submission
 *   2. approval  — admin approve/reject calls
 *   3. socket    — Socket.io connect success/latency (the real-time layer)
 *   4. location  — driver_locations upserts direct to Supabase (the "map" layer)
 *   5. orders    — order creation
 *
 * Prerequisite: authenticated-accounts.json from pace-login.mjs
 *
 * Usage:
 *   npm install socket.io-client @supabase/supabase-js
 *   BASE_URL=https://your-staging-api.onrender.com \
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_ANON_KEY=xxxx \
 *   ADMIN_API_KEY=xxxx \
 *     node ramp-to-breaking-point.mjs
 *
 * Stop anytime with Ctrl+C — it prints the full breakdown on exit either way.
 */
import { readFileSync } from "fs";
import { WebSocket } from "ws";
globalThis.WebSocket = WebSocket; // Node 20 lacks native WebSocket; required by @supabase/realtime-js
import { io } from "socket.io-client";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
if (!BASE_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY || !ADMIN_API_KEY) {
  console.error("Missing BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, or ADMIN_API_KEY env vars.");
  process.exit(1);
}
// Fraction of drivers to reject after docs submission, for realism — in a
// real fleet not every applicant passes verification. Override with
// REJECTION_RATE=0.15 etc. Rejected drivers do NOT proceed to connect
// (a rejected driver doesn't go online), so they count as "onboarded but
// filtered out", not a failure of the test itself.
const REJECTION_RATE = Number(process.env.REJECTION_RATE) || 0.1;

const DRIVER_RAMP_INTERVAL_MS = 3000; // 2 more drivers connect every 3s
const LOCATION_UPDATE_INTERVAL_MS = 5000; // matches the real app's cadence
const ORDER_WORKER_DELAY_MS = 2000; // each consumer worker waits ~2s between its own orders
const ERROR_RATE_BREAK_THRESHOLD = 0.3; // 30% errors in the rolling window = "broken"
const ROLLING_WINDOW = 20;

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { drivers, consumers } = JSON.parse(readFileSync("./authenticated-accounts.json", "utf8"));

// ── Metrics tracking ─────────────────────────────────────────────────────
function makeCategory(name) {
  return {
    name,
    total: 0,
    failed: 0,
    latencies: [],
    rollingResults: [], // true=ok, false=fail, most recent last
    brokenAt: null, // { time, driversConnected, orderWorkers } — set once, first time threshold is crossed
  };
}
const categories = {
  uploads: makeCategory("uploads"),
  approval: makeCategory("approval"),
  socket: makeCategory("socket"),
  location: makeCategory("location"),
  orders: makeCategory("orders"),
};

function record(cat, ok, latencyMs, context) {
  cat.total++;
  if (!ok) cat.failed++;
  cat.latencies.push(latencyMs);
  cat.rollingResults.push(ok);
  if (cat.rollingResults.length > ROLLING_WINDOW) cat.rollingResults.shift();

  if (!cat.brokenAt && cat.rollingResults.length === ROLLING_WINDOW) {
    const errorRate = cat.rollingResults.filter(r => !r).length / ROLLING_WINDOW;
    if (errorRate >= ERROR_RATE_BREAK_THRESHOLD) {
      cat.brokenAt = { time: new Date().toISOString(), errorRate, ...context };
      console.log(`\n🔴 نقطة انهيار مكتشفة بفئة "${cat.name}" — نسبة خطأ ${(errorRate * 100).toFixed(0)}% خلال آخر ${ROLLING_WINDOW} طلب`);
      console.log(`   السائقين المتصلين: ${context.driversConnected} | عمّال الطلبيات: ${context.orderWorkers}\n`);
    }
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

// ── State ─────────────────────────────────────────────────────────────────
let driversConnected = 0;
let orderWorkers = 1;
let stopped = false;
const sockets = [];

function currentContext() {
  return { driversConnected, orderWorkers };
}

// ── Driver onboarding: upload truck-front + license photos, then submit docs
// exactly like a real driver does before going online. This exercises the
// full upload path (multer 5MB limit, private-bucket signed URLs, the IDOR
// fix) — flagged as the most important step to simulate, so it runs BEFORE
// the driver connects to Socket.io.
const DUMMY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]); // minimal valid-looking JPEG bytes

async function uploadSlot(driver, slot) {
  const start = Date.now();
  const form = new FormData();
  form.append("file", new Blob([DUMMY_JPEG], { type: "image/jpeg" }), `${slot}.jpg`);
  form.append("slot", slot);
  try {
    const res = await fetch(`${BASE_URL}/api/driver/upload-file`, {
      method: "POST",
      headers: { Authorization: `Bearer ${driver.sessionToken}` },
      body: form,
    });
    const ok = res.status === 200;
    record(categories.uploads, ok, Date.now() - start, currentContext());
    if (!ok) return null;
    const data = await res.json();
    return data.url; // bare storage path — what gets persisted in driver_details
  } catch {
    record(categories.uploads, false, Date.now() - start, currentContext());
    return null;
  }
}

async function submitDocs(driver, truckFrontPhotoUrl, driverLicenseUrl) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/driver/${driver.userId}/docs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${driver.sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ truckFrontPhotoUrl, driverLicenseUrl }),
    });
    record(categories.uploads, res.status === 200, Date.now() - start, currentContext());
    return res.status === 200;
  } catch {
    record(categories.uploads, false, Date.now() - start, currentContext());
    return false;
  }
}

let approvedCount = 0;
let rejectedCount = 0;

/** Auto-approves (or randomly rejects, for realism) via the same admin
 *  endpoints a human reviewer would use — scripted instead of manual, so
 *  the test doesn't stall waiting on a person to click "approve" 500 times.
 *  Returns true if the driver is approved and should go online. */
async function autoReviewDriver(driver) {
  const reject = Math.random() < REJECTION_RATE;
  const path = reject ? "reject" : "approve";
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/admin/drivers/${driver.userId}/${path}`, {
      method: "POST",
      headers: { "X-Admin-Key": ADMIN_API_KEY, "Content-Type": "application/json" },
    });
    const ok = res.status === 200;
    record(categories.approval, ok, Date.now() - start, currentContext());
    if (ok && reject) { rejectedCount++; return false; }
    if (ok && !reject) { approvedCount++; return true; }
    return false; // the approve/reject call itself failed — don't treat as online
  } catch {
    record(categories.approval, false, Date.now() - start, currentContext());
    return false;
  }
}

async function onboardDriver(driver) {
  const truckUrl = await uploadSlot(driver, "truck-front");
  const licenseUrl = await uploadSlot(driver, "license");
  if (!truckUrl || !licenseUrl) return false;
  const submitted = await submitDocs(driver, truckUrl, licenseUrl);
  if (!submitted) return false;
  return autoReviewDriver(driver);
}

// ── Driver ramp: connect 2 at a time, each starts its own location loop ───
async function connectOneDriver(driver) {
  const approved = await onboardDriver(driver); // upload docs + auto-review first — matches real registration flow
  if (!approved) return; // rejected or onboarding failed — this driver never goes online, same as real life

  const start = Date.now();
  return new Promise((resolve) => {
    const socket = io(BASE_URL, {
      auth: { sessionToken: driver.sessionToken },
      transports: ["websocket"],
      reconnection: false,
      timeout: 10000,
    });
    socket.on("connect", () => {
      record(categories.socket, true, Date.now() - start, currentContext());
      socket.emit("register_driver");
      driversConnected++;
      startLocationLoop(driver);
      sockets.push(socket);
      resolve();
    });
    socket.on("connect_error", () => {
      record(categories.socket, false, Date.now() - start, currentContext());
      resolve();
    });
  });
}

function startLocationLoop(driver) {
  const loop = async () => {
    if (stopped) return;
    const start = Date.now();
    const { error } = await supabaseAnon
      .from("driver_locations")
      .upsert(
        { driver_id: driver.userId, latitude: 36.75 + Math.random() * 0.1, longitude: 3.06 + Math.random() * 0.1, updated_at: new Date().toISOString() },
        { onConflict: "driver_id" }
      );
    record(categories.location, !error, Date.now() - start, currentContext());
    if (!stopped) setTimeout(loop, LOCATION_UPDATE_INTERVAL_MS);
  };
  loop();
}

async function rampDrivers() {
  let idx = 0;
  while (idx < drivers.length && !stopped) {
    const batch = drivers.slice(idx, idx + 2);
    await Promise.all(batch.map(connectOneDriver));
    idx += 2;
    bumpDemandAndSpawnWorkers();
    await new Promise(r => setTimeout(r, DRIVER_RAMP_INTERVAL_MS));
  }
  console.log(`\n✅ كل السائقين اتصلوا (${driversConnected}/${drivers.length})\n`);
}

// ── Order ramp: worker count tied to driver count, growing FASTER than
// drivers via an accelerating random multiplier — mimics real demand
// outpacing supply as more drivers come online, not a flat ratio.
let demandMultiplier = 1.0;
const DEMAND_GROWTH_MIN = 0.01;
const DEMAND_GROWTH_MAX = 0.06;
const DEMAND_MULTIPLIER_CAP = 4.0;
const ORDER_WORKERS_CAP = 800; // safety cap so the load generator itself doesn't fall over

function bumpDemandAndSpawnWorkers() {
  if (demandMultiplier < DEMAND_MULTIPLIER_CAP) {
    demandMultiplier += DEMAND_GROWTH_MIN + Math.random() * (DEMAND_GROWTH_MAX - DEMAND_GROWTH_MIN);
  }
  const target = Math.min(ORDER_WORKERS_CAP, Math.ceil(driversConnected * demandMultiplier));
  while (orderWorkers < target) {
    orderWorkers++;
    orderWorker(orderWorkers);
  }
  if (target > 0) {
    console.log(`  📈 الطلب (demand ×${demandMultiplier.toFixed(2)}) → ${orderWorkers} عامل طلبيات لـ ${driversConnected} سائق`);
  }
}

async function orderWorker(workerId) {
  let i = 0;
  while (!stopped) {
    const consumer = consumers[(workerId + i) % consumers.length];
    i++;
    const start = Date.now();
    let ok = false;
    try {
      const res = await fetch(`${BASE_URL}/api/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${consumer.sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: consumer.userId, waterVolume: "20L", barrelCount: 1, totalPrice: 300,
          latitude: 36.75, longitude: 3.06,
        }),
      });
      ok = res.status >= 200 && res.status < 300;
    } catch {
      ok = false;
    }
    record(categories.orders, ok, Date.now() - start, currentContext());
    await new Promise(r => setTimeout(r, ORDER_WORKER_DELAY_MS));
  }
}

// ── Live status line ────────────────────────────────────────────────────
function printStatus() {
  const line = Object.values(categories)
    .map(c => `${c.name}: ${c.total - c.failed}/${c.total} (${c.rollingResults.filter(r => !r).length}/${c.rollingResults.length} فشل مؤخرًا)`)
    .join(" | ");
  console.log(`[${new Date().toISOString().slice(11, 19)}] سائقين=${driversConnected} عمّال-طلبيات=${orderWorkers} :: ${line}`);
}

// ── Final report ─────────────────────────────────────────────────────────
function printFinalReport() {
  console.log("\n\n════════════════ التقرير النهائي ════════════════");
  console.log(`\n✅ سائقين تمت الموافقة عليهم: ${approvedCount} | ❌ مرفوضين: ${rejectedCount} (نسبة الرفض المستهدفة: ${(REJECTION_RATE * 100).toFixed(0)}%)`);
  for (const cat of Object.values(categories)) {
    const errorRate = cat.total > 0 ? (cat.failed / cat.total * 100).toFixed(1) : "0";
    console.log(`\n📊 ${cat.name}`);
    console.log(`   إجمالي: ${cat.total} | فشل: ${cat.failed} (${errorRate}%)`);
    console.log(`   زمن الاستجابة: p50=${percentile(cat.latencies, 0.5)}ms  p95=${percentile(cat.latencies, 0.95)}ms  p99=${percentile(cat.latencies, 0.99)}ms`);
    if (cat.brokenAt) {
      console.log(`   🔴 انهار عند: ${cat.brokenAt.time} — ${cat.brokenAt.driversConnected} سائق متصل، ${cat.brokenAt.orderWorkers} عامل طلبيات`);
    } else {
      console.log(`   ✅ لم ينهار خلال هذا الاختبار`);
    }
  }

  const brokenCategories = Object.values(categories).filter(c => c.brokenAt);
  if (brokenCategories.length > 0) {
    const first = brokenCategories.sort((a, b) => new Date(a.brokenAt.time) - new Date(b.brokenAt.time))[0];
    console.log(`\n🎯 أول جزء انهار: "${first.name}" — هون البداية اللي لازم تتعمق فيها.`);
  } else {
    console.log(`\n✅ ما في جزء وصل لعتبة الانهيار (${ERROR_RATE_BREAK_THRESHOLD * 100}% خطأ) خلال هذا الاختبار.`);
  }
}

process.on("SIGINT", () => {
  console.log("\n\n⏹️  إيقاف يدوي...");
  stopped = true;
  sockets.forEach(s => s.disconnect());
  printFinalReport();
  process.exit(0);
});

async function main() {
  console.log(`بدء الاختبار التدريجي — ${drivers.length} سائق، ${consumers.length} مستهلك متاحين\n`);

  orderWorker(0); // start with 1 consumer worker
  const statusInterval = setInterval(printStatus, 5000);

  await rampDrivers();

  console.log("كل السائقين متصلين — تارك عمّال الطلبيات يستمروا 2 دقيقة إضافية...");
  await new Promise(r => setTimeout(r, 120000));

  stopped = true;
  clearInterval(statusInterval);
  sockets.forEach(s => s.disconnect());
  printFinalReport();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  printFinalReport();
  process.exit(1);
});
