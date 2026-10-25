import { cacheTranslation, cachedTranslation } from "./database";
import { LOCAL_TRANSLATION_VERSION, translateLocal } from "./local-translation";
import type { TranslationProvider } from "./types";

export type TranslationEngine = "browser" | "local";
export interface TranslationProgress {
  stage: "checking" | "downloading" | "loading" | "translating";
  message: string;
  progress?: number;
}
export interface TranslationOptions {
  signal?: AbortSignal;
  onProgress?: (value: TranslationProgress) => void;
}
export interface TranslationResult { text: string; engine: TranslationEngine; cached: boolean }
export class TranslationError extends Error {
  constructor(message: string, public code = "TRANSLATION_FAILED") { super(message); this.name = "TranslationError"; }
}

interface NativeSession {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
}
interface NativeFactory {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string; targetLanguage: string; signal?: AbortSignal;
    monitor?: (monitor: { addEventListener(type: string, callback: (event: { loaded: number; total?: number }) => void): void }) => void;
  }): Promise<NativeSession>;
}
const pair = { sourceLanguage: "en", targetLanguage: "vi" };
let nativeSession: Promise<NativeSession> | undefined;
let nativeFactory: NativeFactory | undefined;
const listeners = new Set<NonNullable<TranslationOptions["onProgress"]>>();
let lastProgress: TranslationProgress | undefined;

function factory(): NativeFactory | undefined {
  const scope = globalThis as unknown as { Translator?: NativeFactory; isSecureContext?: boolean };
  return scope.isSecureContext === false ? undefined : scope.Translator;
}
function aborted(signal?: AbortSignal) { signal?.throwIfAborted(); }
function report(progress: TranslationProgress) {
  lastProgress = progress;
  for (const listener of listeners) {
    try { listener(progress); } catch { /* Observers must not interrupt model cleanup. */ }
  }
}

/** Cancel the wait even if an implementation ignores AbortSignal. */
function waitFor<T>(task: Promise<T>, signal: AbortSignal | undefined, timeout: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { void task.catch(() => {}); reject(signal.reason); return; }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new TranslationError(message, "TIMEOUT")); }, timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    task.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

function getNative(): Promise<NativeSession> {
  const api = factory();
  if (!api) return Promise.reject(new TranslationError("Your browser does not offer on-device translation. Choose Automatic or Downloaded model.", "UNSUPPORTED_BROWSER"));
  if (api !== nativeFactory) { nativeFactory = api; nativeSession = undefined; }
  if (nativeSession) return nativeSession;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TranslationError("The browser language download took too long. Try again or choose Downloaded model.", "TIMEOUT")), 180_000);
  report({ stage: "checking", message: "Checking the browser's English–Vietnamese translator…" });
  const session = (async () => {
    const availability = await waitFor(api.availability(pair), controller.signal, 5_000, "The browser translator did not respond.");
    if (!["available", "downloadable", "downloading"].includes(availability)) {
      throw new TranslationError("English–Vietnamese translation is unavailable in this browser. Choose Automatic or Downloaded model.", "UNSUPPORTED_LANGUAGE");
    }
    // Initialize before slow cache work can consume the user's activation.
    report({ stage: availability === "available" ? "loading" : "downloading", message: availability === "available" ? "Preparing browser translation…" : "Downloading the browser's language pack…" });
    const creation = api.create({ ...pair, signal: controller.signal, monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        const fraction = event.total ? event.loaded / event.total : event.loaded;
        report({ stage: "downloading", message: "Downloading the browser's language pack…", progress: Math.round(Math.min(1, Math.max(0, fraction)) * 100) });
      });
    } });
    void creation.then((value) => { if (controller.signal.aborted) value.destroy?.(); }, () => {});
    return await waitFor(creation, controller.signal, 180_000, "The browser language download took too long.");
  })();
  nativeSession = session;
  void session.catch(() => { if (nativeSession === session) nativeSession = undefined; }).finally(() => clearTimeout(timer));
  return session;
}

/** Call from a click or keystroke; form effects may no longer have user activation. */
export function prepareTranslation(provider: TranslationProvider = "auto"): void {
  if (provider !== "local" && factory()) void getNative().catch(() => {});
}

function cacheKey(engine: TranslationEngine, text: string) {
  // Native model revisions are browser-managed and not exposed by the API.
  const version = engine === "local" ? LOCAL_TRANSLATION_VERSION : "translator-api-v1";
  return `on-device:${engine}:${version}:en:vi:${text}`;
}

async function runEngine(text: string, engine: TranslationEngine, options: TranslationOptions): Promise<TranslationResult> {
  aborted(options.signal);
  let pendingNative: Promise<NativeSession> | undefined;
  const listener = options.onProgress;
  if (engine === "browser") {
    if (listener) { listeners.add(listener); if (lastProgress && nativeSession) listener(lastProgress); }
    pendingNative = getNative();
    void pendingNative.catch(() => {});
  }
  try {
    let cached: string | undefined;
    try { cached = await waitFor(cachedTranslation(cacheKey(engine, text)), options.signal, 1_500, "Translation cache is unavailable."); } catch { aborted(options.signal); }
    aborted(options.signal);
    if (cached?.trim()) return { text: cached, engine, cached: true };
    let output: string;
    if (engine === "browser") {
      const session = await waitFor(pendingNative!, options.signal, 185_000, "The browser translator took too long to prepare.");
      aborted(options.signal);
      options.onProgress?.({ stage: "translating", message: "Translating on your device…" });
      aborted(options.signal);
      const controller = new AbortController();
      const cancel = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", cancel, { once: true });
      try {
        output = await waitFor(session.translate(text, { signal: controller.signal }), options.signal, 30_000, "Browser translation took too long. Try a shorter passage or Downloaded model.");
      } catch (error) {
        controller.abort();
        if (!options.signal?.aborted) { session.destroy?.(); nativeSession = undefined; }
        throw error;
      } finally { options.signal?.removeEventListener("abort", cancel); }
    } else {
      options.onProgress?.({ stage: "loading", message: "Preparing the downloaded English–Vietnamese model…" });
      output = await translateLocal(text, options);
    }
    aborted(options.signal);
    if (typeof output !== "string" || !output.trim()) throw new TranslationError("Translation returned an empty result. Please try again.", "EMPTY_RESULT");
    output = output.trim();
    try { await waitFor(cacheTranslation(cacheKey(engine, text), output), options.signal, 1_500, "Translation cache is unavailable."); } catch { aborted(options.signal); }
    aborted(options.signal);
    return { text: output, engine, cached: false };
  } finally { if (listener) listeners.delete(listener); }
}

export async function translateText(text: string, provider: TranslationProvider = "auto", options: TranslationOptions = {}): Promise<TranslationResult> {
  if (typeof text !== "string" || !text.trim() || text.length > 5_000) throw new TranslationError("Choose between 1 and 5,000 characters to translate.", "INVALID_INPUT");
  if (!["auto", "browser", "local"].includes(provider)) throw new TranslationError("Choose Automatic, Browser translator, or Downloaded model.", "INVALID_PROVIDER");
  aborted(options.signal);
  text = text.trim();
  if (provider === "local") return runEngine(text, "local", options);
  try { return await runEngine(text, "browser", options); }
  catch (error) {
    aborted(options.signal);
    if (provider === "browser") {
      if (error instanceof TranslationError) throw error;
      throw new TranslationError("Browser translation could not start. Click Translate to retry, or choose Automatic to use the downloaded model.", "BROWSER_FAILED");
    }
    options.onProgress?.({ stage: "loading", message: "Switching to the downloaded English–Vietnamese model…" });
    return runEngine(text, "local", options);
  }
}
