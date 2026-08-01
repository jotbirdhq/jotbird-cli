import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { getApiKey, USER_AGENT } from "./config.js";

const WORKER_BASE = "https://api.jotbird.com";

// ⚠️ MIRROR of the server's ALLOWED_IMAGE_TYPES (workers/jotbird-share/src/handlers/images.ts).
// The server accepts png/jpeg/gif/webp and NOTHING else, and verifies the magic bytes, so a type
// listed here but not there can never upload — it just 400s and the reference is left pointing at
// a local path that doesn't exist on the published page. SVG was listed here and is deliberately
// absent server-side (it can carry active content; the web app excludes it for the same reason).
const IMAGE_CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOAD_CONCURRENCY = 3;

/**
 * Turn a markdown image reference into a path on disk.
 *
 * A reference is a URL, not a filename: a space is commonly written as `%20`, and a link may carry
 * a `#anchor` or `?query`. Passing those to `resolve()` verbatim produces a path containing a
 * literal `%20` (or trailing `#…`) that does not exist, so the image was reported "not found" and
 * its LOCAL path shipped to the published page, where it resolves to nothing. Obsidian hit exactly
 * this and fixed it in v0.4.13; the same fix never reached here.
 *
 * The raw form is tried first so a file genuinely containing "%20" in its name still wins; the
 * decoded form is only a fallback. Returns the raw resolution when neither exists, so the existing
 * not-found reporting still names the path the user actually wrote.
 */
export function resolveImageRef(ref, documentDir) {
  const clean = ref.split(/[#?]/)[0];
  const direct = resolve(documentDir, clean);
  if (existsSync(direct)) return direct;
  try {
    const decoded = decodeURIComponent(clean);
    if (decoded !== clean) {
      const alt = resolve(documentDir, decoded);
      if (existsSync(alt)) return alt;
    }
  } catch {
    // Malformed %-sequence — keep the raw resolution.
  }
  return direct;
}

/**
 * Find local image references in markdown.
 * Matches ![alt](path) — skips http/https URLs.
 * Returns deduplicated list of { localPath, absolutePath }.
 */
export function findLocalImages(markdown, documentDir) {
  const images = [];
  const seen = new Set();

  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const ref = match[1].trim();
    if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
    const abs = resolveImageRef(ref, documentDir);
    if (!seen.has(abs)) {
      seen.add(abs);
      images.push({ localPath: ref, absolutePath: abs });
    }
  }

  return images;
}

/**
 * Upload a single image to the JotBird worker.
 * Returns the public URL.
 */
async function uploadImage(buffer, fileName, contentType) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Not logged in.");

  const formData = new FormData();
  const blob = new Blob([buffer], { type: contentType });
  formData.append("file", blob, fileName);

  const resp = await fetch(`${WORKER_BASE}/preview/upload-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
    },
    body: formData,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Upload failed");
    throw new Error(text || "Upload failed");
  }

  const data = await resp.json().catch(() => null);
  if (!data?.url) throw new Error("Invalid response from image upload.");
  return data.url;
}

/**
 * Find local images in markdown, upload them, and rewrite paths to remote URLs.
 * Returns the updated markdown. Logs warnings for skipped images.
 */
export async function uploadAndRewriteImages(markdown, filePath) {
  const documentDir = dirname(resolve(filePath));
  const images = findLocalImages(markdown, documentDir);
  if (images.length === 0) return markdown;

  // Validate and prepare upload tasks
  const tasks = [];
  for (const img of images) {
    const ext = extname(img.absolutePath).toLowerCase();
    const contentType = IMAGE_CONTENT_TYPES[ext];

    if (!contentType) {
      console.error(`  ⚠ Skipping unsupported image format: ${img.localPath}`);
      continue;
    }
    if (!existsSync(img.absolutePath)) {
      console.error(`  ⚠ Image not found: ${img.localPath}`);
      continue;
    }
    const stat = statSync(img.absolutePath);
    if (stat.size > MAX_IMAGE_SIZE) {
      console.error(`  ⚠ Skipping image over 10 MB: ${img.localPath}`);
      continue;
    }

    const buffer = readFileSync(img.absolutePath);
    const fileName = basename(img.absolutePath);
    tasks.push({ img, buffer, fileName, contentType });
  }

  if (tasks.length === 0) return markdown;

  // Upload with concurrency limit
  const urlMap = new Map();

  for (let i = 0; i < tasks.length; i += UPLOAD_CONCURRENCY) {
    const batch = tasks.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const remoteUrl = await uploadImage(task.buffer, task.fileName, task.contentType);
        return { localPath: task.img.localPath, remoteUrl };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        urlMap.set(result.value.localPath, result.value.remoteUrl);
      } else {
        const task = batch[j];
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`  ⚠ Failed to upload ${task.img.localPath}: ${message}`);
      }
    }
  }

  // Rewrite local paths to remote URLs in markdown image syntax
  let result = markdown;
  for (const [localPath, remoteUrl] of urlMap) {
    const escaped = localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(!\\[[^\\]]*\\]\\()${escaped}(\\))`, "g"),
      (_match, before, after) => `${before}${remoteUrl}${after}`,
    );
  }

  const uploaded = urlMap.size;
  const skipped = images.length - tasks.length;
  const failed = tasks.length - uploaded;
  if (uploaded > 0) console.error(`  ${uploaded} image${uploaded === 1 ? "" : "s"} uploaded`);
  if (skipped > 0) console.error(`  ${skipped} image${skipped === 1 ? "" : "s"} skipped`);
  if (failed > 0) console.error(`  ${failed} image${failed === 1 ? "" : "s"} failed`);

  return result;
}
