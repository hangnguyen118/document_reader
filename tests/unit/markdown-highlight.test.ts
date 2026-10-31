import test from "node:test";
import assert from "node:assert/strict";
import { highlightMarkdownCode } from "../../lib/markdown-highlight";

const samples = [
  ["javascript", 'const greeting = "Xin chào";\nconsole.log(greeting);\n'],
  ["typescript", 'const greeting: string = "Xin chào";\n'],
  ["html", '<article class="document">Đọc sách</article>\n'],
  ["css", ".document { color: rebeccapurple; }\n"],
  ["json", '{ "title": "Đọc sách", "ready": true }\n'],
  ["python", 'def greet(name):\n    return f"Chào {name}"\n'],
  ["bash", 'echo "Xin chào"\n']
] as const;

for (const [language, code] of samples) {
  test(`${language} code gets syntax tokens for both themes without altering token text`, async () => {
    const result = await highlightMarkdownCode(code, language);
    assert.ok(result);
    const tokens = result.flat();
    assert.ok(tokens.length > 1);
    assert.ok(new Set(tokens.map((token) => token.variants.light.color)).size > 1);
    assert.ok(new Set(tokens.map((token) => token.variants.dark.color)).size > 1);
    for (const token of tokens) assert.equal(code.slice(token.offset, token.offset + token.content.length), token.content);
  });
}

test("language aliases share supported grammars and unknown languages stay readable as plain code", async () => {
  const code = 'const greeting = "Xin chào";\n';
  const [javascript, alias, upperAlias] = await Promise.all([highlightMarkdownCode(code, "javascript"), highlightMarkdownCode(code, "js"), highlightMarkdownCode(code, "JS")]);
  assert.deepEqual(alias, javascript);
  assert.deepEqual(upperAlias, javascript);
  assert.equal(await highlightMarkdownCode(code, "unrecognized-language"), null);
  assert.equal(await highlightMarkdownCode(code, ""), null);
  assert.equal(await highlightMarkdownCode(code, "mermaid"), null);
});
