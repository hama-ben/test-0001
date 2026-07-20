/**
 * k6 load test — REST endpoints only (login, GET /orders/active, POST /orders).
 * Socket.io connections are tested separately (see artillery-socketio.yml)
 * since k6's core module doesn't speak the Engine.io/Socket.io protocol.
 *
 * Usage:
 *   1. Run seed-load-test-users.mjs first → load-test-accounts.json
 *   2. k6 run -e BASE_URL=https://your-staging-api.onrender.com k6-rest-load-test.js
 *
 * What this measures:
 *   - Scenario A: 500 drivers logging in within the same ~30s window
 *     (morning-shift-start simulation)
 *   - Scenario B: those drivers repeatedly polling GET /orders/active —
 *     this is the exact query that used to fire 500x per order before the
 *     region-room fix; with the fix, only in-commune drivers hit this hard
 *   - Scenario C: consumers creating orders concurrently across all 5 test
 *     communes, to generate the traffic that scenario B reacts to
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const accounts = new SharedArray("accounts", function () {
  return [JSON.parse(open("./load-test-accounts.json"))];
})[0];

const loginDuration = new Trend("login_duration");
const activeOrdersDuration = new Trend("active_orders_duration");
const orderCreateDuration = new Trend("order_create_duration");
const failedLogins = new Counter("failed_logins");

export const options = {
  scenarios: {
    driver_login_burst: {
      executor: "per-vu-iterations",
      vus: 500,
      iterations: 1,
      maxDuration: "2m",
      exec: "driverLoginAndPoll",
    },
    consumer_order_bursts: {
      executor: "constant-arrival-rate",
      rate: 10, // 10 new orders/sec across all communes combined
      timeUnit: "1s",
      duration: "3m",
      preAllocatedVUs: 50,
      maxVUs: 100,
      startTime: "15s", // let drivers finish logging in first
      exec: "consumerCreatesOrder",
    },
  },
  thresholds: {
    login_duration: ["p(95)<1500"],
    active_orders_duration: ["p(95)<800"],
    order_create_duration: ["p(95)<1000"],
    failed_logins: ["count<5"],
  },
};

function login(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json", "x-device-id": `k6-${__VU}` } }
  );
  loginDuration.add(res.timings.duration);
  const ok = check(res, { "login 200": (r) => r.status === 200 });
  if (!ok) {
    failedLogins.add(1);
    return null;
  }
  return res.json();
}

export function driverLoginAndPoll() {
  const driver = accounts.drivers[__VU % accounts.drivers.length];
  const session = login(driver.email, driver.password);
  if (!session) return;

  const authHeaders = { headers: { Authorization: `Bearer ${session.sessionToken}` } };

  // Simulate an active shift: poll active orders every ~5s for a minute,
  // same as the frontend does after a "new_order" socket event.
  for (let i = 0; i < 12; i++) {
    const res = http.get(`${BASE_URL}/api/orders/active`, authHeaders);
    activeOrdersDuration.add(res.timings.duration);
    check(res, { "active-orders 200": (r) => r.status === 200 });
    sleep(5);
  }
}

export function consumerCreatesOrder() {
  const consumer = accounts.consumers[Math.floor(Math.random() * accounts.consumers.length)];
  const session = login(consumer.email, consumer.password);
  if (!session) return;

  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      userId: session.userId,
      waterVolume: "20L",
      barrelCount: 1,
      totalPrice: 300,
      latitude: 36.75,
      longitude: 3.06,
    }),
    { headers: { Authorization: `Bearer ${session.sessionToken}`, "Content-Type": "application/json" } }
  );
  orderCreateDuration.add(res.timings.duration);
  check(res, { "order create 2xx": (r) => r.status >= 200 && r.status < 300 });
}
