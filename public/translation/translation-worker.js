/* Folio's browser-only adapter for Mozilla/Bergamot (MPL-2.0).
 * Inference/model configuration follows Mozilla's translations-engine.worker.js:
 * https://github.com/mozilla-firefox/firefox/blob/2c8de06acae0a9edcbd1e0e49f951a0cbfe427a2/toolkit/components/translations/content/translations-engine.worker.js
 * This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * A copy is supplied at ./mozilla-envi-v1/LICENSE. */
"use strict";

const VERSION = "mozilla-envi-04fa6044-bergamot-4.0";
const MANIFEST_SHA256 = "18a6ae35004f3900c1711eeecc0a9e770247e1807161a6fadb77370905815bf0";
// The bootstrap may be a same-origin Blob so it can restart after connectivity
// disappears. Resolve assets against the website origin, never the blob path.
const BASE = new URL("/translation/mozilla-envi-v1/", self.location.origin);
const CACHE_NAME = `folio-translation-assets-${VERSION}`;
let engine;
let activeId;

function progress(stage, message, value) {
  self.postMessage({ id: activeId, type: "progress", stage, message, ...(value === undefined ? {} : { progress: value }) });
}

function failure(message, code) { return Object.assign(new Error(message), { code }); }

async function digest(bytes) {
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function initialize() {
  progress("checking", "Checking the offline translator…");
  if (typeof WebAssembly !== "object" || !self.crypto?.subtle) {
    throw failure("Offline translation requires WebAssembly and a secure connection (HTTPS).", "LOCAL_UNSUPPORTED");
  }
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch { /* HTTP caching remains available when persistent storage is blocked. */ }
  const manifestUrl = new URL("manifest.json", BASE);
  let manifestBytes;
  try {
    const cached = await cache?.match(manifestUrl);
    if (cached) {
      const candidate = await cached.arrayBuffer();
      if (await digest(candidate) === MANIFEST_SHA256) manifestBytes = candidate;
      else await cache.delete(manifestUrl);
    }
  } catch { /* Fetch a fresh manifest if persistent storage fails. */ }
  if (!manifestBytes) {
    let response;
    try { response = await fetch(manifestUrl, { signal: AbortSignal.timeout(15_000) }); }
    catch (error) {
      throw failure(error.name === "TimeoutError" ? "Checking the offline translator timed out. Please retry." : "The offline translator is not downloaded yet. Connect to the website and retry.", error.name === "TimeoutError" ? "LOCAL_CHECKING_TIMEOUT" : "LOCAL_DOWNLOAD_FAILED");
    }
    if (!response.ok) throw failure("The offline translator files are unavailable. Please retry after the site finishes updating.", "LOCAL_ASSETS_MISSING");
    manifestBytes = await response.arrayBuffer();
    if (await digest(manifestBytes) !== MANIFEST_SHA256) throw failure("Offline translator versions do not match. Reload the page and retry.", "LOCAL_VERSION_MISMATCH");
    try { await cache?.put(manifestUrl, new Response(manifestBytes)); } catch { /* Caching is optional. */ }
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.version !== VERSION) throw failure("Offline translator versions do not match. Reload the page and retry.", "LOCAL_VERSION_MISMATCH");
  const parts = ["glue", "wasm", "model", "lex", "vocab"];
  const total = parts.reduce((sum, part) => sum + manifest.assets[part].size, 0);
  let completed = 0;
  const reportBytes = (amount) => {
    completed += amount;
    progress("downloading", "Preparing the offline English–Vietnamese translator…", Math.min(100, Math.round(completed / total * 100)));
  };
  progress("downloading", "Preparing the offline English–Vietnamese translator…", 0);
  const buffers = {};
  // Sequential downloads limit peak memory and let a cancelled request stop promptly.
  for (const part of parts) {
    const asset = manifest.assets[part];
    const url = new URL(asset.name, BASE);
    if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) throw failure("Invalid offline asset path.", "LOCAL_ASSETS_INVALID");
    let bytes;
    if (cache) {
      try {
        const cached = await cache.match(url);
        if (cached) {
          const candidate = await cached.arrayBuffer();
          if (candidate.byteLength === asset.size && await digest(candidate) === asset.sha256) bytes = candidate;
          else await cache.delete(url);
        }
      } catch { /* Retry from the same-origin website when a cache read fails. */ }
    }
    if (bytes) reportBytes(bytes.byteLength);
    else {
      let downloaded = 0;
      try {
        const result = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!result.ok) throw failure("An offline translation file is missing. Please retry after the site finishes updating.", "LOCAL_ASSETS_MISSING");
        if (result.body) {
          const output = new Uint8Array(asset.size);
          const reader = result.body.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (downloaded + value.byteLength > output.byteLength) throw failure("An offline translation file has an unexpected size.", "LOCAL_ASSET_INTEGRITY");
              output.set(value, downloaded);
              downloaded += value.byteLength;
              reportBytes(value.byteLength);
            }
          } finally { reader.releaseLock(); }
          bytes = output.buffer;
        } else {
          bytes = await result.arrayBuffer();
          downloaded = bytes.byteLength;
          reportBytes(downloaded);
        }
        if (downloaded !== asset.size || await digest(bytes) !== asset.sha256) throw failure("An offline translation file is damaged. Reload the page and retry.", "LOCAL_ASSET_INTEGRITY");
      } catch (error) {
        if (error.name === "TimeoutError") throw failure("Downloading the offline translator timed out. Check your connection and retry.", "LOCAL_DOWNLOADING_TIMEOUT");
        if (error.code) throw error;
        throw failure("The offline translator could not be downloaded. Check your connection and retry.", "LOCAL_DOWNLOAD_FAILED");
      }
      // Cache only verified bytes. Quota/private-mode failures must not break translation.
      try { await cache?.put(url, new Response(bytes)); } catch { /* Continue without persistent caching. */ }
    }
    buffers[part] = bytes;
  }

  progress("loading", "Loading the offline English–Vietnamese translator…");
  // Execute the verified, cached glue so that a new engine can initialize when
  // connectivity disappears after the page has loaded. No eval/new Function.
  const glueUrl = URL.createObjectURL(new Blob([buffers.glue], { type: "text/javascript" }));
  try { importScripts(glueUrl); } finally { URL.revokeObjectURL(glueUrl); }
  delete buffers.glue;
  let bergamot;
  await new Promise((resolve, reject) => {
    bergamot = loadBergamot({
      INITIAL_MEMORY: 40 * 1024 * 1024,
      print() {},
      printErr() {},
      wasmBinary: buffers.wasm,
      onRuntimeInitialized() { queueMicrotask(resolve); },
      onAbort() { reject(failure("This device could not load the offline translator. Try again or enter a meaning manually.", "LOCAL_LOADING_FAILED")); },
    });
  });
  const memories = {};
  const vocabList = new bergamot.AlignedMemoryList();
  for (const [part, alignment] of [["model", 256], ["lex", 64], ["vocab", 64]]) {
    const memory = new bergamot.AlignedMemory(buffers[part].byteLength, alignment);
    memory.getByteArrayView().set(new Uint8Array(buffers[part]));
    memories[part] = memory;
    delete buffers[part];
  }
  delete buffers.wasm;
  vocabList.push_back(memories.vocab);
  const config = [
    "beam-size: 1", "normalize: 1.0", "word-penalty: 0", "max-length-break: 128",
    "mini-batch-words: 256", "workspace: 128", "max-length-factor: 2.0",
    "skip-cost: true", "cpu-threads: 0", "quiet: true", "quiet-translation: true",
    "gemm-precision: int8shiftAlphaAll", "alignment: soft",
  ].join("\n");
  const model = new bergamot.TranslationModel("en", "vi", config, memories.model, memories.lex, vocabList, null);
  const service = new bergamot.BlockingService({ cacheSize: 0 });
  // Keep the backing aligned buffers alive with the model until the Worker is terminated.
  return { bergamot, model, service, memories, vocabList };
}

function translate(text) {
  const { bergamot, model, service } = engine;
  const messages = new bergamot.VectorString();
  const options = new bergamot.VectorResponseOptions();
  let responses;
  let response;
  try {
    messages.push_back(text);
    options.push_back({ qualityScores: false, alignment: false, html: false });
    responses = service.translate(model, messages, options);
    response = responses.get(0);
    return response.getTranslatedText().trim();
  } finally {
    response?.delete();
    responses?.delete();
    options.delete();
    messages.delete();
  }
}

function chunks(text) {
  // Preserve the whole selection. Prefer sentence/word boundaries and keep each
  // inference call small enough for modest devices; never cut a surrogate pair.
  const sentences = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text), (item) => item.segment)
    : [text];
  const result = [];
  for (const sentence of sentences) {
    let remaining = sentence;
    while (remaining.length > 500) {
      let cut = remaining.lastIndexOf(" ", 500);
      if (cut < 200) cut = 500;
      if (/[\uD800-\uDBFF]/.test(remaining[cut - 1])) cut--;
      result.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    if (remaining.trim()) result.push(remaining);
  }
  return result;
}

self.onmessage = async ({ data }) => {
  if (activeId !== undefined) return;
  activeId = data.id;
  try {
    if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 5_000) throw failure("Select between 1 and 5,000 characters to translate.", "LOCAL_INVALID_INPUT");
    engine ??= await initialize();
    progress("translating", "Translating on this device…", 0);
    const selections = chunks(data.text);
    const results = [];
    for (let index = 0; index < selections.length; index++) {
      results.push(translate(selections[index]));
      progress("translating", "Translating on this device…", Math.round((index + 1) / selections.length * 100));
      // Yield so later chunks can deliver progress and keep cancellation timely.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const text = results.join(" ").trim();
    if (!text) throw failure("The offline translator returned an empty result.", "LOCAL_EMPTY_RESULT");
    self.postMessage({ id: activeId, type: "result", text });
  } catch (error) {
    self.postMessage({ id: activeId, type: "error", code: error.code || "LOCAL_TRANSLATION_FAILED", message: error.code ? error.message : "Offline translation failed on this device. Try again or enter a meaning manually." });
  } finally { activeId = undefined; }
};
