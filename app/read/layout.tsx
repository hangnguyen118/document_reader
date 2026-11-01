"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export default function ReadingLayout({ children, settings }: { children: ReactNode; settings: ReactNode }) {
  const settingsOpen = usePathname() === "/settings";
  const reader = useRef<HTMLDivElement>(null);
  const readingScroll = useRef<{ x: number; y: number; anchor?: { range: Range; top: number; font: string } } | null>(null);

  useLayoutEffect(() => {
    if (settingsOpen) {
      window.scrollTo(0, 0);
      return;
    }
    // Keep scroll local to this reading session, alongside the retained reader.
    // Restore after Next's navigation scroll handling has finished as well.
    const position = readingScroll.current;
    const font = (text: HTMLElement) => {
      const style = window.getComputedStyle(text);
      return `${style.fontFamily} ${style.fontSize} ${style.lineHeight}`;
    };
    const restore = () => {
      if (!position) return;
      const anchor = position.anchor;
      const text = reader.current?.querySelector<HTMLElement>(".reader-text");
      const y = anchor && text?.contains(anchor.range.startContainer) && anchor.font !== font(text)
        ? window.scrollY + anchor.range.getBoundingClientRect().top - anchor.top
        : position.y;
      window.scrollTo(position.x, y);
    };
    restore();
    const frame = window.requestAnimationFrame(restore);
    const remember = () => {
      const position: NonNullable<typeof readingScroll.current> = { x: window.scrollX, y: window.scrollY };
      // A text anchor keeps the visible passage in place when font settings
      // reflow the page. Browsers without caret hit testing keep pixel scroll.
      const text = reader.current?.querySelector<HTMLElement>(".reader-text");
      const bounds = text?.getBoundingClientRect();
      const toolbar = Math.max(0, reader.current?.querySelector(".reader-toolbar")?.getBoundingClientRect().bottom ?? 0);
      if (bounds && bounds.bottom > toolbar && bounds.top < window.innerHeight) {
        const caret = window.document.caretPositionFromPoint?.(bounds.left + 1, Math.max(toolbar + 1, bounds.top + 1));
        if (caret && text?.contains(caret.offsetNode) && caret.offsetNode.nodeType === Node.TEXT_NODE) {
          const range = window.document.createRange();
          range.setStart(caret.offsetNode, caret.offset);
          range.collapse(true);
          position.anchor = { range, top: range.getBoundingClientRect().top, font: font(text) };
        }
      }
      readingScroll.current = position;
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remember);
    };
  }, [settingsOpen]);

  return <><div ref={reader} hidden={settingsOpen}>{children}</div>{settingsOpen && settings}</>;
}
