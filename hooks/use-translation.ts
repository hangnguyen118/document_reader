"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { prepareTranslation, translateText, type TranslationEngine } from "@/lib/translation";
import type { TranslationProvider } from "@/lib/types";

export function useTranslation() {
  const [translation, setTranslation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [engine, setEngine] = useState<TranslationEngine | null>(null);
  const [cached, setCached] = useState(false);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { requestId.current++; controller.current?.abort(); }, []);

  const clear = useCallback(() => {
    requestId.current++; controller.current?.abort();
    setTranslation(""); setError(""); setLoading(false); setStatus(""); setProgress(null); setEngine(null); setCached(false);
  }, []);
  const prepare = useCallback((provider: TranslationProvider = "auto") => { prepareTranslation(provider); }, []);
  const translate = useCallback(async (text: string, provider: TranslationProvider = "auto"): Promise<string | null> => {
    controller.current?.abort();
    const id = ++requestId.current;
    const abort = new AbortController(); controller.current = abort;
    setTranslation(""); setError(""); setLoading(true); setStatus("Preparing translation…"); setProgress(null); setEngine(null); setCached(false);
    try {
      const result = await translateText(text, provider, { signal: abort.signal, onProgress(value) {
        if (id !== requestId.current || abort.signal.aborted) return;
        setStatus(value.message); setProgress(value.progress ?? null);
      } });
      if (id !== requestId.current || abort.signal.aborted) return null;
      setTranslation(result.text); setEngine(result.engine); setCached(result.cached); setStatus(""); setProgress(null);
      return result.text;
    } catch (err) {
      if (id === requestId.current && !abort.signal.aborted) setError(err instanceof Error ? err.message : "Translation is unavailable. Try again or enter a meaning yourself.");
      return null;
    } finally { if (id === requestId.current) setLoading(false); }
  }, []);
  return { translation, error, loading, status, progress, engine, cached, translate, prepare, clear };
}
