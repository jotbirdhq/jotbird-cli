import { getApiKey, API_BASE, USER_AGENT } from "./config.js";

/**
 * Make an authenticated JSON request to the JotBird API.
 * Throws an Error with `status`, `setting` (named on Pro-gated 403s), and
 * `retryAfter` (429s) attached so command handlers can render specific messages.
 */
async function apiRequest(method, path, body = undefined) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not logged in. Run `jotbird login` first.");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": USER_AGENT,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const err = new Error(data?.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    if (data?.setting) err.setting = data.setting;
    const retryAfter = resp.headers.get("Retry-After");
    if (retryAfter) err.retryAfter = retryAfter;
    throw err;
  }

  return data;
}

/**
 * Publish or update a document.
 */
export async function publish({ markdown, title, slug, namespaced }) {
  const body = { markdown };
  if (title) body.title = title;
  if (slug) body.slug = slug;
  if (namespaced) body.namespaced = true;
  return apiRequest("POST", "/api/v1/publish", body);
}

/**
 * List all published documents.
 */
export async function listDocuments() {
  return apiRequest("GET", "/api/v1/documents");
}

/**
 * Permanently remove a document (deletes from database and public URL).
 */
export async function removeDocument(slug, { namespaced = false } = {}) {
  let path = `/api/v1/documents?slug=${encodeURIComponent(slug)}`;
  if (namespaced) path += "&namespaced=true";
  return apiRequest("DELETE", path);
}

function settingsPath(slug, namespaced) {
  let path = `/api/v1/documents/${encodeURIComponent(slug)}/settings`;
  if (namespaced) path += "?namespaced=true";
  return path;
}

/**
 * Get a document's page settings (theme, branding, visibility, tags).
 */
export async function getSettings(slug, { namespaced = false } = {}) {
  return apiRequest("GET", settingsPath(slug, namespaced));
}

/**
 * Partially update a document's page settings.
 * patch: { theme?, hideBranding?, visibility?, password? }
 */
export async function updateSettings(slug, patch, { namespaced = false } = {}) {
  return apiRequest("PATCH", settingsPath(slug, namespaced), patch);
}
