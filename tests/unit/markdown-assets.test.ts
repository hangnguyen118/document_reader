import test from "node:test";
import assert from "node:assert/strict";
import { getMarkdownFolderEntries, importMarkdownWithAssets, MAX_MARKDOWN_ASSETS, MAX_MARKDOWN_ASSET_BYTES, MAX_MARKDOWN_FOLDER_FILES } from "../../lib/markdown-assets";
import { normalizeAssetPath, resolveMarkdownAssetPath } from "../../lib/markdown-path";
import { parseMarkdown } from "../../lib/markdown";
import { MAX_FILE_BYTES } from "../../lib/import-document";

const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG0cAAAAASUVORK5CYII=", "base64");
function pickerFile(path: string, content: BlobPart = pngBytes) {
  const file = new File([content], path.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

test("asset keys are literal relative paths with canonical Unicode and no traversal", () => {
  assert.equal(normalizeAssetPath("images/Hình 1 #?+%20.png"), "images/Hình 1 #?+%20.png");
  assert.equal(normalizeAssetPath("images/Ha\u0300.png"), "images/Hà.png");
  for (const path of ["", "/a.png", "//host/a.png", "a\\b.png", "C:/a.png", "file:a.png", "a/../b.png", "./a.png", "a//b.png", "a/", "a\0.png", "a\n.png"]) assert.equal(normalizeAssetPath(path), undefined, path);
});

test("Markdown image resolution handles root siblings, subfolders and parent assets within the package", () => {
  for (const [source, expected] of [
    ["./preview.png", "docs/preview.png"],
    ["./images/preview.png", "docs/images/preview.png"],
    ["../assets/diagram.jpg", "assets/diagram.jpg"],
    ["images/../preview.png", "docs/preview.png"],
    ["../assets/H%C3%ACnh%201.png", "assets/Hình 1.png"],
    ["../assets/a%23b%3Fc%25d+e.png?version=2#preview", "assets/a#b?c%d+e.png"],
    ["../assets/%252e%252e.png", "assets/%2e%2e.png"],
    ["../assets/%2e%2e/preview.png", "preview.png"],
    ["../assets/Ha%CC%80.png", "assets/Hà.png"]
  ]) assert.equal(resolveMarkdownAssetPath("docs/book.md", source), expected, source);
  assert.equal(resolveMarkdownAssetPath("book.md", "preview.png"), "preview.png");
  assert.equal(resolveMarkdownAssetPath("folder%20name/book.md", "a.png"), "folder%20name/a.png");
});

test("image resolution rejects external URLs, machine paths, encoded separators and root escapes", () => {
  for (const source of [
    "", "#anchor", "?version=1", "../../outside.png", "%2e%2e/%2e%2e/outside.png", "../%2E%2E/outside.png",
    "/images/a.png", "//host/a.png", "https://host/a.png", "http://host/a.png", "data:image/png;base64,abc", "blob:https://host/id", "file:///a.png", "C:/a.png", "C:\\a.png",
    "images%2Fa.png", "images/%2Fa.png", "images/%5ca.png", "%00a.png", "%0Aa.png", "javascript%3Aimage.png", "a%ZZ.png", "a%.png", "a\0.png", "images/a\\b.png"
  ]) assert.equal(resolveMarkdownAssetPath("docs/book.md", source), undefined, source);
  assert.equal(resolveMarkdownAssetPath("../book.md", "a.png"), undefined);
});

test("folder entries preserve subfolders and literal filename encodings after stripping one wrapper", () => {
  const files = [pickerFile("My book/docs/book.md", "# Book"), pickerFile("My book/assets/a%20b.png"), pickerFile("My book/assets/a b.png")];
  const entries = getMarkdownFolderEntries(files);
  assert.deepEqual(entries.map((entry) => entry.path), ["docs/book.md", "assets/a%20b.png", "assets/a b.png"]);
  assert.equal(entries[0].file, files[0]);
  assert.deepEqual(getMarkdownFolderEntries([]), []);
});

test("folder entries reject ambiguous canonical names, invalid roots and excessive file counts", () => {
  assert.throws(() => getMarkdownFolderEntries([pickerFile("Root/Hà.png"), pickerFile("Root/Ha\u0300.png")]), /duplicate resource paths/i);
  assert.throws(() => getMarkdownFolderEntries([pickerFile("A/book.md"), pickerFile("B/a.png")]), /common folder/i);
  assert.throws(() => getMarkdownFolderEntries([pickerFile("Root/../a.png")]), /invalid file path/i);
  assert.throws(() => getMarkdownFolderEntries([new File([""], "book.md")]), /Upload Markdown folder/i);
  assert.throws(() => getMarkdownFolderEntries(Array.from({ length: MAX_MARKDOWN_FOLDER_FILES + 1 }, () => pickerFile("Root/a.png"))), /too many files/i);
});

test("parser collects inline and reference images without treating code, links or raw HTML as resources", () => {
  const source = ["# Book", "Before **bold** ![Alt text](./one.png \"Title\") after.", "![Reference][diagram]", "[diagram]: ../assets/two.png", "`![Inline code](./ignored.png)`", "```markdown\n![Fence](./ignored-too.png)\n```", "[Link](./linked.png)", '<img src="./raw.png">'].join("\n\n");
  const model = parseMarkdown(source);
  assert.deepEqual(model.imageSources, ["./one.png", "../assets/two.png"]);
  const parsedAgain = parseMarkdown(source);
  assert.deepEqual(parsedAgain.imageSources, model.imageSources);
  assert.equal(parsedAgain.text, model.text);
  assert.deepEqual(parsedAgain.runs, model.runs);
  assert.deepEqual(parsedAgain.headings, model.headings);
  const paragraph = model.tree.children.find((node) => node.type === "element" && node.tagName === "p");
  assert.ok(paragraph && "children" in paragraph);
  const image = paragraph.children.find((node) => node.type === "element" && node.tagName === "img");
  assert.ok(image && image.type === "element");
  assert.equal(image.data?.markdownImageSource, "./one.png");
  assert.equal(image.properties.alt, "Alt text");
  assert.equal(image.properties.title, "Title");
});

test("folder Markdown imports all exact referenced images once, preserves original source and ignores unused files", async () => {
  const source = "\r\n# Tiếng Việt\r\n\r\n![Root](./preview.png)\r\n\r\n![Sub](./images/preview.png)\r\n\r\n![Parent](../assets/H%C3%ACnh%201.png)\r\n\r\n![Repeat](./preview.png?size=2#view)\r\n\r\n";
  const unused = pickerFile("Root/unused.bin", "not an image");
  Object.defineProperty(unused, "arrayBuffer", { value: () => { throw new Error("Must not read unreferenced files"); } });
  const files = [pickerFile("Root/docs/book.md", source), pickerFile("Root/docs/preview.png"), pickerFile("Root/docs/images/preview.png"), pickerFile("Root/assets/Hình 1.png"), unused];
  const entries = getMarkdownFolderEntries(files);
  const progress: string[] = [];
  const result = await importMarkdownWithAssets(files[0], { markdownPath: "docs/book.md", files: entries, onProgress: (message) => progress.push(message) });
  assert.deepEqual(result.document.pages, [source]);
  assert.equal(result.document.markdownPath, "docs/book.md");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.assets.map((asset) => asset.path), ["docs/preview.png", "docs/images/preview.png", "assets/Hình 1.png"]);
  for (const asset of result.assets) {
    assert.equal(asset.documentId, result.document.id);
    assert.equal(asset.mimeType, "image/png");
    assert.equal(asset.blob.type, "image/png");
    assert.equal(asset.size, pngBytes.length);
    assert.deepEqual(Buffer.from(await asset.blob.arrayBuffer()), pngBytes);
  }
  assert.match(progress[0], /Reading book.md/);
  assert.ok(progress.some((message) => message.includes("Checking image")));
});

test("single Markdown uploads remain readable and warn about missing, invalid and external resources", async () => {
  const source = "# Book\n\n![Missing](./missing.png)\n\n![Wrong](../../outside.png)\n\n![Remote](https://example.com/image.png)\n\n![Duplicate](./missing.png)";
  const result = await importMarkdownWithAssets(new File([source], "book.md"));
  assert.deepEqual(result.document.pages, [source]);
  assert.equal(result.document.markdownPath, "book.md");
  assert.deepEqual(result.assets, []);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /Missing image.*missing.png.*Upload Markdown folder/);
  assert.match(result.warnings[1], /Unsupported image path/);
  assert.match(result.warnings[2], /Unsupported image path/);
  assert.deepEqual((await importMarkdownWithAssets(new File(["# Plain"], "book.md"))).warnings, []);
  assert.deepEqual((await importMarkdownWithAssets(new File([""], "book.md"))).document.pages, [""]);
});

test("invalid, oversized or unreadable images warn without dropping the Markdown or valid images", async () => {
  const oversized = new File([pngBytes], "large.png");
  Object.defineProperty(oversized, "size", { value: MAX_FILE_BYTES + 1 });
  const unreadable = new File([pngBytes], "unreadable.png");
  Object.defineProperty(unreadable, "arrayBuffer", { value: async () => { throw new Error("Read failure"); } });
  const source = "![OK](ok.png)\n\n![Broken](broken.png)\n\n![Large](large.png)\n\n![Read](unreadable.png)";
  const result = await importMarkdownWithAssets(new File([source], "book.md"), { files: [
    { path: "ok.png", file: new File([pngBytes], "ok.png", { type: "application/octet-stream" }) },
    { path: "broken.png", file: new File(["<html>Not a PNG</html>"], "broken.png", { type: "image/png" }) },
    { path: "large.png", file: oversized }, { path: "unreadable.png", file: unreadable }
  ] });
  assert.equal(result.document.pages[0], source);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].mimeType, "image/png");
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings.join(" "), /invalid or unsupported/);
  assert.match(result.warnings.join(" "), /too large/);
  assert.match(result.warnings.join(" "), /could not be read/);
});

test("import supports SVG as an image Blob and rejects non-SVG markup and external XML declarations", async () => {
  const source = "![SVG](diagram.svg)\n\n![XML](entity.svg)\n\n![HTML](fake.svg)";
  const svg = '<?xml version="1.0"?>\n<!-- diagram -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>';
  const result = await importMarkdownWithAssets(new File([source], "book.md"), { files: [
    { path: "diagram.svg", file: new File([svg], "diagram.svg") },
    { path: "entity.svg", file: new File(['<!DOCTYPE svg SYSTEM "https://outside.example/entity"><svg />'], "entity.svg") },
    { path: "fake.svg", file: new File(['<html><svg xmlns="http://www.w3.org/2000/svg" /></html>'], "fake.svg") }
  ] });
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].mimeType, "image/svg+xml");
  assert.equal(await result.assets[0].blob.text(), svg);
  assert.equal(result.warnings.length, 2);
});

test("imports reject ambiguous paths and oversized image collections before reading assets", async () => {
  const file = new File([pngBytes], "a.png");
  await assert.rejects(importMarkdownWithAssets(new File(["![A](a.png)"], "book.md"), { files: [{ path: "a.png", file }, { path: "a.png", file }] }), /duplicate resource paths/i);
  await assert.rejects(importMarkdownWithAssets(new File(["# Book"], "book.md"), { markdownPath: "../book.md" }), /invalid relative path/i);
  await assert.rejects(importMarkdownWithAssets(new File(["# Book"], "book.md"), { files: [{ path: "../a.png", file }] }), /invalid resource path/i);
  await assert.rejects(importMarkdownWithAssets(new File(["# Book"], "book.txt")), /Choose a Markdown/i);
  const tooMany = Array.from({ length: MAX_MARKDOWN_ASSETS + 1 }, (_, index) => ({ path: `${index}.png`, file }));
  await assert.rejects(importMarkdownWithAssets(new File([tooMany.map(({ path }) => `![Image](${path})`).join("\n\n")], "book.md"), { files: tooMany }), /too many images/i);
  const imageFiles = Array.from({ length: 6 }, (_, index) => {
    const image = new File([pngBytes], `${index}.png`);
    Object.defineProperty(image, "size", { value: MAX_MARKDOWN_ASSET_BYTES / 5 });
    Object.defineProperty(image, "arrayBuffer", { value: () => { throw new Error("Should reject before reading"); } });
    return { path: image.name, file: image };
  });
  await assert.rejects(importMarkdownWithAssets(new File([imageFiles.map(({ path }) => `![Image](${path})`).join("\n\n")], "book.md"), { files: imageFiles }), /100 MB limit/i);
});
