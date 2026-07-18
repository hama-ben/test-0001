import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-server";

export const DRIVER_DOCS_BUCKET = "driver-documents";

/**
 * ensureDriverBucket()
 *
 * Runs once at server startup via getSupabaseAdmin() which strictly requires
 * SUPABASE_SERVICE_ROLE_KEY — never falls back to anon key.
 * The service-role key bypasses RLS and has full storage-admin rights.
 */
export async function ensureDriverBucket(): Promise<void> {
  const admin = getSupabaseAdmin();

  if (!admin) {
    logger.warn(
      { bucket: DRIVER_DOCS_BUCKET },
      "ensureDriverBucket: SUPABASE_SERVICE_ROLE_KEY not set — " +
      "cannot verify/create bucket automatically. " +
      "Create the bucket manually in the Supabase dashboard (Storage → New bucket → public: true)."
    );
    return;
  }

  const { data: buckets, error: listError } = await admin.storage.listBuckets();

  if (listError) {
    logger.error(
      { bucket: DRIVER_DOCS_BUCKET, err: listError.message },
      "ensureDriverBucket: listBuckets() failed — check SUPABASE_SERVICE_ROLE_KEY"
    );
    return;
  }

  const bucketNames = (buckets ?? []).map((b) => b.name);
  logger.debug({ found: bucketNames }, "ensureDriverBucket: existing buckets");

  if (bucketNames.includes(DRIVER_DOCS_BUCKET)) {
    logger.info(
      { bucket: DRIVER_DOCS_BUCKET },
      `✅ Storage bucket "${DRIVER_DOCS_BUCKET}" already exists — driver uploads are ready`
    );
    return;
  }

  logger.warn(
    { bucket: DRIVER_DOCS_BUCKET },
    `⚠️  Bucket "${DRIVER_DOCS_BUCKET}" not found — creating it now…`
  );

  const { error: createError } = await admin.storage.createBucket(DRIVER_DOCS_BUCKET, {
    public: false, // PRIVATE: these are driving-license and vehicle photos (PII / gov ID).
                    // Access is via short-lived signed URLs only — see signDriverDocUrl() below.
    allowedMimeTypes: [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/quicktime",
    ],
    fileSizeLimit: 5242880, // 5 MB — matches multer limit in routes/driver.ts
  });

  if (createError) {
    logger.error(
      { bucket: DRIVER_DOCS_BUCKET, err: createError.message },
      `❌ Failed to create bucket "${DRIVER_DOCS_BUCKET}" — driver uploads will fail until it is created manually`
    );
    return;
  }

  logger.info(
    { bucket: DRIVER_DOCS_BUCKET },
    `✅ Bucket "${DRIVER_DOCS_BUCKET}" created successfully (private, 5 MB limit) — driver uploads are ready`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signed URLs — the only way driver documents (license/truck photos) should
// ever be handed to a client. Never use getPublicUrl() for this bucket.
// ─────────────────────────────────────────────────────────────────────────────

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — long enough to load an admin
                                          // review page or a driver's own profile,
                                          // short enough that a leaked link goes stale fast.

/**
 * Extract the storage path from whatever is stored in the DB for a document
 * field. Handles both:
 *  - the new format: a bare storage path, e.g. "driverId/license.jpg"
 *  - legacy data written before this bucket became private: a full public
 *    URL like ".../storage/v1/object/public/driver-documents/driverId/license.jpg"
 * Returns null if the input is null/empty.
 */
export function extractDriverDocPath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const marker = `/object/public/${DRIVER_DOCS_BUCKET}/`;
  const idx = stored.indexOf(marker);
  if (idx !== -1) return stored.slice(idx + marker.length);
  return stored; // already a bare path
}

/**
 * Sign one driver-document path into a short-lived, authenticated URL.
 * Returns null on failure (missing input, admin client unavailable, or the
 * object doesn't exist) so callers can render "photo unavailable" instead of
 * a broken image quietly.
 */
export async function signDriverDocUrl(stored: string | null | undefined): Promise<string | null> {
  const path = extractDriverDocPath(stored);
  if (!path) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin.storage
    .from(DRIVER_DOCS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    logger.warn({ err: error?.message, path }, "signDriverDocUrl: failed to sign URL");
    return null;
  }

  return data.signedUrl;
}
