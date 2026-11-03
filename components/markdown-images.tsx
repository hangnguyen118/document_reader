"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { ExtraProps } from "hast-util-to-jsx-runtime";
import { loadDocumentAssets } from "@/lib/database";
import { resolveMarkdownAssetPath } from "@/lib/markdown-path";

type ImageStatus = "loading" | "ready" | "error";
interface ImageContextValue {
  markdownPath: string;
  status: ImageStatus;
  urls: ReadonlyMap<string, string>;
}
interface LoadedImages { scope: string; status: ImageStatus; urls: ReadonlyMap<string, string>; session: { active: boolean } }

const emptyUrls: ReadonlyMap<string, string> = new Map();
const ImagesContext = createContext<ImageContextValue>({ markdownPath: "document.md", status: "ready", urls: emptyUrls });

/** Blob URLs belong to this preview session, never to the persisted document. */
export function MarkdownImages({ documentId, markdownPath = "document.md", imageSources, children }: {
  documentId: string;
  markdownPath?: string;
  imageSources: readonly string[];
  children: ReactNode;
}) {
  const paths = useMemo(() => [...new Set(imageSources.flatMap((source) => {
    const path = resolveMarkdownAssetPath(markdownPath, source);
    return path ? [path] : [];
  }))].sort(), [imageSources, markdownPath]);
  const scope = JSON.stringify([documentId, markdownPath, paths]);
  const [loaded, setLoaded] = useState<LoadedImages | null>(null);
  // Hide a previous document's URLs immediately, before its effect is cleaned up.
  const current = loaded?.scope === scope && loaded.session.active ? loaded : null;
  const status = current ? current.status : paths.length ? "loading" : "ready";
  const urls = current ? current.urls : emptyUrls;

  useEffect(() => {
    if (!paths.length) return;
    let cancelled = false;
    const session = { active: true };
    const sessionUrls = new Map<string, string>();
    void loadDocumentAssets(documentId).then((assets) => {
      if (cancelled) return;
      const byPath = new Map(assets.filter((asset) => asset.documentId === documentId).map((asset) => [asset.path, asset]));
      for (const path of paths) {
        const asset = byPath.get(path);
        if (asset) sessionUrls.set(path, URL.createObjectURL(asset.blob));
      }
      setLoaded({ scope, status: "ready", urls: new Map(sessionUrls), session });
    }).catch(() => {
      if (cancelled) return;
      for (const url of sessionUrls.values()) URL.revokeObjectURL(url);
      sessionUrls.clear();
      setLoaded({ scope, status: "error", urls: emptyUrls, session });
    });
    return () => {
      cancelled = true;
      // Returning to a previous page must not reuse its already revoked URLs,
      // even if the next page's pending read never replaced the loaded state.
      session.active = false;
      for (const url of sessionUrls.values()) URL.revokeObjectURL(url);
      sessionUrls.clear();
    };
    // The scope contains the sorted resource paths, so equivalent source aliases
    // do not recreate URLs. Each async request owns exactly its cleanup set.
  }, [documentId, scope]);

  const unavailable = [...new Set(imageSources)].filter((source) => {
    const path = resolveMarkdownAssetPath(markdownPath, source);
    return !path || status === "ready" && !urls.has(path);
  }).length;
  const value = useMemo(() => ({ markdownPath, status, urls }), [markdownPath, status, urls]);

  return <ImagesContext.Provider value={value}>
    {imageSources.length > 0 && (status === "error"
      ? <p className="markdown-asset-notice" role="alert" data-reader-ignore="true">Saved images could not be read from this browser. Reload the page to try again.</p>
      : unavailable > 0
        ? <p className="markdown-asset-notice" role="status" data-reader-ignore="true">{unavailable === 1 ? "An image is" : `${unavailable} images are`} unavailable. Choose <strong>Upload Markdown folder</strong> in the library and select the folder containing the Markdown file and its images.</p>
        : status === "loading" ? <p className="markdown-asset-notice" role="status" data-reader-ignore="true">Loading saved images…</p> : null)}
    {children}
  </ImagesContext.Provider>;
}

export function MarkdownImage({ node, src, alt = "", title }: ExtraProps & ComponentPropsWithoutRef<"img">) {
  const images = useContext(ImagesContext);
  const original = node?.data?.markdownImageSource;
  const source = typeof original === "string" ? original : typeof src === "string" ? src : "";
  const path = resolveMarkdownAssetPath(images.markdownPath, source);
  const url = path ? images.urls.get(path) : undefined;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const invalid = !path;
  const loading = Boolean(path) && images.status === "loading";
  const failed = Boolean(url && failedUrl === url);

  if (url && !failed) return <img src={url} alt={alt} title={title} loading="lazy" decoding="async" data-markdown-asset={path} onError={() => setFailedUrl(url)} />;

  const state = invalid ? "invalid" : loading ? "loading" : failed ? "error" : "missing";
  const reason = invalid ? "This image needs a relative path inside the uploaded folder."
    : loading ? "Loading image…"
      : images.status === "error" ? "Saved image could not be read from this browser."
        : failed ? "This image file could not be displayed."
          : "Image not included. Upload the Markdown folder with its images.";
  // Images can occur inside paragraphs; a span keeps the generated HTML valid.
  // No text-position markers are added, so notices cannot change annotations.
  return <span className="markdown-image-placeholder" role="img" aria-label={alt || "Unavailable image"} aria-description={reason} title={title} data-reader-ignore="true" data-image-state={state}>
    <span className="markdown-image-label">{alt || "Image"}</span>
    <span>{reason}</span>
    {source && <code>{source}</code>}
  </span>;
}
