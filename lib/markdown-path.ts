const controls = /[\u0000-\u001f\u007f]/u;
const scheme = /^[a-z][a-z\d+.-]*:/i;
const MAX_PATH_LENGTH = 4096;

/** Canonical package key. Picker filenames are literal, never URL-decoded. */
export function normalizeAssetPath(path: string): string | undefined {
  if (!path || path.length > MAX_PATH_LENGTH || controls.test(path) || path.includes("\\") || path.startsWith("/") || scheme.test(path)) return undefined;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined;
  return segments.map((segment) => segment.normalize("NFC")).join("/");
}

/** Resolve a Markdown URL inside the selected package, not against the website. */
export function resolveMarkdownAssetPath(markdownPath: string, source: string): string | undefined {
  const documentPath = normalizeAssetPath(markdownPath);
  if (!documentPath || controls.test(source)) return undefined;
  const url = source.trim();
  if (!url || url.startsWith("/") || url.includes("\\") || scheme.test(url)) return undefined;
  // Split before decoding so %23 and %3F remain filename characters. A plus
  // character is a literal filename character, not form-encoded whitespace.
  const path = url.split(/[?#]/u, 1)[0];
  if (!path || path.length > MAX_PATH_LENGTH) return undefined;
  let segments: string[];
  try { segments = path.split("/").map((segment) => decodeURIComponent(segment).normalize("NFC")); }
  catch { return undefined; }
  if (segments.some((segment) => controls.test(segment) || segment.includes("/") || segment.includes("\\")) || scheme.test(segments[0])) return undefined;
  const resolved = documentPath.split("/").slice(0, -1);
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!resolved.length) return undefined;
      resolved.pop();
    } else resolved.push(segment);
  }
  return normalizeAssetPath(resolved.join("/"));
}
