#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { getApiKey, saveApiKey, getCredentialsPath, API_BASE, VERSION } from "./config.js";
import { publish, listDocuments, removeDocument, getSettings, updateSettings } from "./api.js";
import { readMappings, writeMappings, setMapping, removeMapping } from "./mapping.js";
import { startCallbackServer, openBrowser } from "./login.js";
import { ALLOWED_EXTENSIONS, isAllowedFile } from "./files.js";
import { uploadAndRewriteImages } from "./images.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "login":
      return cmdLogin();
    case "publish":
      return cmdPublish(args.slice(1));
    case "remove":
      return cmdRemove(args.slice(1));
    case "settings":
      return cmdSettings(args.slice(1));
    case "list":
      return cmdList();
    case "help":
    case "--help":
    case "-h":
      return cmdHelp();
    case "version":
    case "--version":
    case "-v":
      return cmdVersion();
    default:
      if (!command) {
        cmdHelp();
        process.exit(1);
      }
      console.error(`Unknown command: ${command}`);
      console.error('Run "jotbird help" for usage.');
      process.exit(1);
  }
}

// ---- Arg parsing ----

/**
 * Parse publish sub-command arguments.
 * Returns { slug: string|null, namespaced: boolean, files: string[] }.
 */
export function parsePublishArgs(fileArgs) {
  let slug = null;
  let namespaced = false;
  const files = [];
  for (let i = 0; i < fileArgs.length; i++) {
    if (fileArgs[i] === "--slug" && i + 1 < fileArgs.length) {
      slug = fileArgs[++i];
    } else if (fileArgs[i] === "--namespace" && i + 1 < fileArgs.length) {
      slug = fileArgs[++i];
      namespaced = true;
    } else {
      files.push(fileArgs[i]);
    }
  }
  return { slug, namespaced, files };
}

/**
 * Parse settings sub-command arguments.
 * Setting flags may appear before or after the target, like publish/remove.
 * Returns { targets: string[], namespaced: boolean, patch: object, error: string|null }.
 * patch only contains keys the user explicitly set. An unrecognized flag, or a
 * value flag whose value is missing or is itself a flag, is an error rather
 * than a silently-accepted target/value — a typo must not become a slug.
 */
export function parseSettingsArgs(settingsArgs) {
  const VALUE_FLAGS = { "--theme": "theme", "--visibility": "visibility", "--password": "password" };
  let namespaced = false;
  const values = {};
  let hideBranding;
  const targets = [];
  let error = null;

  const fail = (msg) => { error ??= msg; };

  for (let i = 0; i < settingsArgs.length; i++) {
    const arg = settingsArgs[i];
    if (arg === "--namespace") {
      namespaced = true;
    } else if (arg === "--hide-branding") {
      hideBranding = true;
    } else if (arg === "--show-branding") {
      hideBranding = false;
    } else if (VALUE_FLAGS[arg]) {
      const value = settingsArgs[i + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`${arg} requires a value.`);
      } else {
        values[VALUE_FLAGS[arg]] = value;
        i++;
      }
    } else if (arg.startsWith("--")) {
      fail(`Unknown flag: ${arg}`);
    } else {
      targets.push(arg);
    }
  }

  const patch = {};
  if (values.theme !== undefined) patch.theme = values.theme;
  if (hideBranding !== undefined) patch.hideBranding = hideBranding;
  if (values.visibility !== undefined) patch.visibility = values.visibility;
  if (values.password !== undefined) patch.password = values.password;
  return { targets, namespaced, patch, error };
}

/**
 * Resolve a user-supplied target (tracked file, slug, or @username/slug) to
 * the slug + namespaced flag the API expects. Shared by `remove` and `settings`.
 */
function resolveTarget(target, forceNamespaced = false) {
  const mappings = readMappings();
  const stored = mappings.get(target) || mappings.get(basename(target)) || target;
  const { slug, namespaced } = parseSlugValue(stored);
  return { slug, namespaced: forceNamespaced || namespaced, stored };
}

/**
 * Parse a .jotbird mapping value into slug and namespaced flag.
 * "@username/my-page" → { slug: "my-page", namespaced: true }
 * "bright-calm-meadow" → { slug: "bright-calm-meadow", namespaced: false }
 */
function parseSlugValue(value) {
  if (value.startsWith("@") && value.includes("/")) {
    const slash = value.indexOf("/");
    return { slug: value.slice(slash + 1), namespaced: true };
  }
  return { slug: value, namespaced: false };
}

// ---- Commands ----

async function cmdLogin() {
  const existing = getApiKey();
  if (existing) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question("You are already logged in. Replace existing token? [y/N] ", resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }
  }

  // Try to start a local callback server for automatic token capture
  let server = null;
  try {
    server = await startCallbackServer();
  } catch {
    // Fall through to manual flow
  }

  const baseUrl = `${API_BASE}/account/api-key`;
  const loginUrl = server
    ? `${baseUrl}?callback=${encodeURIComponent(`http://127.0.0.1:${server.port}/callback`)}&state=${encodeURIComponent(server.state)}`
    : baseUrl;

  const opened = await openBrowser(loginUrl);

  if (server) {
    if (opened) {
      console.log("\nOpening browser to log in...");
    } else {
      console.log("\nTo log in, open this URL in your browser:\n");
      console.log(`  ${loginUrl}`);
    }
    console.log("\nWaiting for browser authentication...");
    console.log("Or paste your API token here and press Enter:\n");

    // Race: callback server vs manual paste — first one wins
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const manualPromise = new Promise((resolve) => {
      rl2.question("> ", (answer) => resolve(answer.trim()));
    });

    let token = null;
    try {
      token = await Promise.race([
        server.tokenPromise,
        manualPromise,
      ]);
    } catch {
      // Timeout — fall through
    } finally {
      rl2.close();
      server.close();
    }

    if (token && token.startsWith("jb_")) {
      saveApiKey(token);
      console.log(`\n✓ Logged in! Token saved to ${getCredentialsPath()}`);
      return;
    }

    if (token) {
      console.error("\nInvalid token format. Token should start with jb_");
      process.exit(1);
    }

    console.log("\nLogin timed out. Please try again.");
    process.exit(1);
  } else {
    console.log("\nTo log in, generate an API token in your browser:\n");
    console.log(`  ${loginUrl}\n`);
    console.log("Sign in if needed, then copy the token shown on the page.\n");
  }

  // Manual fallback (only when callback server couldn't start)
  const rl2 = createInterface({ input: process.stdin, output: process.stdout });
  const manualToken = await new Promise((resolve) => {
    rl2.question("Paste your API token: ", resolve);
  });
  rl2.close();

  const trimmed = manualToken.trim();
  if (!trimmed.startsWith("jb_")) {
    console.error("Invalid token format. Token should start with jb_");
    process.exit(1);
  }

  saveApiKey(trimmed);
  console.log(`\n✓ Logged in! Token saved to ${getCredentialsPath()}`);
}

async function cmdPublish(fileArgs) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("✗ Not logged in. Run `jotbird login` first.");
    process.exit(1);
  }

  const { slug: explicitSlug, namespaced: explicitNamespaced, files: remaining } = parsePublishArgs(fileArgs);

  if (explicitNamespaced && !explicitSlug) {
    console.error("✗ --namespace requires a slug. Example: jotbird publish --namespace my-page file.md");
    process.exit(1);
  }

  let markdown;
  let filename = null;

  if (remaining.length === 0 || remaining[0] === "-") {
    // Read from stdin
    markdown = await readStdin();
    if (!markdown.trim()) {
      console.error("✗ No input received from stdin.");
      process.exit(1);
    }
  } else {
    filename = remaining[0];

    if (!isAllowedFile(filename)) {
      const extensions = [...ALLOWED_EXTENSIONS].join(", ");
      console.error(`✗ Unsupported file type. Allowed extensions: ${extensions}`);
      process.exit(1);
    }

    try {
      markdown = readFileSync(filename, "utf-8");
    } catch {
      console.error(`✗ Cannot read file: ${filename}`);
      process.exit(1);
    }
  }

  // Upload local images and rewrite paths (only for file input, not stdin)
  if (filename) {
    markdown = await uploadAndRewriteImages(markdown, filename);
  }

  // Resolve slug and namespaced flag from explicit flags or existing mapping
  let slug = explicitSlug;
  let namespaced = explicitNamespaced;
  if (!slug && filename) {
    const mappings = readMappings();
    const stored = mappings.get(filename) || mappings.get(basename(filename)) || null;
    if (stored) {
      const parsed = parseSlugValue(stored);
      slug = parsed.slug;
      namespaced = parsed.namespaced;
    }
  }

  try {
    let result;
    try {
      result = await publish({ markdown, slug, namespaced });
    } catch (err) {
      // If the slug was not found, drop the stale mapping and retry as new.
      // Only for flat documents — namespaced slugs must be explicit.
      if (slug && !namespaced && err.message && err.message.includes("not found")) {
        console.error(`  Slug "${slug}" no longer exists — publishing as new document.`);
        if (filename) removeMapping(filename);
        result = await publish({ markdown, slug: null, namespaced: false });
      } else {
        throw err;
      }
    }

    if (filename) {
      const mappingValue = result.username
        ? `@${result.username}/${result.slug}`
        : result.slug;
      setMapping(filename, mappingValue);
    }

    if (result.created) {
      console.log(`\n✨ Published → ${result.url}`);
    } else {
      console.log(`\n✓ Updated → ${result.url}`);
    }

    if (result.expiresAt) {
      const date = new Date(result.expiresAt);
      console.log(`  Expires ${date.toLocaleDateString()}`);
    }
  } catch (err) {
    console.error(`\n✗ Publish failed: ${err.message}`);
    process.exit(1);
  }
}

async function cmdRemove(removeArgs) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("✗ Not logged in. Run `jotbird login` first.");
    process.exit(1);
  }

  // Parse --namespace flag
  let forceNamespaced = false;
  const positional = [];
  for (let i = 0; i < removeArgs.length; i++) {
    if (removeArgs[i] === "--namespace") {
      forceNamespaced = true;
    } else {
      positional.push(removeArgs[i]);
    }
  }

  if (positional.length === 0) {
    console.error("Usage: jotbird remove [--namespace] <file.md|slug>");
    process.exit(1);
  }

  const target = positional[0];
  const { slug, namespaced, stored } = resolveTarget(target, forceNamespaced);

  try {
    await removeDocument(slug, { namespaced });

    // Remove from mapping by target key; if --namespace was used with a bare slug,
    // also scan for any @*/slug entry that matches.
    if (!removeMapping(target)) {
      const map = readMappings();
      for (const [file, val] of map) {
        const parsed = parseSlugValue(val);
        if (parsed.slug === slug && parsed.namespaced === namespaced) {
          map.delete(file);
          writeMappings(map);
          break;
        }
      }
    }

    console.log(`\n✓ Removed ${stored}`);
  } catch (err) {
    console.error(`\n✗ Remove failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * The `settings` command's logic, with its I/O injected so it can be tested.
 * Returns { settings, updated }; throws UsageError for user mistakes and the
 * api module's decorated Errors (status/setting/retryAfter) for API failures.
 * Printing and exit codes stay in cmdSettings.
 */
export async function runSettings(settingsArgs, {
  get = getSettings,
  update = updateSettings,
  resolve = resolveTarget,
  resolvePassword = resolvePagePassword,
} = {}) {
  const { targets, namespaced: forceNamespaced, patch, error } = parseSettingsArgs(settingsArgs);

  if (error) throw new UsageError(`${error}\n${SETTINGS_USAGE}`);
  if (targets.length !== 1) throw new UsageError(SETTINGS_USAGE);

  const { slug, namespaced } = resolve(targets[0], forceNamespaced);

  if (patch.password !== undefined && patch.visibility !== "password") {
    throw new UsageError("--password requires --visibility password.");
  }

  if (Object.keys(patch).length === 0) {
    return { settings: await get(slug, { namespaced }), updated: false };
  }

  // Pre-flight EVERY write. GET is not rate-limited, but PATCH is charged
  // before validation — even when it 404s — so without this a mistyped slug
  // silently eats one of a free account's 10 writes per hour. It also means the
  // password prompt never asks for a secret we were going to discard anyway.
  // (Load-bearing order: this GET must precede the update. Covered by tests.)
  await get(slug, { namespaced });

  if (patch.visibility === "password") {
    patch.password = await resolvePassword(patch.password);
  }

  return { settings: await update(slug, patch, { namespaced }), updated: true };
}

/** Decorate an API error with the actionable detail the response carries. */
export function settingsErrorMessage(err) {
  let message = err.message;
  if (err.status === 403 && err.setting) {
    message += ` (Pro required for: ${err.setting})`;
  } else if (err.status === 429 && err.retryAfter) {
    message += ` (${formatRetryAfter(err.retryAfter)})`;
  } else if (err.status === 404) {
    message += ". Check the slug or your .jotbird mapping.";
  }
  return message;
}

async function cmdSettings(settingsArgs) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("✗ Not logged in. Run `jotbird login` first.");
    process.exit(1);
  }

  try {
    const { settings, updated } = await runSettings(settingsArgs);
    if (updated) console.log("\n✓ Settings updated");
    printSettings(settings);
  } catch (err) {
    if (err.usage) {
      console.error(`\n✗ ${err.message}`);
    } else {
      console.error(`\n✗ Settings failed: ${settingsErrorMessage(err)}`);
    }
    process.exit(1);
  }
}

const SETTINGS_USAGE =
  "Usage: jotbird settings [--namespace] <file.md|slug> [--theme <name>] [--hide-branding|--show-branding] [--visibility <state>] [--password <password>]";

/**
 * Render a Retry-After header, which is either delta-seconds or an HTTP-date.
 * The emptiness check matters: Number("") and Number(" ") are both 0, so a
 * blank header would otherwise render as a confident "retry in 0s".
 */
export function formatRetryAfter(retryAfter) {
  const raw = String(retryAfter ?? "").trim();
  if (!raw) return "rate limited";
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return `retry in ${seconds}s`;
  const when = new Date(raw);
  if (!Number.isNaN(when.getTime())) return `retry after ${when.toLocaleTimeString()}`;
  return `retry after ${raw}`;
}

/** `--password -` means "read the password from piped stdin". */
export const STDIN_PASSWORD = "-";

/**
 * A usage error: the message is already user-facing, so callers print it as-is
 * rather than dressing it up as an API failure.
 */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.usage = true;
  }
}

/**
 * Resolve the page password from exactly one source, in precedence order:
 *   1. `--password -`          one line of PIPED stdin
 *   2. `--password <pw>`       the literal value
 *   3. JOTBIRD_PAGE_PASSWORD   the environment
 *   4. an interactive hidden prompt
 *
 * `--password -` REQUIRES piped (non-TTY) stdin. On a terminal the shell echoes
 * what you type, so falling back to a plain stdin read would print the password
 * in cleartext and leave it in scrollback — the exact exposure the flag exists
 * to avoid. We refuse instead and point at the prompt.
 *
 * Dependencies are injected so this is testable without a real terminal.
 */
export async function resolvePagePassword(supplied, {
  env = process.env.JOTBIRD_PAGE_PASSWORD,
  isTTY = Boolean(process.stdin.isTTY),
  readStdinLine = readFirstStdinLine,
  prompt = promptPassword,
} = {}) {
  if (supplied === STDIN_PASSWORD) {
    if (isTTY) {
      throw new UsageError(
        "--password - reads the password from piped stdin, but stdin is a terminal " +
        "(typing it here would echo it in cleartext). Pipe it in, or omit --password to be prompted.",
      );
    }
    const line = await readStdinLine();
    if (!line) throw new UsageError("No password received on stdin.");
    return line;
  }

  if (supplied !== undefined) {
    // Reject a known-invalid empty password locally rather than spending a
    // charged PATCH on a request the server will always refuse. (The prompt
    // path already rejects empties; the flag path must agree.)
    if (supplied === "") throw new UsageError("Password cannot be empty.");
    return supplied;
  }
  if (env) return env;

  if (!isTTY) {
    throw new UsageError(
      "No terminal available for the password prompt. Use --password -, --password <password>, or JOTBIRD_PAGE_PASSWORD.",
    );
  }
  return prompt();
}

/**
 * Read ONLY the first line of stdin, resolving as soon as that line arrives.
 *
 * Two reasons this doesn't just buffer the whole stream:
 *  - Reading everything would silently turn a file with a trailing blank line
 *    (or any second line) into a multi-line password the user can never
 *    reproduce in the browser.
 *  - Waiting for EOF stalls on a pipe that stays open — in CI, where stdin is
 *    often an inherited pipe that never closes, that is an indefinite hang.
 */
function readFirstStdinLine() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let buffer = "";

    const firstLine = (s) => s.split("\n", 1)[0].replace(/\r$/, "");
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      stdin.pause();
    };
    const onData = (chunk) => {
      buffer += chunk;
      if (buffer.includes("\n")) {
        cleanup();
        resolve(firstLine(buffer));
      }
    };
    const onEnd = () => { cleanup(); resolve(firstLine(buffer)); };
    const onError = (err) => { cleanup(); reject(err); };

    stdin.setEncoding("utf-8");
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
    stdin.resume();
  });
}

function printSettings(s) {
  const id = s.username ? `@${s.username}/${s.slug}` : s.slug;
  const title = s.title ? `  ${s.title}` : "";
  console.log("");
  console.log(`  ${id}${title}`);
  console.log(`    ${s.url}`);
  console.log("");
  console.log(`  Theme:      ${s.theme}`);
  console.log(`  Branding:   ${s.hideBranding ? "hidden" : "shown"}`);
  console.log(`  Visibility: ${s.visibility}`);
  if (s.tags && s.tags.length > 0) {
    console.log(`  Tags:       ${s.tags.join(", ")}`);
  }
  if (s.expiresAt) {
    console.log(`  Expires:    ${new Date(s.expiresAt).toLocaleDateString()}`);
  }
}

/**
 * Ask for the password twice, without echoing. Every failure — empty, mismatch,
 * or cancellation — surfaces as a UsageError so the command exits nonzero with a
 * message. `hidden` is injected so the logic is testable without a terminal.
 */
export async function promptPassword({ hidden = promptHidden } = {}) {
  const first = await hidden("Password: ");
  if (!first) throw new UsageError("Password cannot be empty.");
  const second = await hidden("Confirm password: ");
  if (first !== second) throw new UsageError("Passwords do not match.");
  return first;
}

/**
 * Read a line from the terminal without echoing the typed characters.
 * The password is NOT trimmed — it is a credential, and silently stripping
 * whitespace would set something other than what the user typed (and disagree
 * with the --password flag, which sends the value verbatim).
 *
 * Cancelling (Ctrl+C / Ctrl+D) aborts the command with a nonzero status: the
 * `question` callback never fires in that case, so without the close/SIGINT
 * handling below the promise would never settle and the process would exit 0,
 * reporting success for a change that was never applied.
 */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });

    let settled = false;
    const settle = (finish, value) => {
      if (settled) return;
      settled = true;
      rl.removeListener("close", onCancel);
      rl.close();
      process.stdout.write("\n");
      finish(value);
    };

    // Ctrl+C / Ctrl+D. The `question` callback never fires on these, so without
    // settling here the promise would hang and the process would exit 0 —
    // reporting success for a change that was never applied.
    const onCancel = () => settle(reject, new UsageError("Cancelled. No settings were changed."));
    rl.on("SIGINT", onCancel);
    rl.on("close", onCancel);

    process.stdout.write(question);
    rl.question("", (answer) => settle(resolve, answer));
  });
}

async function cmdList() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("✗ Not logged in. Run `jotbird login` first.");
    process.exit(1);
  }

  try {
    const result = await listDocuments();
    const docs = result.documents || [];

    if (docs.length === 0) {
      console.log("No published documents yet.");
      return;
    }

    console.log("");
    for (const doc of docs) {
      const title = doc.title || "(untitled)";
      const source = doc.source === "api" || doc.source === "cli" ? " [api]" : doc.source === "mcp" ? " [mcp]" : "";
      const id = doc.username ? `@${doc.username}/${doc.slug}` : doc.slug;
      console.log(`  ${id}  ${title}${source}`);
      console.log(`    ${doc.url}`);
    }

    console.log(`\n  ${docs.length} document${docs.length === 1 ? "" : "s"}`);
  } catch (err) {
    console.error(`\n✗ Failed to list documents: ${err.message}`);
    process.exit(1);
  }
}

function cmdHelp() {
  console.log(`
jotbird - Publish Markdown from the command line

Usage:
  jotbird login                               Authenticate with JotBird
  jotbird publish <file.md>                   Publish or update a Markdown/text file
  jotbird publish --slug <slug> <file>        Update an existing document by slug
  jotbird publish --namespace <slug> <file>   Publish at your username URL (Pro)
  jotbird publish --namespace <slug>          Publish from stdin at your username URL (Pro)
  jotbird publish                             Read Markdown from stdin
  jotbird remove <file.md|slug>               Permanently delete a document
  jotbird remove --namespace <slug>           Delete a document at your username URL
  jotbird settings <file.md|slug>             Show a document's page settings
  jotbird settings <file.md|slug> [flags]     Update a document's page settings
  jotbird list                                List your published documents
  jotbird help                                Show this help message

Options:
  --slug <slug>        Target a specific document to update. Overrides the
                       .jotbird mapping. Works with both files and stdin.
  --namespace <slug>   Publish at share.jotbird.com/@username/<slug> (Pro).
                       Tracked as @username/slug in .jotbird — auto-updates on
                       subsequent publishes without any flags. Appears as
                       @username/slug in jotbird list. Requires a username in
                       Account Settings.

Settings flags:
  --theme <name>       Page theme: default, minimal, essay, or terminal
                       (non-default themes are Pro)
  --hide-branding      Hide the JotBird footer branding (Pro)
  --show-branding      Show the JotBird footer branding
  --visibility <state> unlisted, public, or password (password is Pro)
  --password <pw>      Page password, with --visibility password. Omit to be
                       prompted interactively. For scripts, prefer --password -
                       (read one line from piped stdin) or the
                       JOTBIRD_PAGE_PASSWORD env var — an inline password lands
                       in shell history and ps output. Precedence: --password,
                       then JOTBIRD_PAGE_PASSWORD, then the prompt. A literal
                       "-" is the stdin marker, so to use it as the password
                       itself, omit the flag and type it at the prompt.

Examples:
  jotbird publish README.md
  jotbird publish --slug bright-calm-meadow README.md
  jotbird publish --namespace my-page README.md
  echo "# Updated" | jotbird publish --slug bright-calm-meadow
  echo "# Updated" | jotbird publish --namespace my-page
  cat notes.md | jotbird publish
  jotbird settings README.md
  jotbird settings README.md --theme minimal --visibility public
  jotbird settings bright-calm-meadow --visibility password
  jotbird settings --namespace my-page --hide-branding
  jotbird remove my-old-post
  jotbird remove --namespace my-page
  jotbird remove @username/my-page

Files are tracked via a .jotbird mapping file in the current directory.
If a mapping exists, publish updates the existing URL. Namespaced documents
are tracked as @username/slug in the mapping and update automatically.
`.trim());
}

function cmdVersion() {
  console.log(`jotbird ${VERSION}`);
}

// ---- Helpers ----

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));

    // If stdin is a TTY (no pipe), show a hint and wait
    if (process.stdin.isTTY) {
      console.error("Reading from stdin... (Ctrl+D to finish)");
    }
  });
}

// Skip auto-run when imported by a test runner
const isTestEnv = typeof process !== "undefined" && (
  process.env.VITEST ||
  process.env.JEST_WORKER_ID ||
  process.env.NODE_ENV === "test"
);

if (!isTestEnv) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
