import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// A small explicit bundle: other document formats never load the highlighter.
const languages = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
};
const aliases: Record<string, keyof typeof languages> = { js: "javascript", ts: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", htm: "html" };
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;
const pendingLanguages = new Map<string, Promise<void>>();

export async function highlightMarkdownCode(code: string, declaredLanguage: string) {
  const name = declaredLanguage.toLowerCase();
  const language = aliases[name] ?? name;
  if (!Object.hasOwn(languages, language)) return null;
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(), langs: [],
    themes: [import("shiki/themes/light-plus.mjs"), import("shiki/themes/dark-plus.mjs")]
  });
  const instance = await highlighter;
  if (!pendingLanguages.has(language)) {
    pendingLanguages.set(language, instance.loadLanguage(languages[language as keyof typeof languages]()).catch((error) => { pendingLanguages.delete(language); throw error; }));
  }
  await pendingLanguages.get(language);
  return instance.codeToTokensWithThemes(code, { lang: language, themes: { light: "light-plus", dark: "dark-plus" }, tokenizeMaxLineLength: 10_000 });
}
