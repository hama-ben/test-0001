import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { drivers, consumers } = JSON.parse(readFileSync("./mizu-load-test/authenticated-accounts.json", "utf8"));

console.log("=== اختبار location ===");
const { data: locData, error: locError } = await supabase
  .from("driver_locations")
  .upsert({ driver_id: drivers[0].userId, latitude: 36.75, longitude: 3.06, updated_at: new Date().toISOString() }, { onConflict: "driver_id" });
console.log("data:", JSON.stringify(locData));
console.log("error:", JSON.stringify(locError, null, 2));

console.log("\n=== اختبار order ===");
const res = await fetch(`${process.env.BASE_URL}/api/orders`, {
  method: "POST",
  headers: { Authorization: `Bearer ${consumers[0].sessionToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ userId: consumers[0].userId, waterVolume: "20L", barrelCount: 1, totalPrice: 300, latitude: 36.75, longitude: 3.06 }),
});
console.log("status:", res.status);
const body = await res.text();
console.log("body:", body);
