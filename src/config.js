import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const CONFIG_DIR = join(homedir(), ".config", "jotbird");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials");

export function getApiKey() {
  try {
    return readFileSync(CREDENTIALS_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}

export function saveApiKey(key) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_FILE, key + "\n", { mode: 0o600 });
}

export function getCredentialsPath() {
  return CREDENTIALS_FILE;
}

export const API_BASE = process.env.JOTBIRD_API_URL || "https://www.jotbird.com";

// Read the version from package.json so the User-Agent always matches the
// published release, instead of a hand-edited literal that drifts out of sync.
// build.js copies src/ → dist/ flat, so "../package.json" resolves to the
// package root in both dev (src/) and the published build (dist/).
const require = createRequire(import.meta.url);
export const VERSION = require("../package.json").version;
export const USER_AGENT = `jotbird-cli/${VERSION}`;
