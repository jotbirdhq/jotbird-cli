export const ALLOWED_EXTENSIONS = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".text",
]);

export function isAllowedFile(filename) {
  const base = filename.includes("/") ? filename.slice(filename.lastIndexOf("/") + 1) : filename;
  const dotIndex = base.lastIndexOf(".");
  // No extension (e.g. "README") — allow it
  if (dotIndex <= 0) return true;
  const ext = base.slice(dotIndex).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}
