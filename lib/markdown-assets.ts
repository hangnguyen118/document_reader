import { importDocument, MAX_FILE_BYTES } from "./import-document";
import { parseMarkdown } from "./markdown";
import { normalizeAssetPath, resolveMarkdownAssetPath } from "./markdown-path";
import type { DocumentAsset, ReadingDocument } from "./types";

export const MAX_MARKDOWN_FOLDER_FILES = 10_000;
export const MAX_MARKDOWN_ASSETS = 500;
export const MAX_MARKDOWN_ASSET_BYTES = 100 * 1024 * 1024;

export interface MarkdownFolderEntry { file: File; path: string }
export interface MarkdownImportResult { document: ReadingDocument; assets: DocumentAsset[]; warnings: string[] }
interface MarkdownImportOptions {
  markdownPath?: string;
  files?: readonly MarkdownFolderEntry[];
  onProgress?: (message: string) => void;
}

/** Strip the picker wrapper consistently from both Markdown and image paths. */
export function getMarkdownFolderEntries(files: readonly File[]): MarkdownFolderEntry[] {
  if (files.length > MAX_MARKDOWN_FOLDER_FILES) throw new Error("This folder contains too many files. Choose a folder with fewer than 10,000 files.");
  const paths = files.map((file) => file.webkitRelativePath);
  if (paths.some((path) => !path || !normalizeAssetPath(path))) throw new Error("This folder contains an invalid file path. Select the folder again using Upload Markdown folder.");
  const wrapper = paths[0]?.split("/")[0];
  if (paths.some((path) => !path.startsWith(`${wrapper}/`))) throw new Error("Choose one common folder containing your Markdown and images.");
  const seen = new Set<string>();
  return files.map((file, index) => {
    const path = normalizeAssetPath(paths[index].slice(wrapper!.length + 1));
    if (!path) throw new Error("This folder contains an invalid relative file path.");
    if (seen.has(path)) throw new Error(`The folder contains duplicate resource paths: ${path}. Rename the duplicate file before importing.`);
    seen.add(path);
    return { file, path };
  });
}

function matches(bytes: Uint8Array, offset: number, values: readonly number[]) {
  return values.every((value, index) => bytes[offset + index] === value);
}
function ascii(bytes: Uint8Array, offset: number, value: string) {
  return matches(bytes, offset, Array.from(value, (character) => character.charCodeAt(0)));
}

/** Detect bytes rather than trusting the user-controlled extension or MIME. */
function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 24 && matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) && ascii(bytes, 12, "IHDR")) return "image/png";
  if (bytes.length >= 4 && matches(bytes, 0, [255, 216, 255])) return "image/jpeg";
  if (bytes.length >= 10 && (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"))) return "image/gif";
  if (bytes.length >= 16 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  if (bytes.length >= 16 && ascii(bytes, 4, "ftyp")) {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    // Some AVIF encoders use a generic major brand and list avif as a compatible
    // brand. The minor-version integer at offset 12 is not a brand.
    for (let offset = 8; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      if (offset !== 12 && (ascii(bytes, offset, "avif") || ascii(bytes, offset, "avis"))) return "image/avif";
    }
  }
  if (bytes.length >= 26 && ascii(bytes, 0, "BM")) return "image/bmp";
  if (bytes.length >= 6 && matches(bytes, 0, [0, 0, 1, 0]) && (bytes[4] || bytes[5])) return "image/x-icon";
  // SVG is only ever served as a Blob to <img>, never injected as markup.
  // Reject declarations which could load/expand external XML entities.
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart(); }
  catch { return undefined; }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return undefined;
  text = text.replace(/^<\?xml\s[^?]*\?>\s*/u, "");
  while (text.startsWith("<!--")) {
    const end = text.indexOf("-->");
    if (end < 0) return undefined;
    text = text.slice(end + 3).trimStart();
  }
  if (!/^<svg(?:\s|>)/u.test(text)) return undefined;
  if (typeof DOMParser !== "undefined") {
    const xml = new DOMParser().parseFromString(text, "image/svg+xml");
    if (xml.documentElement.localName !== "svg" || xml.documentElement.namespaceURI !== "http://www.w3.org/2000/svg" || xml.getElementsByTagName("parsererror").length) return undefined;
  }
  return "image/svg+xml";
}

export async function importMarkdownWithAssets(file: File, options: MarkdownImportOptions = {}): Promise<MarkdownImportResult> {
  if (!/\.(md|markdown)$/i.test(file.name)) throw new Error("Choose a Markdown (.md or .markdown) file.");
  const markdownPath = normalizeAssetPath(options.markdownPath ?? file.name);
  if (!markdownPath) throw new Error("The Markdown file has an invalid relative path.");
  if ((options.files?.length ?? 0) > MAX_MARKDOWN_FOLDER_FILES) throw new Error("This folder contains too many files. Choose a folder with fewer than 10,000 files.");
  const available = new Map<string, File>();
  for (const entry of options.files ?? []) {
    const path = normalizeAssetPath(entry.path);
    if (!path) throw new Error(`The folder contains an invalid resource path: ${entry.path}.`);
    if (available.has(path)) throw new Error(`The folder contains duplicate resource paths: ${path}.`);
    available.set(path, entry.file);
  }
  options.onProgress?.(`Reading ${file.name}…`);
  const imported = await importDocument(file);
  const model = parseMarkdown(imported.pages.join(""));
  const document = { ...imported, markdownPath, markdownPageCount: model.pages.length };
  const warnings: string[] = [];
  const referenced = new Map<string, File>();
  for (const source of new Set(model.imageSources)) {
    const path = resolveMarkdownAssetPath(markdownPath, source);
    if (!path) { warnings.push(`Unsupported image path: ${source || "(empty path)"}. Images must use relative paths inside the selected folder.`); continue; }
    const resource = available.get(path);
    if (!resource) { warnings.push(`Missing image: ${source}. Use Upload Markdown folder and select the common folder containing the Markdown and its images.`); continue; }
    if (resource.size > MAX_FILE_BYTES) { warnings.push(`Image ${path} is too large (maximum 20 MB per image).`); continue; }
    referenced.set(path, resource);
  }
  if (referenced.size > MAX_MARKDOWN_ASSETS) throw new Error(`This document references too many images. The limit is ${MAX_MARKDOWN_ASSETS} images.`);
  if ([...referenced.values()].reduce((size, resource) => size + resource.size, 0) > MAX_MARKDOWN_ASSET_BYTES) throw new Error("The referenced images exceed the 100 MB limit for one document.");
  const assets: DocumentAsset[] = [];
  let totalBytes = 0;
  let checked = 0;
  for (const [path, resource] of referenced) {
    options.onProgress?.(`Checking image ${++checked} of ${referenced.size}: ${path}…`);
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(await resource.arrayBuffer()); }
    catch { warnings.push(`Image ${path} could not be read. Select the folder again to include this image.`); continue; }
    if (bytes.byteLength > MAX_FILE_BYTES) { warnings.push(`Image ${path} is too large (maximum 20 MB per image).`); continue; }
    const mimeType = imageMime(bytes);
    if (!mimeType) { warnings.push(`Image ${path} is invalid or unsupported. Use PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, or SVG.`); continue; }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_MARKDOWN_ASSET_BYTES) throw new Error("The referenced images exceed the 100 MB limit for one document.");
    const blob = new Blob([bytes], { type: mimeType });
    assets.push({ documentId: document.id, path, blob, mimeType, size: blob.size });
  }
  return { document, assets, warnings };
}
