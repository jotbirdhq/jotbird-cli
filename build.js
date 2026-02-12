// Simple build: copy src/ to dist/ with shebang preserved.
// No bundler needed — the CLI uses only Node built-ins.

import { mkdirSync, copyFileSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

mkdirSync("dist", { recursive: true });

for (const file of readdirSync("src")) {
  copyFileSync(join("src", file), join("dist", file));
}

// Make the entry point executable
chmodSync("dist/cli.js", 0o755);

console.log("Build complete → dist/");
