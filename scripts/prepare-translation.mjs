/** Download pinned Mozilla assets at build/development time, never during translation. */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(projectRoot, "public/translation/mozilla-envi-v1");
const lock = JSON.parse(await readFile(resolve(projectRoot, "scripts/translation-assets.lock.json"), "utf8"));
const verifyOnly = process.argv.includes("--verify");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(assetRoot, { recursive: true });
for (const asset of lock.assets) {
  const destination = resolve(assetRoot, asset.name);
  if (dirname(destination) !== assetRoot) throw new Error(`Invalid asset name: ${asset.name}`);
  try {
    const existing = await readFile(destination);
    if (existing.length === asset.size && hash(existing) === asset.sha256) continue;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (verifyOnly) throw new Error(`Missing or invalid translation asset: ${asset.name}. Run npm run prepare:translation.`);
  console.log(`Preparing local translation: ${asset.name}`);
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${asset.url}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (asset.downloadSha256 && hash(bytes) !== asset.downloadSha256) throw new Error(`Download checksum mismatch: ${asset.name}`);
  if (asset.compression === "zstd") {
    if (typeof zlib.zstdDecompressSync !== "function") throw new Error("Preparing missing translation assets requires Node.js 22.15+ (zstd). Existing verified assets work without decompression.");
    bytes = zlib.zstdDecompressSync(bytes);
  }
  if (bytes.length !== asset.size || hash(bytes) !== asset.sha256) throw new Error(`Asset checksum mismatch: ${asset.name}`);
  await writeFile(`${destination}.partial`, bytes);
  await rename(`${destination}.partial`, destination);
}

const manifest = {
  version: lock.version,
  sourceLanguage: "en",
  targetLanguage: "vi",
  assets: Object.fromEntries(lock.assets.filter((asset) => asset.role).map((asset) => [asset.role, { name: asset.name, size: asset.size, sha256: asset.sha256 }])),
};
const manifestPath = resolve(assetRoot, "manifest.json");
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
if (hash(Buffer.from(manifestText)) !== lock.manifestSha256) throw new Error("Update the pinned manifest SHA-256 in the asset lock and translation worker when changing assets.");
const workerText = await readFile(resolve(projectRoot, "public/translation/translation-worker.js"), "utf8");
if (!workerText.includes(`const MANIFEST_SHA256 = "${lock.manifestSha256}";`) || !workerText.includes(`const VERSION = "${lock.version}";`)) throw new Error("Translation worker version/hash does not match the asset lock.");
if (verifyOnly) {
  if (await readFile(manifestPath, "utf8") !== manifestText) throw new Error("Translation manifest is out of date. Run npm run prepare:translation.");
} else {
  await writeFile(manifestPath, manifestText);
}
console.log(`Verified ${lock.assets.length} local translation assets (${lock.version}).`);
