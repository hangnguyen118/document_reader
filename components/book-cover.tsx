import { BookOpen, Leaf, Sparkles, Sunrise, Waves } from "lucide-react";
import type { ReadingDocument } from "@/lib/types";

const symbols = { sage: Leaf, sand: Sunrise, blue: Waves, rose: Sparkles };
export function BookCover({ document, compact = false }: { document: ReadingDocument; compact?: boolean }) {
  const Symbol = symbols[document.cover];
  return <div className={`book-cover cover-${document.cover} ${compact ? "compact" : ""}`} aria-hidden="true"><span className="cover-rule" /><span className="cover-edition">FOLIO READINGS · {document.type}</span><span className="cover-title">{document.title}</span><div className="cover-art"><span className="cover-orbit orbit-one" /><span className="cover-orbit orbit-two" /><Symbol size={compact ? 29 : 40} strokeWidth={1.1} /></div><span className="cover-footer"><BookOpen size={11} />{document.uploaded ? "YOUR PERSONAL LIBRARY" : "A MOMENT OF PERSPECTIVE"}</span></div>;
}
