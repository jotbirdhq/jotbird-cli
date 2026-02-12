import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MAPPING_FILE = ".jotbird";

function getMappingPath() {
  return join(process.cwd(), MAPPING_FILE);
}

/**
 * Read the .jotbird mapping file.
 * Returns a Map of filename → slug.
 */
export function readMappings() {
  const path = getMappingPath();
  const map = new Map();
  if (!existsSync(path)) return map;

  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const file = trimmed.slice(0, eqIndex).trim();
    const slug = trimmed.slice(eqIndex + 1).trim();
    if (file && slug) map.set(file, slug);
  }
  return map;
}

/**
 * Write the .jotbird mapping file.
 */
export function writeMappings(map) {
  const path = getMappingPath();
  const lines = [];
  for (const [file, slug] of map) {
    lines.push(`${file} = ${slug}`);
  }
  writeFileSync(path, lines.join("\n") + "\n");
}

/**
 * Update a single mapping and write to disk.
 */
export function setMapping(filename, slug) {
  const map = readMappings();
  map.set(filename, slug);
  writeMappings(map);
}

/**
 * Remove a mapping by filename or slug and write to disk.
 * Returns true if a mapping was removed.
 */
export function removeMapping(filenameOrSlug) {
  const map = readMappings();
  // Try removing by filename first
  if (map.has(filenameOrSlug)) {
    map.delete(filenameOrSlug);
    writeMappings(map);
    return true;
  }
  // Try removing by slug value
  for (const [file, slug] of map) {
    if (slug === filenameOrSlug) {
      map.delete(file);
      writeMappings(map);
      return true;
    }
  }
  return false;
}
