import "fake-indexeddb/auto";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { deleteDB } from "idb";
import { prepareTranslation, translateText, TranslationError, type TranslationProgress } from "../../lib/translation";
import type { TranslationProvider } from "../../lib/types";

interface NativeSession {
  translate: (text: string, options?: { signal?: AbortSignal }) => Promise<string>;
  destroy?: () => void;
}
interface NativeOptions {
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
  monitor?: (monitor: { addEventListener: (name: string, listener: (event: { loaded: number; total?: number }) => void) => void }) => void;
}
interface NativeAPI {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
  create: (options: NativeOptions) => Promise<NativeSession>;
}
const scope = globalThis as unknown as { Translator?: NativeAPI; isSecureContext?: boolean };
let networkCalls = 0;
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");

beforeEach(async () => {
  await deleteDB("folio-reading");
  delete scope.Translator;
  scope.isSecureContext = true;
  networkCalls = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) === "/translation/translation-worker.js") {
      return new Response("/* Worker behavior is simulated by OfflineWorker below. */", { headers: { "Content-Type": "text/javascript" } });
    }
    networkCalls++;
    throw new Error("Translation must not call a cloud endpoint");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete scope.Translator;
  delete scope.isSecureContext;
  for (const [name, descriptor] of [["window", originalWindow], ["Worker", originalWorker]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  assert.equal(networkCalls, 0);
});

function mockNative(options: {
  availability?: string;
  translate?: NativeSession["translate"];
  create?: NativeAPI["create"];
} = {}) {
  const state = { calls: [] as string[], creates: [] as NativeOptions[], checks: [] as { sourceLanguage: string; targetLanguage: string }[], destroyed: 0 };
  scope.Translator = {
    async availability(pair) { state.checks.push(pair); return options.availability ?? "available"; },
    async create(config) {
      state.creates.push(config);
      if (options.create) return options.create(config);
      return {
        async translate(text, translationOptions) {
          state.calls.push(text);
          return options.translate ? options.translate(text, translationOptions) : "yên tĩnh";
        },
        destroy() { state.destroyed++; }
      };
    }
  };
  return state;
}

function code(expected: string) {
  return (error: unknown) => error instanceof TranslationError && error.code === expected;
}

interface WorkerRequest { id: number; text: string }
type WorkerReply = { id: number; type: "result"; text: string }
  | { id: number; type: "progress"; stage: string; message: string; progress?: number }
  | { id: number; type: "error"; message: string; code: string };
let workerState: {
  requests: WorkerRequest[];
  terminated: number;
  handle: (request: WorkerRequest, worker: OfflineWorker) => void;
};
class OfflineWorker {
  onmessage: ((event: { data: WorkerReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor(url: string) { assert.match(url, /^blob:/, "A retained Blob script allows Worker restarts while offline"); }
  postMessage(request: WorkerRequest) {
    workerState.requests.push(request);
    queueMicrotask(() => workerState.handle(request, this));
  }
  emit(reply: WorkerReply) { this.onmessage?.({ data: reply }); }
  terminate() { workerState.terminated++; }
}

function mockLocalWorker(handle: typeof workerState.handle = (request, worker) => {
  worker.emit({ id: request.id, type: "progress", stage: "downloading", message: "Downloading the local model", progress: 50 });
  worker.emit({ id: request.id, type: "result", text: "bản dịch cục bộ" });
}) {
  workerState = { requests: [], terminated: 0, handle };
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: OfflineWorker });
  return workerState;
}

test("invalid inputs and legacy cloud provider names fail before any work", async () => {
  const state = mockNative();
  for (const value of ["", "   ", "a".repeat(5001), null, 123]) {
    await assert.rejects(() => translateText(value as string, "browser"), code("INVALID_INPUT"));
  }
  for (const provider of ["google", "microsoft", "unknown"]) {
    await assert.rejects(() => translateText("quiet", provider as TranslationProvider), code("INVALID_PROVIDER"));
  }
  assert.equal(state.checks.length, 0);
  assert.equal(state.creates.length, 0);
});

test("browser translation uses the English–Vietnamese pair and trims input and output", async () => {
  const state = mockNative({ translate: async () => "  yên tĩnh  " });
  const result = await translateText("  quiet  ", "browser");
  assert.deepEqual(result, { text: "yên tĩnh", engine: "browser", cached: false });
  assert.deepEqual(state.checks, [{ sourceLanguage: "en", targetLanguage: "vi" }]);
  assert.equal(state.creates[0].sourceLanguage, "en");
  assert.equal(state.creates[0].targetLanguage, "vi");
  assert.deepEqual(state.calls, ["quiet"]);
});

test("successful native results persist and Automatic reuses the same engine's cache", async () => {
  const state = mockNative();
  assert.equal((await translateText("quiet", "browser")).cached, false);
  assert.deepEqual(await translateText(" quiet ", "auto"), { text: "yên tĩnh", engine: "browser", cached: true });
  assert.deepEqual(state.calls, ["quiet"]);
  assert.equal(state.creates.length, 1);
});

test("prepare starts one native session and download progress reaches the caller", async () => {
  const progress: TranslationProgress[] = [];
  let release!: (session: NativeSession) => void;
  const state = mockNative({
    availability: "downloadable",
    create: async (options) => {
      options.monitor?.({ addEventListener(name, listener) {
        assert.equal(name, "downloadprogress");
        listener({ loaded: 0.4 });
        listener({ loaded: 50, total: 100 });
      } });
      return new Promise<NativeSession>((resolve) => { release = resolve; });
    }
  });
  prepareTranslation("browser");
  const translation = translateText("quiet", "browser", { onProgress: (value) => progress.push(value) });
  // Availability and session creation run asynchronously before cache access.
  await new Promise((resolve) => setImmediate(resolve));
  release({ translate: async () => "yên tĩnh" });
  await translation;
  assert.equal(state.creates.length, 1);
  assert.ok(progress.some((event) => event.stage === "downloading" && event.progress === 40));
  assert.ok(progress.some((event) => event.stage === "downloading" && event.progress === 50));
  assert.ok(progress.some((event) => event.stage === "translating"));
});

test("browser-only mode reports missing API and insecure contexts without downloading a fallback", async () => {
  await assert.rejects(() => translateText("quiet", "browser"), code("UNSUPPORTED_BROWSER"));
  const state = mockNative();
  scope.isSecureContext = false;
  await assert.rejects(() => translateText("quiet", "browser"), code("UNSUPPORTED_BROWSER"));
  assert.equal(state.creates.length, 0);
});

test("an unavailable language pair stops before model creation", async () => {
  const state = mockNative({ availability: "unavailable" });
  await assert.rejects(() => translateText("quiet", "browser"), code("UNSUPPORTED_LANGUAGE"));
  assert.equal(state.creates.length, 0);
});

test("failed native creation can be retried from the next user action", async () => {
  let creates = 0;
  mockNative({ create: async () => {
    if (++creates === 1) throw new DOMException("No user activation", "NotAllowedError");
    return { translate: async () => "yên tĩnh" };
  } });
  await assert.rejects(() => translateText("quiet", "browser"), code("BROWSER_FAILED"));
  assert.deepEqual(await translateText("quiet", "browser"), { text: "yên tĩnh", engine: "browser", cached: false });
  assert.equal(creates, 2);
});

test("a failed native session is destroyed and its failed result is never cached", async () => {
  let calls = 0;
  const state = mockNative({ translate: async () => {
    if (++calls === 1) throw new Error("Browser translation process crashed");
    return "yên tĩnh";
  } });
  await assert.rejects(() => translateText("quiet", "browser"), code("BROWSER_FAILED"));
  assert.equal(state.destroyed, 1);
  assert.equal((await translateText("quiet", "browser")).cached, false);
  assert.equal(state.creates.length, 2);
});

test("empty translations fail honestly and can be retried", async () => {
  let calls = 0;
  mockNative({ translate: async () => ++calls === 1 ? "   " : "yên tĩnh" });
  await assert.rejects(() => translateText("quiet", "browser"), code("EMPTY_RESULT"));
  assert.equal((await translateText("quiet", "browser")).cached, false);
  assert.equal(calls, 2);
});

test("cancellation rejects promptly even if native inference ignores the signal", async () => {
  let started!: () => void;
  let finish!: (text: string) => void;
  let signal: AbortSignal | undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  mockNative({ translate: async (_text, options) => {
    signal = options?.signal;
    started();
    return new Promise<string>((resolve) => { finish = resolve; });
  } });
  const controller = new AbortController();
  const pending = translateText("quiet", "auto", { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(signal?.aborted, true);
  finish("late result");
  const state = mockNative({ translate: async () => "fresh result" });
  assert.deepEqual(await translateText("quiet", "browser"), { text: "fresh result", engine: "browser", cached: false });
  assert.deepEqual(state.calls, ["quiet"]);
});

test("a pre-cancelled request does not create a translator", async () => {
  const state = mockNative();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => translateText("quiet", "auto", { signal: controller.signal }), (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(state.creates.length, 0);
});

test("cancelling from translation progress never starts native inference", async () => {
  const controller = new AbortController();
  const state = mockNative({ translate: async () => { throw new Error("Cancelled native inference must not start"); } });
  await assert.rejects(() => translateText("quiet", "auto", {
    signal: controller.signal,
    onProgress(value) { if (value.stage === "translating") controller.abort(); }
  }), (error: unknown) => error instanceof Error && error.name === "AbortError");
  // Flush rejected native promises too, so the runner catches any unhandled work.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.calls, []);
});

test("browser inference times out and destroys a session that stops responding", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const state = mockNative({ translate: async () => {
    started();
    return new Promise<string>(() => {});
  } });
  const pending = translateText("quiet", "browser");
  await ready;
  context.mock.timers.tick(30_001);
  await assert.rejects(pending, code("TIMEOUT"));
  assert.equal(state.destroyed, 1);
});

test("unavailable IndexedDB does not hide a successful translation", async () => {
  const state = mockNative();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")!;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new Error("Storage disabled"); } } });
  try {
    assert.deepEqual(await translateText("quiet", "browser"), { text: "yên tĩnh", engine: "browser", cached: false });
    assert.deepEqual(state.calls, ["quiet"]);
  } finally { Object.defineProperty(globalThis, "indexedDB", descriptor); }
});

test("Automatic falls back to the local Worker when the browser API is missing", async () => {
  const state = mockLocalWorker();
  const progress: TranslationProgress[] = [];
  assert.deepEqual(await translateText("quiet", "auto", { onProgress: (value) => progress.push(value) }), { text: "bản dịch cục bộ", engine: "local", cached: false });
  assert.deepEqual(state.requests.map((request) => request.text), ["quiet"]);
  assert.ok(progress.some((event) => event.stage === "downloading" && event.progress === 50));
  assert.deepEqual(await translateText("quiet", "local"), { text: "bản dịch cục bộ", engine: "local", cached: true });
  assert.equal(state.requests.length, 1);
});

test("Automatic recovers from native inference failure through the local Worker", async () => {
  const native = mockNative({ translate: async () => { throw new Error("Native process unavailable"); } });
  const local = mockLocalWorker();
  assert.deepEqual(await translateText("quiet", "auto"), { text: "bản dịch cục bộ", engine: "local", cached: false });
  assert.deepEqual(native.calls, ["quiet"]);
  assert.equal(native.destroyed, 1);
  assert.deepEqual(local.requests.map((request) => request.text), ["quiet"]);
});

test("a native AbortError without caller cancellation falls back to the local Worker", async () => {
  const controller = new AbortController();
  const native = mockNative({ translate: async () => { throw new DOMException("Native session was destroyed", "AbortError"); } });
  const local = mockLocalWorker();
  assert.deepEqual(await translateText("quiet", "auto", { signal: controller.signal }), { text: "bản dịch cục bộ", engine: "local", cached: false });
  assert.equal(controller.signal.aborted, false);
  assert.equal(native.destroyed, 1);
  assert.deepEqual(native.calls, ["quiet"]);
  assert.deepEqual(local.requests.map((request) => request.text), ["quiet"]);
});

test("explicit local mode skips the browser and keeps each engine's cache separate", async () => {
  const native = mockNative();
  const local = mockLocalWorker();
  assert.equal((await translateText("quiet", "local")).engine, "local");
  assert.equal(native.creates.length, 0);
  assert.deepEqual(await translateText("quiet", "browser"), { text: "yên tĩnh", engine: "browser", cached: false });
  assert.equal(local.requests.length, 1);
  assert.deepEqual(native.calls, ["quiet"]);
});

test("local model download failures remain actionable and the next request can retry", async () => {
  let calls = 0;
  const state = mockLocalWorker((request, worker) => {
    if (++calls === 1) worker.emit({ id: request.id, type: "error", message: "Download failed. Check your connection and retry.", code: "MODEL_DOWNLOAD_FAILED" });
    else worker.emit({ id: request.id, type: "result", text: "yên tĩnh" });
  });
  await assert.rejects(() => translateText("quiet", "local"), (error: unknown) => error instanceof Error && error.message.includes("Check your connection"));
  assert.equal(state.terminated, 1);
  assert.deepEqual(await translateText("quiet", "local"), { text: "yên tĩnh", engine: "local", cached: false });
  assert.equal(state.requests.length, 2);
});

test("cancelling local inference terminates its Worker and does not block the next translation", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const state = mockLocalWorker((request, worker) => {
    if (request.text === "quiet") started();
    else worker.emit({ id: request.id, type: "result", text: "điều kỳ diệu" });
  });
  const controller = new AbortController();
  const pending = translateText("quiet", "local", { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(state.terminated, 1);
  assert.deepEqual(await translateText("wonder", "local"), { text: "điều kỳ diệu", engine: "local", cached: false });
  assert.deepEqual(state.requests.map((request) => request.text), ["quiet", "wonder"]);
});
