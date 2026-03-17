#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { getApiKey, saveApiKey, getCredentialsPath, API_BASE, VERSION } from "./config.js";
import { publish, listDocuments, removeDocument } from "./api.js";
import { readMappings, setMapping, removeMapping } from "./mapping.js";
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
 * Returns { slug: string|null, files: string[] }.
 */
export function parsePublishArgs(fileArgs) {
  let slug = null;
  const files = [];
  for (let i = 0; i < fileArgs.length; i++) {
    if (fileArgs[i] === "--slug" && i + 1 < fileArgs.length) {
      slug = fileArgs[++i];
    } else {
      files.push(fileArgs[i]);
    }
  }
  return { slug, files };
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
    ? `${baseUrl}?callback=${encodeURIComponent(`http://127.0.0.1:${server.port}/callback`)}`
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

  const { slug: explicitSlug, files: remaining } = parsePublishArgs(fileArgs);

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
    } catch (err) {
      console.error(`✗ Cannot read file: ${filename}`);
      process.exit(1);
    }
  }

  // Upload local images and rewrite paths (only for file input, not stdin)
  if (filename) {
    markdown = await uploadAndRewriteImages(markdown, filename);
  }

  // Check for existing mapping (explicit --slug takes precedence)
  let slug = explicitSlug;
  if (!slug && filename) {
    const mappings = readMappings();
    slug = mappings.get(filename) || mappings.get(basename(filename)) || null;
  }

  try {
    let result;
    try {
      result = await publish({ markdown, slug });
    } catch (err) {
      // If the slug was not found, drop the stale mapping and retry as new
      if (slug && err.message && err.message.includes("not found")) {
        console.error(`  Slug "${slug}" no longer exists — publishing as new document.`);
        if (filename) removeMapping(filename);
        result = await publish({ markdown, slug: null });
      } else {
        throw err;
      }
    }

    if (filename) {
      setMapping(filename, result.slug);
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

  if (removeArgs.length === 0) {
    console.error("Usage: jotbird remove <file.md|slug>");
    process.exit(1);
  }

  const target = removeArgs[0];

  // Resolve slug: check .jotbird mapping first, otherwise treat as slug directly
  const mappings = readMappings();
  const slug = mappings.get(target) || mappings.get(basename(target)) || target;

  try {
    await removeDocument(slug);
    removeMapping(target);
    console.log(`\n✓ Removed ${slug}`);
  } catch (err) {
    console.error(`\n✗ Remove failed: ${err.message}`);
    process.exit(1);
  }
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
      console.log(`  ${doc.slug}  ${title}${source}`);
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
  jotbird login                          Authenticate with JotBird
  jotbird publish <file.md>              Publish or update a Markdown/text file
  jotbird publish --slug <slug> <file>   Update an existing document by slug
  jotbird publish                        Read Markdown from stdin
  jotbird remove <file.md|slug>          Permanently delete a document
  jotbird list                           List your published documents
  jotbird help                           Show this help message

Options:
  --slug <slug>   Target a specific document to update. Overrides the
                  .jotbird mapping. Works with both files and stdin.

Examples:
  jotbird publish README.md
  jotbird publish --slug bright-calm-meadow README.md
  echo "# Updated" | jotbird publish --slug bright-calm-meadow
  cat notes.md | jotbird publish
  jotbird remove my-old-post

Files are tracked via a .jotbird mapping file in the current directory.
If a mapping exists, publish updates the existing URL. The --slug flag
overrides the mapping and can be used without a .jotbird file.
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
