export type DocumentType = "PDF" | "TXT" | "DOCX" | "MD";
export type TranslationProvider = "auto" | "browser" | "local";
export type HighlightColor = "yellow" | "green" | "pink";

export interface ReadingDocument {
  id: string;
  title: string;
  type: DocumentType;
  author: string;
  description: string;
  category: string;
  pages: string[];
  wordCount: number;
  uploaded: boolean;
  favorite: boolean;
  currentPage: number;
  createdAt: number;
  lastReadAt: number | null;
  cover: "sage" | "sand" | "rose" | "blue";
}
export interface Highlight {
  id: string;
  documentId: string;
  page: number;
  start: number;
  end: number;
  text: string;
  color: HighlightColor;
  createdAt: number;
}
export interface Note {
  id: string;
  documentId: string;
  page: number;
  quote: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}
export interface VocabularyItem {
  id: string;
  term: string;
  meaning: string;
  context: string;
  documentId: string;
  documentTitle: string;
  page: number;
  createdAt: number;
}
export interface ReaderSettings {
  showDefaultBooks: boolean;
  translationProvider: TranslationProvider;
  speechLanguage: "en-US" | "vi-VN";
  voiceURI: string;
  speechRate: number;
  fontSize: number;
  font: "serif" | "sans";
  lineHeight: number;
  lastDocumentId: string | null;
}
export interface Snapshot {
  documents: ReadingDocument[];
  highlights: Highlight[];
  notes: Note[];
  vocabulary: VocabularyItem[];
  settings: ReaderSettings;
}
export const defaultSettings: ReaderSettings = {
  showDefaultBooks: true,
  translationProvider: "auto", speechLanguage: "en-US", voiceURI: "", speechRate: 1,
  fontSize: 20, font: "serif", lineHeight: 1.9, lastDocumentId: null
};

/** Migrate previously saved cloud provider names to local-only automatic translation. */
export function normalizeTranslationProvider(value: unknown): TranslationProvider {
  return value === "browser" || value === "local" ? value : "auto";
}
