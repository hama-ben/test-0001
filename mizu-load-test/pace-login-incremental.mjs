/**
 * Resumable version of pace-login.mjs.
 * Saves authenticated-accounts.json after EVERY account so it can be
 * interrupted and resumed without losing progress.
 *
 * If authenticated-accounts.json already exists, accounts already in it
 * are skipped (resume from where we left off).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) { console.error("Missing BASE_URL env var."); process.exit(1); }

const { drivers, consumers } = JSON.parse(readFileSync("./load-test-accounts.json", "utf8"));
const allAccounts = [
  ...drivers.map(d => ({ ...d, kind: "driver" })),
  ...consumers.map(c => ({ ...c, kind: "consumer" })),
];

// Load any already-completed accounts
let alreadyDone = { drivers: [], consumers: [] };
if (existsSync("./authenticated-accounts.json")) {
  alreadyDone = JSON.parse(readFileSync("./authenticated-accounts.json", "utf8"));
  const doneCount = alreadyDone.drivers.length + alreadyDone.consumers.length;
  console.log(`Resuming: ${doneCount} already done, skipping them.`);
}
const doneEmails = new Set([
  ...alreadyDone.drivers.map(a => a.email),
  ...alreadyDone.consumers.map(a => a.email),
]);

const PACE_MS = 300;
const MAX_RETRIES = 5;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loginOne(account, attempt = 1) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-device-id": `paced-${account.id}` },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (res.status === 429) {
    if (attempt > MAX_RETRIES) throw new Error(`${account.email}: still 429 after ${MAX_RETRIES} retries`);
    const backoff = 2000 * attempt;
    console.log(`  ⏳ 429 for ${account.email}, waiting ${backoff}ms (attempt ${attempt})`);
    await sleep(backoff);
    return loginOne(account, attempt + 1);
  }
  if (res.status !== 200) throw new Error(`${account.email}: login failed with status ${res.status}`);
  const data = await res.json();
  return { ...account, sessionToken: data.sessionToken, userId: data.userId };
}

function saveProgress(authenticated) {
  writeFileSync("authenticated-accounts.json", JSON.stringify({
    drivers: authenticated.filter(a => a.kind === "driver"),
    consumers: authenticated.filter(a => a.kind === "consumer"),
  }, null, 2));
}

async function main() {
  const authenticated = [...alreadyDone.drivers, ...alreadyDone.consumers];
  let failures = 0;
  let processed = 0;

  const pending = allAccounts.filter(a => !doneEmails.has(a.email));
  console.log(`Processing ${pending.length} remaining accounts...`);

  for (let i = 0; i < pending.length; i++) {
    const account = pending[i];
    try {
      const result = await loginOne(account);
      authenticated.push(result);
      saveProgress(authenticated);
    } catch (err) {
      failures++;
      console.error(`  ❌ ${account.email}: ${err.message}`);
    }
    processed++;
    if (processed % 50 === 0) {
      const total = alreadyDone.drivers.length + alreadyDone.consumers.length + processed;
      console.log(`  ${total}/${allAccounts.length} processed so far (${failures} failures this run)...`);
    }
    await sleep(PACE_MS);
  }

  const totalDone = authenticated.length;
  const totalFailed = allAccounts.length - totalDone;
  console.log(`\nDone: ${totalDone} logged in, ${totalFailed} failed → authenticated-accounts.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
