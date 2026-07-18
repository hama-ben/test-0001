import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[Supabase] VITE_SUPABASE_URL أو VITE_SUPABASE_ANON_KEY غير مضبوطَين — " +
    "ميزات الإشعارات الفورية معطّلة. الرجاء إضافة المفاتيح في إعدادات Secrets."
  );
}

export const supabase = createClient(
  supabaseUrl  || "https://placeholder.supabase.co",
  supabaseKey  || "placeholder-anon-key",
  {
    auth: {
      autoRefreshToken: true,
      persistSession:   true,
    },
  }
);

export const DRIVER_DOCS_BUCKET = "driver-documents";

/**
 * Upload a driver file by proxying through the API server.
 * Uses Authorization: Bearer header (Supabase access token stored in localStorage).
 */
export async function uploadDriverFile(
  driverId: string,
  slot: "truck-front" | "license",
  file: File
): Promise<string> {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined ?? "").replace(/\/+$/, "");

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("driverId", driverId);
  formData.append("slot", slot);

  const sessionToken = localStorage.getItem("sessionToken") ?? "";

  const res = await fetch(`${apiBase}/api/driver/upload-file`, {
    method: "POST",
    headers: {
      "Authorization": sessionToken ? `Bearer ${sessionToken}` : "",
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `فشل رفع الملف (${slot}): HTTP ${res.status}`);
  }

  const data = await res.json() as { url: string };
  return data.url;
}

/**
 * Update the driver's live GPS location in Supabase.
 */
export async function updateDriverLocation(
  driverId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  try {
    await supabase
      .from("driver_locations")
      .upsert(
        {
          driver_id:  driverId,
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );
  } catch {
    // Silently ignore — table may not exist yet
  }
}
