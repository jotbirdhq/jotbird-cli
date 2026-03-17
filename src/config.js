import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export const VERSION = "0.2.0";
export const USER_AGENT = `jotbird-cli/${VERSION}`;
