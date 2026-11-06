import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MARKDOWN_PAGE_TARGET } from "../../lib/markdown";

async function createFolder(testInfo: TestInfo, files: Record<string, string | null>) {
  const folder = testInfo.outputPath("markdown-package");
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(folder, name);
    await mkdir(path.dirname(target), { recursive: true });
    if (content === null) await copyFile(path.resolve("public/images/read_book.png"), target);
    else await writeFile(target, content, "utf8");
  }
  return folder;
}

async function savedAssets(page: Page, id: string) {
  return page.evaluate(async (documentId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const assets = await new Promise<{ path: string; blob: Blob; mimeType: string; size: number }[]>((resolve, reject) => {
        const request = db.transaction("documentAssets").objectStore("documentAssets").index("documentId").getAll(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return assets.map((asset) => ({ path: asset.path, isBlob: asset.blob instanceof Blob, type: asset.blob.type, size: asset.size }));
    } finally { db.close(); }
  }, id);
}

test("folder images resolve exact paths, persist after reload and reopening, and release preview URLs", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const tracker = { created: [] as string[], revoked: [] as string[] };
    (window as unknown as { markdownUrls: typeof tracker }).markdownUrls = tracker;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); tracker.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { tracker.revoked.push(url); revoke(url); };
  });
  const filename = "Hình #1 + 100%.png";
  const openingSentence = "The opening passage gives the illustrations their own reading page. ";
  const source = [
    "# Internal illustrations",
    "",
    `A **formatted** paragraph before the images. ${openingSentence.repeat(Math.ceil(MARKDOWN_PAGE_TARGET / openingSentence.length))}`,
    "",
    '![Root image](./preview.png "Original title")',
    "![Nested image](./images/preview.png)",
    "![Parent image](../assets/diagram.png)",
    `![Encoded image](../assets/${encodeURIComponent(filename)}?version=1#preview)`,
    "![Reference image][illustration]",
    "![Same basename](../assets/preview.png)",
    "![Vector image](./images/diagram.svg)",
    "",
    "[illustration]: ./images/preview.png",
    "",
    "```markdown",
    "![Code example](./never-imported.png)",
    "```",
    ""
  ].join("\n");
  const folder = await createFolder(testInfo, {
    "docs/illustrations.md": source,
    "docs/preview.png": null,
    "docs/images/preview.png": null,
    "assets/diagram.png": null,
    [`assets/${filename}`]: null,
    "assets/preview.png": null,
    "docs/images/diagram.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>',
    "unreferenced.txt": "This file must not be stored."
  });
  const imageRequests: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "image" && !request.url().startsWith("blob:")) imageRequests.push(request.url()); });
  await page.goto("/");
  await page.getByLabel("Upload Markdown folder", { exact: true }).setInputFiles(folder);
  await page.getByRole("link", { name: "Read illustrations", exact: true }).click();
  await expect(page).toHaveURL(/\/read\/[\w-]+$/);
  const readerUrl = page.url();
  const id = new URL(readerUrl).pathname.split("/").pop()!;
  const images = page.locator(".markdown-preview img");
  const currentPage = page.getByRole("combobox", { name: "Current page", exact: true });
  await expect.poll(() => currentPage.locator("option").count()).toBeGreaterThan(1);
  let imagePage = -1;
  const pageCount = await currentPage.locator("option").count();
  for (let index = 0; index < pageCount; index++) {
    await currentPage.selectOption(String(index));
    await expect(currentPage).toHaveValue(String(index));
    if (await page.locator('.markdown-preview img, .markdown-preview [role="img"]').count() === 7) { imagePage = index; break; }
  }
  expect(imagePage).toBeGreaterThan(0);
  const assertLoaded = async () => {
    await expect(images).toHaveCount(7);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("src", /^blob:/);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
    }
  };
  await assertLoaded();
  await expect(page.getByRole("img", { name: "Root image", exact: true })).toHaveAttribute("title", "Original title");
  await expect(page.getByRole("img", { name: "Encoded image", exact: true })).toHaveAttribute("data-markdown-asset", `assets/${filename}`);
  expect(await page.getByRole("img", { name: "Nested image", exact: true }).getAttribute("src")).toEqual(await page.getByRole("img", { name: "Reference image", exact: true }).getAttribute("src"));
  const persisted = await savedAssets(page, id);
  expect(persisted).toHaveLength(6);
  expect(persisted.every((asset) => asset.isBlob && asset.size > 0 && asset.type.startsWith("image/") && !asset.path.startsWith("blob:"))).toBe(true);
  expect(imageRequests).toEqual([]);
  const initialUrls = await images.evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).src));

  await page.reload();
  await expect(currentPage).toHaveValue(String(imagePage));
  await assertLoaded();
  expect(await images.first().getAttribute("src")).not.toBe(initialUrls[0]);
  const currentUrls = [...new Set(await images.evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).src)))];
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await expect.poll(() => page.evaluate((urls) => {
    const tracker = (window as unknown as { markdownUrls: { revoked: string[] } }).markdownUrls;
    return urls.every((url) => tracker.revoked.includes(url));
  }, currentUrls)).toBe(true);
  await page.getByRole("link", { name: "Read illustrations", exact: true }).click();
  await expect(currentPage).toHaveValue(String(imagePage));
  await assertLoaded();
  expect(await savedAssets(page, id)).toEqual(persisted);

  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await page.getByRole("button", { name: "Delete illustrations", exact: true }).click();
  await page.getByRole("button", { name: "Remove document", exact: true }).click();
  await expect(page.getByRole("link", { name: "Read illustrations", exact: true })).toHaveCount(0);
  expect(await savedAssets(page, id)).toEqual([]);
});

test("a lone Markdown file shows missing and unsafe image guidance without network fallback", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (/missing-picture|outside-image|external-image/.test(request.url())) requests.push(request.url()); });
  await page.goto("/");
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({
    name: "missing-images.md", mimeType: "text/markdown", buffer: Buffer.from([
      "# Still readable", "", "A **safe** paragraph.", "",
      "![Missing illustration](./images/missing-picture.png)",
      "![Outside illustration](../outside-image.png)",
      "![External illustration](https://example.com/external-image.png)",
      "![Local machine](file:///C:/outside-image.png)"
    ].join("\n"))
  });
  await expect(page.locator(".markdown-upload-warnings")).toContainText("Missing image");
  await page.getByRole("link", { name: "Read missing images", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Still readable", exact: true })).toBeVisible();
  await expect(page.locator(".markdown-preview strong").filter({ hasText: /^safe$/ })).toBeVisible();
  await expect(page.locator('.markdown-image-placeholder[data-image-state="missing"]')).toHaveCount(1);
  await expect(page.locator('.markdown-image-placeholder[data-image-state="invalid"]')).toHaveCount(3);
  await expect(page.locator(".markdown-asset-notice")).toContainText("Upload Markdown folder");
  await expect(page.locator(".markdown-preview img")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".markdown-image-placeholder")).toHaveCount(4);
  expect(requests).toEqual([]);
});

test("folders with multiple Markdown files allow choosing one and report invalid images", async ({ page }, testInfo) => {
  const folder = await createFolder(testInfo, {
    "README.md": "# Readme that should not be imported",
    "docs/chosen.md": "# Chosen document\n\n![Bad image](../assets/bad.png)\n\n![Good image](../assets/good.png)",
    "assets/bad.png": "This is text, not an image.",
    "assets/good.png": null
  });
  await page.goto("/");
  await page.getByLabel("Upload Markdown folder", { exact: true }).setInputFiles(folder);
  const dialog = page.getByRole("dialog", { name: "Choose a Markdown document" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Markdown document", { exact: true }).selectOption("docs/chosen.md");
  await dialog.getByRole("button", { name: "Import document", exact: true }).click();
  await expect(page.locator(".markdown-upload-warnings")).toContainText("invalid or unsupported");
  await expect(page.getByRole("link", { name: "Read README", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Read chosen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chosen document", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Good image", exact: true })).toHaveAttribute("src", /^blob:/);
  await expect(page.locator('.markdown-image-placeholder[data-image-state="missing"]')).toHaveCount(1);
  expect(await savedAssets(page, new URL(page.url()).pathname.split("/").pop()!)).toHaveLength(1);
});

test("folder selection without Markdown reports an error and still allows a regular upload", async ({ page }, testInfo) => {
  const folder = await createFolder(testInfo, { "images/preview.png": null });
  await page.goto("/");
  await page.getByLabel("Upload Markdown folder", { exact: true }).setInputFiles(folder);
  await expect(page.locator('.inline-error[role="alert"]')).toContainText("no Markdown files");
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({ name: "text-only.md", mimeType: "text/markdown", buffer: Buffer.from("# Text only\n\nStill works.") });
  await page.getByRole("link", { name: "Read text only", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Text only", exact: true })).toBeVisible();
  await expect(page.locator(".markdown-image-placeholder, .markdown-asset-notice")).toHaveCount(0);
});

for (const failure of ["storage", "decode"] as const) {
  test(`an image ${failure} failure keeps Markdown readable`, async ({ page }, testInfo) => {
    const folder = await createFolder(testInfo, { "resilient.md": "# Resilient document\n\nReadable text.\n\n![Illustration](./preview.png)", "preview.png": null });
    await page.goto("/");
    await page.getByLabel("Upload Markdown folder", { exact: true }).setInputFiles(folder);
    const link = page.getByRole("link", { name: "Read resilient", exact: true });
    await expect(link).toBeVisible();
    const id = (await link.getAttribute("href"))!.split("/").pop()!;
    if (failure === "storage") {
      await page.evaluate(() => {
        const getAll = IDBIndex.prototype.getAll;
        IDBIndex.prototype.getAll = function (...args) {
          if (this.objectStore.name === "documentAssets") throw new DOMException("Image storage unavailable", "InvalidStateError");
          return getAll.apply(this, args);
        };
      });
    } else {
      await page.evaluate(async (documentId) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("folio-reading");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("documentAssets", "readwrite");
            const store = tx.objectStore("documentAssets");
            const read = store.get([documentId, "preview.png"]);
            read.onsuccess = () => {
              const blob = new Blob(["invalid image bytes"], { type: "image/png" });
              store.put({ ...read.result, blob, size: blob.size });
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
        } finally { db.close(); }
      }, id);
    }
    await link.click();
    await expect(page.getByRole("heading", { name: "Resilient document", exact: true })).toBeVisible();
    await expect(page.locator(".markdown-image-placeholder")).toContainText(failure === "storage" ? "could not be read" : "could not be displayed");
    if (failure === "storage") {
      await expect(page.locator(".markdown-asset-notice")).toHaveAttribute("role", "alert");
      await page.reload();
      await expect(page.getByRole("img", { name: "Illustration", exact: true })).toHaveAttribute("src", /^blob:/);
      await expect(page.locator(".markdown-image-placeholder")).toHaveCount(0);
    }
  });
}
