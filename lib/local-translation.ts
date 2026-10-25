/** The model hash is part of the result-cache namespace; bump it with asset changes. */
export const LOCAL_TRANSLATION_VERSION = "mozilla-envi-04fa6044-bergamot-4.0";

export interface LocalTranslationProgress {
  stage: "checking" | "downloading" | "loading" | "translating";
  message: string;
  progress?: number;
}

export class LocalTranslationError extends Error {
  constructor(message: string, public code = "LOCAL_TRANSLATION_FAILED") {
    super(message);
    this.name = "LocalTranslationError";
  }
}

interface TranslationTask {
  id: number;
  text: string;
  signal?: AbortSignal;
  onProgress?: (progress: LocalTranslationProgress) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
  settled: boolean;
  stage?: LocalTranslationProgress["stage"];
  progress?: number;
  timer?: ReturnType<typeof setTimeout>;
  overallTimer?: ReturnType<typeof setTimeout>;
}

type WorkerReply = ({ id: number; type: "progress" } & LocalTranslationProgress)
  | { id: number; type: "result"; text: string }
  | { id: number; type: "error"; message: string; code?: string };

const stageTimeouts = { checking: 15_000, downloading: 120_000, loading: 60_000, translating: 45_000 };
let translationWorker: Worker | undefined;
let workerObjectUrl: string | undefined;
let workerSource: Promise<string> | undefined;
let activeTask: TranslationTask | undefined;
let nextId = 0;
const queue: TranslationTask[] = [];

function resetWorker() {
  translationWorker?.terminate();
  translationWorker = undefined;
  if (workerObjectUrl) URL.revokeObjectURL(workerObjectUrl);
  workerObjectUrl = undefined;
}

function settle(task: TranslationTask, error?: Error, text?: string) {
  if (task.settled) return;
  task.settled = true;
  clearTimeout(task.timer);
  clearTimeout(task.overallTimer);
  task.signal?.removeEventListener("abort", task.onAbort);
  if (activeTask === task) activeTask = undefined;
  if (error) task.reject(error);
  else task.resolve(text!);
  queueMicrotask(pump);
}

function reportProgress(task: TranslationTask, update: LocalTranslationProgress) {
  // A stream of download progress must not extend the absolute stage deadline.
  if (task.stage !== update.stage || (update.stage === "translating" && (update.progress ?? 0) > (task.progress ?? 0))) {
    task.stage = update.stage;
    clearTimeout(task.timer);
    task.timer = setTimeout(() => {
      resetWorker();
      const messages = {
        checking: "The offline translator did not respond. Please try again.",
        downloading: "Downloading the offline translator timed out. Check your connection and retry.",
        loading: "Loading the offline translator timed out. Try again or enter a meaning manually.",
        translating: "Offline translation took too long on this device. Try a shorter selection or enter a meaning manually.",
      };
      settle(task, new LocalTranslationError(messages[update.stage], `LOCAL_${update.stage.toUpperCase()}_TIMEOUT`));
    }, stageTimeouts[update.stage]);
  }
  task.progress = update.progress;
  // An observer must not interrupt task cleanup or prevent a result being delivered.
  try { task.onProgress?.(update); } catch { /* UI observers are optional. */ }
}

async function getWorker(): Promise<Worker> {
  if (translationWorker) return translationWorker;
  // Keep the bootstrap source in this page so an aborted Worker can be restarted
  // without a connection. The rest of the versioned assets live in Cache Storage.
  workerSource ??= fetch("/translation/translation-worker.js", { signal: AbortSignal.timeout(15_000) })
    .then(async (response) => {
      if (!response.ok) throw new LocalTranslationError("The offline translator files are unavailable. Please reload the page and retry.", "LOCAL_ASSETS_MISSING");
      return response.text();
    }).catch((error) => { workerSource = undefined; throw error; });
  const source = await workerSource;
  if (translationWorker) return translationWorker;
  workerObjectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(workerObjectUrl);
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (translationWorker !== worker) return;
    if (workerObjectUrl) URL.revokeObjectURL(workerObjectUrl);
    workerObjectUrl = undefined;
    const reply = event.data;
    const task = activeTask;
    if (!task || reply?.id !== task.id) return;
    if (reply.type === "progress" && reply.stage in stageTimeouts) {
      reportProgress(task, { stage: reply.stage, message: reply.message, ...(typeof reply.progress === "number" ? { progress: Math.max(0, Math.min(100, reply.progress)) } : {}) });
    } else if (reply.type === "result") {
      if (typeof reply.text === "string" && reply.text.trim()) settle(task, undefined, reply.text.trim());
      else {
        resetWorker();
        settle(task, new LocalTranslationError("The offline translator returned an empty result. You can enter a meaning manually.", "LOCAL_EMPTY_RESULT"));
      }
    } else if (reply.type === "error") {
      resetWorker();
      settle(task, new LocalTranslationError(reply.message, reply.code));
    }
  };
  const onWorkerError = () => {
    if (translationWorker !== worker) return;
    const task = activeTask;
    resetWorker();
    if (task) settle(task, new LocalTranslationError("The offline translator stopped unexpectedly. Please retry or enter a meaning manually.", "LOCAL_WORKER_FAILED"));
  };
  worker.onerror = onWorkerError;
  worker.onmessageerror = onWorkerError;
  translationWorker = worker;
  return worker;
}

function pump() {
  if (activeTask) return;
  let task: TranslationTask | undefined;
  do { task = queue.shift(); } while (task?.settled);
  if (!task) return;
  activeTask = task;
  task.overallTimer = setTimeout(() => {
    resetWorker();
    settle(task!, new LocalTranslationError("Offline translation took too long on this device. Try a shorter selection or enter a meaning manually.", "LOCAL_TOTAL_TIMEOUT"));
  }, 300_000);
  reportProgress(task, { stage: "checking", message: "Checking the offline translator…" });
  void getWorker().then((worker) => {
    if (activeTask === task && !task!.settled) worker.postMessage({ id: task!.id, text: task!.text });
  }).catch((error) => {
    if (activeTask !== task || task!.settled) return;
    resetWorker();
    settle(task!, error instanceof LocalTranslationError ? error : new LocalTranslationError("This browser could not start the offline translator. Connect to the website and retry, or enter a meaning manually.", "LOCAL_WORKER_FAILED"));
  });
}

/** Serialize inference in one reusable Worker so that the reader's UI stays responsive. */
export function translateLocal(
  text: string,
  options: { signal?: AbortSignal; onProgress?: (progress: LocalTranslationProgress) => void } = {},
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Translation cancelled.", "AbortError"));
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    return Promise.reject(new LocalTranslationError("Offline translation requires a browser with WebAssembly and Web Workers.", "LOCAL_UNSUPPORTED"));
  }
  const input = text.trim();
  if (!input || input.length > 5_000) return Promise.reject(new LocalTranslationError("Select between 1 and 5,000 characters to translate.", "LOCAL_INVALID_INPUT"));
  return new Promise((resolve, reject) => {
    const task: TranslationTask = {
      id: ++nextId, text: input, signal: options.signal, onProgress: options.onProgress,
      resolve, reject, settled: false,
      onAbort() {
        // WASM inference is synchronous inside its Worker; termination interrupts it.
        if (activeTask === task) resetWorker();
        settle(task, new DOMException("Translation cancelled.", "AbortError"));
      },
    };
    options.signal?.addEventListener("abort", task.onAbort, { once: true });
    queue.push(task);
    pump();
  });
}
