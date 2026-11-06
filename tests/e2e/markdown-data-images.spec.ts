import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { markdownDataImages as images } from "../fixtures/markdown-data-images";

async function uploadMarkdown(page: Page, source: string, name: string) {
  await page.goto("/");
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({ name: `${name}.md`, mimeType: "text/markdown", buffer: Buffer.from(source) });
  await page.getByRole("link", { name: `Read ${name.replace(/-/g, " ")}`, exact: true }).click();
  await expect(page.locator(".markdown-preview")).toBeVisible();
}

async function expectDecoded(image: Locator) {
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
}

test("embedded raster formats render in headings, paragraphs, lists, quotes and reference table cells, then survive reload", async ({ page }) => {
  const source = [
    `# Embedded images ![Heading PNG](${images.png} "Original image title")`,
    `A **formatted** paragraph with ![Paragraph JPEG](${images.jpeg}).`,
    `- An animated illustration ![List GIF](${images.gif})`,
    `> A quoted illustration ![Quote WebP](${images.webp})`,
    "| Reference illustration | Meaning |\n| --- | --- |\n| ![Table AVIF][avif] | Still readable |",
    `[avif]: ${images.avif}`
  ].join("\n\n");
  const requests: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "image" && /^https?:/.test(request.url())) requests.push(request.url()); });
  await uploadMarkdown(page, source, "embedded-formats");
  await expect(page.locator(".markdown-preview img")).toHaveCount(5);
  await expect(page.locator(".markdown-asset-notice, .markdown-image-placeholder, .markdown-upload-warnings")).toHaveCount(0);
  const expected = [
    ["h1 img", images.png, "Heading PNG"],
    ["p img", images.jpeg, "Paragraph JPEG"],
    ["li img", images.gif, "List GIF"],
    ["blockquote img", images.webp, "Quote WebP"],
    ["td img", images.avif, "Table AVIF"]
  ];
  const assertImages = async () => {
    for (const [selector, sourceUrl, alt] of expected) {
      const image = page.locator(`.markdown-preview ${selector}`).and(page.getByRole("img", { name: alt, exact: true }));
      await expect(image).toHaveAttribute("src", sourceUrl);
      await expectDecoded(image);
      expect(await image.evaluate((node) => [(node as HTMLImageElement).naturalWidth, (node as HTMLImageElement).naturalHeight])).toEqual([32, 16]);
    }
  };
  await assertImages();
  await expect(page.getByRole("img", { name: "Heading PNG", exact: true })).toHaveAttribute("title", "Original image title");
  await expect(page.locator(".markdown-preview strong")).toHaveText("formatted");
  await expect(page.locator(".markdown-preview td").last()).toContainText("Still readable");

  const animated = page.getByRole("img", { name: "List GIF", exact: true });
  const firstFrame = await animated.screenshot({ animations: "allow" });
  await expect.poll(async () => !(await animated.screenshot({ animations: "allow" })).equals(firstFrame), { message: "The embedded GIF continues animating" }).toBe(true);

  await page.reload();
  await assertImages();
  await expect(page.locator(".markdown-asset-notice, .markdown-image-placeholder")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("malformed and unsupported data images keep alt fallbacks and cannot enable active content or data links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.markdownAttack=true"/>').toString("base64");
  const source = [
    "# Readable despite broken images",
    "A **safe** paragraph.",
    "![Invalid Base64](data:image/png;base64,not!base64)",
    "![Unsupported SVG](data:image/svg+xml;base64," + svg + ")",
    "![Missing encoding](data:image/png,AAAA)",
    "![Corrupt pixels](data:image/png;base64,AAAA)",
    "![Empty source]()",
    `[Data link](${images.png})`,
    "[HTML data link](data:text/html;base64,PHNjcmlwdD4=)",
    '<img src="x" onerror="window.markdownAttack=true">',
    "<script>window.markdownAttack=true</script>"
  ].join("\n\n");
  await uploadMarkdown(page, source, "broken-embedded-images");
  await expect(page.getByRole("heading", { name: "Readable despite broken images", exact: true })).toBeVisible();
  await expect(page.locator(".markdown-preview strong").filter({ hasText: /^safe$/ })).toHaveText("safe");
  for (const alt of ["Invalid Base64", "Unsupported SVG", "Missing encoding", "Corrupt pixels", "Empty source"]) {
    const fallback = page.getByRole("img", { name: alt, exact: true });
    await fallback.scrollIntoViewIfNeeded();
    await expect(fallback).toHaveClass("markdown-image-placeholder");
    await expect(fallback).toContainText(alt);
  }
  await expect(page.locator(".markdown-preview img, .markdown-preview script, .markdown-preview svg")).toHaveCount(0);
  await expect(page.locator(".markdown-preview a").filter({ hasText: /^Data link$/ })).not.toHaveAttribute("href");
  await expect(page.locator(".markdown-preview a").filter({ hasText: /^HTML data link$/ })).not.toHaveAttribute("href");
  expect(await page.evaluate(() => (window as unknown as { markdownAttack?: boolean }).markdownAttack)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("large embedded images keep their full source, responsive ratio and original Markdown without separate stored assets", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const sourceUrl = `data:image/png;base64,${(await readFile("public/images/read_book.png")).toString("base64")}`;
  expect(sourceUrl.length).toBeGreaterThan(250_000);
  const source = `# Large illustration\n\nBefore the picture.\n\n![Large illustration](${sourceUrl})\n\nAfter the picture.`;
  await uploadMarkdown(page, source, "large-embedded-image");
  const image = page.getByRole("img", { name: "Large illustration", exact: true });
  await expect(image).toHaveAttribute("src", sourceUrl);
  await expectDecoded(image);
  const dimensions = await image.evaluate((node) => {
    const image = node as HTMLImageElement;
    const bounds = image.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, maxWidth: getComputedStyle(image).maxWidth, container: image.closest(".markdown-preview")!.getBoundingClientRect().width };
  });
  expect(dimensions.maxWidth).toBe("100%");
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.container + 1);
  expect(dimensions.width).toBeLessThan(dimensions.naturalWidth);
  expect(dimensions.width / dimensions.height).toBeCloseTo(dimensions.naturalWidth / dimensions.naturalHeight, 2);
  await expect(page.locator(".markdown-preview")).toContainText("After the picture.");
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const stored = await page.evaluate(async (documentId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const document = await new Promise<{ pages: string[] }>((resolve, reject) => {
        const request = db.transaction("documents").objectStore("documents").get(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const assetCount = await new Promise<number>((resolve, reject) => {
        const request = db.transaction("documentAssets").objectStore("documentAssets").index("documentId").count(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { pages: document.pages, assetCount };
    } finally { db.close(); }
  }, id);
  expect(stored).toEqual({ pages: [source], assetCount: 0 });
  await page.reload();
  await expect(image).toHaveAttribute("src", sourceUrl);
  await expectDecoded(image);
});

test("embedded and folder images share a preview while embedded images remain independent of local storage failures", async ({ page }, testInfo) => {
  const source = [
    "# Mixed image sources",
    `![Embedded illustration](${images.png})`,
    "![Local illustration](./images/local.png)",
    "![Corrupt embedded illustration](data:image/png;base64,AAAA)",
    "The document stays readable."
  ].join("\n\n");
  const folder = testInfo.outputPath("mixed-images");
  await mkdir(path.join(folder, "images"), { recursive: true });
  await writeFile(path.join(folder, "mixed-images.md"), source, "utf8");
  await writeFile(path.join(folder, "images/local.png"), Buffer.from(images.png.slice(images.png.indexOf(",") + 1), "base64"));
  await page.goto("/");
  await page.getByLabel("Upload Markdown folder", { exact: true }).setInputFiles(folder);
  await page.getByRole("link", { name: "Read mixed images", exact: true }).click();

  const embedded = page.getByRole("img", { name: "Embedded illustration", exact: true });
  const local = page.getByRole("img", { name: "Local illustration", exact: true });
  const corrupt = page.getByRole("img", { name: "Corrupt embedded illustration", exact: true });
  await expect(embedded).toHaveAttribute("src", images.png);
  await expect(local).toHaveAttribute("src", /^blob:/);
  await expect(local).toHaveAttribute("data-markdown-asset", "images/local.png");
  await expectDecoded(embedded);
  await expectDecoded(local);
  await corrupt.scrollIntoViewIfNeeded();
  await expect(corrupt).toContainText("could not be displayed");
  await expect(page.locator(".markdown-asset-notice, .markdown-upload-warnings")).toHaveCount(0);

  const id = new URL(page.url()).pathname.split("/").pop()!;
  const assetPaths = await page.evaluate(async (documentId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const assets = await new Promise<{ path: string }[]>((resolve, reject) => {
        const request = db.transaction("documentAssets").objectStore("documentAssets").index("documentId").getAll(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return assets.map((asset) => asset.path);
    } finally { db.close(); }
  }, id);
  expect(assetPaths).toEqual(["images/local.png"]);

  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await page.evaluate(() => {
    const getAll = IDBIndex.prototype.getAll;
    IDBIndex.prototype.getAll = function (...args) {
      if (this.objectStore.name === "documentAssets") throw new DOMException("Image storage unavailable", "InvalidStateError");
      return getAll.apply(this, args);
    };
  });
  await page.getByRole("link", { name: "Read mixed images", exact: true }).click();
  await expect(embedded).toHaveAttribute("src", images.png);
  await expectDecoded(embedded);
  await expect(local).toContainText("could not be read from this browser");
  await corrupt.scrollIntoViewIfNeeded();
  await expect(corrupt).toContainText("could not be displayed");
  await expect(page.locator('.markdown-asset-notice[role="alert"]')).toContainText("Saved images could not be read");
  await expect(page.locator(".markdown-preview")).toContainText("The document stays readable.");
});
