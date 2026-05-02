import { getApiKey, API_BASE, USER_AGENT } from "./config.js";

/**
 * Make an authenticated API request to the JotBird CLI API.
 */
async function apiRequest(path, body = null) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not logged in. Run `jotbird login` first.");
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
    },
    body: body ? JSON.stringify(body) : "{}",
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
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
  return apiRequest("/api/v1/publish", body);
}

/**
 * List all published documents.
 */
export async function listDocuments() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not logged in. Run `jotbird login` first.");
  }

  const resp = await fetch(`${API_BASE}/api/v1/documents`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
    },
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

/**
 * Permanently remove a document (deletes from database and public URL).
 */
export async function removeDocument(slug, { namespaced = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not logged in. Run `jotbird login` first.");
  }

  let url = `${API_BASE}/api/v1/documents?slug=${encodeURIComponent(slug)}`;
  if (namespaced) url += "&namespaced=true";

  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
    },
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}
