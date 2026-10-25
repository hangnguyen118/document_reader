"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { splitForSpeech } from "@/lib/text";
import { useReading } from "@/components/providers";

export interface SpeechPassage { text: string; page: number; offset?: number }
export function useSpeech() {
  const { settings } = useReading();
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<"idle" | "playing" | "paused">("idle");
  const [position, setPosition] = useState<{ page: number; start: number; end: number } | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    setSupported(true);
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh(); window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => { generation.current++; window.speechSynthesis.cancel(); window.speechSynthesis.removeEventListener("voiceschanged", refresh); };
  }, []);

  const stop = useCallback(() => {
    generation.current++; if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null; setStatus("idle"); setPosition(null);
  }, []);
  const speak = useCallback((passages: SpeechPassage[], onPage?: (page: number) => void, language?: "en-US" | "vi-VN") => {
    stop(); setError("");
    if (!supported) { setError("Text-to-speech is not available in this browser."); return; }
    const lang = language ?? settings.speechLanguage;
    const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    if (voices.length && !matching.length) { setError(`No ${lang.startsWith("vi") ? "Vietnamese" : "English"} voice is installed. Choose another language or add a voice in your device settings.`); return; }
    const chunks = passages.flatMap((passage) => splitForSpeech(passage.text).map((chunk) => ({ ...chunk, start: chunk.start + (passage.offset ?? 0), page: passage.page })));
    if (!chunks.length) { setError("There is no text to read on this page."); return; }
    const token = generation.current;
    const voice = matching.find((item) => item.voiceURI === settings.voiceURI) ?? matching[0];
    setStatus("playing");
    function next(index: number) {
      if (token !== generation.current) return;
      const chunk = chunks[index];
      if (!chunk) { utteranceRef.current = null; setStatus("idle"); setPosition(null); return; }
      onPage?.(chunk.page);
      const utterance = new SpeechSynthesisUtterance(chunk.text); utteranceRef.current = utterance;
      utterance.lang = lang; utterance.rate = settings.speechRate; if (voice) utterance.voice = voice;
      setPosition({ page: chunk.page, start: chunk.start, end: chunk.start + chunk.text.length });
      utterance.onboundary = (event) => {
        if (token !== generation.current) return;
        const length = event.charLength || chunk.text.slice(event.charIndex).match(/^\S+/)?.[0].length || 1;
        setPosition({ page: chunk.page, start: chunk.start + event.charIndex, end: chunk.start + Math.min(chunk.text.length, event.charIndex + length) });
      };
      utterance.onend = () => next(index + 1);
      utterance.onerror = (event) => {
        if (token !== generation.current || event.error === "canceled" || event.error === "interrupted") return;
        setError("This voice could not play. Try a different voice in Settings."); stop();
      };
      window.speechSynthesis.speak(utterance);
    }
    next(0);
  }, [settings.speechLanguage, settings.speechRate, settings.voiceURI, voices, supported, stop]);
  const pause = () => { window.speechSynthesis.pause(); setStatus("paused"); };
  const resume = () => { window.speechSynthesis.resume(); setStatus("playing"); };
  return { supported, voices, status, position, error, speak, stop, pause, resume };
}
