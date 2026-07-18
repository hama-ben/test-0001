/**
 * Client-side image compression using the native Canvas API.
 *
 * - Skips files already under SKIP_THRESHOLD_BYTES (200 KB) — no wasted work.
 * - Skips non-image files — returns the original unchanged.
 * - Scales the longest side down to MAX_DIMENSION (1600 px) while preserving
 *   aspect ratio. Images already within bounds are only re-encoded, not scaled.
 * - Re-encodes as JPEG at JPEG_QUALITY (0.75). Typical camera photos (3-10 MB)
 *   come out well under 400 KB.
 * - Fails open: if anything goes wrong (canvas unavailable, decode error, toBlob
 *   returns null) the original File is returned so the upload still proceeds.
 */

const MAX_DIMENSION       = 1600;
const JPEG_QUALITY        = 0.75;
const SKIP_THRESHOLD_BYTES = 200 * 1024; // 200 KB

export async function compressImage(file: File): Promise<File> {
  // ── Fast exits ────────────────────────────────────────────────────────────
  if (file.size <= SKIP_THRESHOLD_BYTES) return file;
  if (!file.type.startsWith("image/"))  return file;

  return new Promise<File>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // ── Compute target dimensions ────────────────────────────────────────
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        if (w >= h) {
          h = Math.round((h / w) * MAX_DIMENSION);
          w = MAX_DIMENSION;
        } else {
          w = Math.round((w / h) * MAX_DIMENSION);
          h = MAX_DIMENSION;
        }
      }

      // ── Draw & export ────────────────────────────────────────────────────
      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fail open
    };

    img.src = objectUrl;
  });
}
