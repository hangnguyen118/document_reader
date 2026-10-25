import { expect, test, type Page } from "@playwright/test";
import { selectText } from "./helpers";

interface NativeState {
  calls: string[];
  finished: string[];
  creates: number;
  resolve: (text: string, translation: string) => void;
}

async function nativeTranslator(page: Page, deferred: string[] = []) {
  await page.addInitScript(({ deferred }) => {
    const pending = new Map<string, (translation: string) => void>();
    const state = {
      calls: [] as string[], finished: [] as string[], creates: 0,
      resolve(text: string, translation: string) {
        const resolve = pending.get(text);
        if (!resolve) throw new Error(`No pending translation for ${text}`);
        pending.delete(text); resolve(translation);
      }
    };
    (window as unknown as { nativeState: typeof state }).nativeState = state;
    Object.defineProperty(window, "Translator", { configurable: true, value: {
      availability: async () => "available",
      create: async () => {
        state.creates++;
        return {
          async translate(text: string) {
            state.calls.push(text);
            const result = deferred.includes(text)
              ? await new Promise<string>((resolve) => pending.set(text, resolve))
              : ({ quiet: "yên tĩnh", wonder: "điều kỳ diệu", attention: "sự chú ý" }[text] ?? `Bản dịch: ${text}`);
            state.finished.push(text);
            return result;
          },
          destroy() {}
        };
      }
    } });
  }, { deferred });
}

async function nativeCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { nativeState: NativeState }).nativeState.calls);
}

async function resolveNative(page: Page, text: string, translation: string) {
  await page.evaluate(({ text, translation }) => {
    (window as unknown as { nativeState: NativeState }).nativeState.resolve(text, translation);
  }, { text, translation });
}

// Write the persisted setting, including pre-migration values, through IndexedDB.
// This exercises the same upgrade path as an existing user's browser data.
async function storedProvider(page: Page, provider: string) {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await page.evaluate(async (provider) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("folio-reading", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("settings", "readwrite");
        const store = transaction.objectStore("settings");
        const preferences = store.get("preferences");
        preferences.onsuccess = () => store.put({ ...preferences.result, translationProvider: provider }, "preferences");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, provider);
}

function translationNetworkCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/translate(?:\?|$)|translation\.googleapis\.com|cognitive\.microsofttranslator\.com/.test(request.url())) calls.push(request.url());
  });
  return calls;
}

test("selected words translate locally, save their meaning, and reuse persistent cache", async ({ page }) => {
  await nativeTranslator(page);
  const network = translationNetworkCalls(page);
  await page.goto("/read/attention");
  await expect(page.getByTestId("reader-text")).toContainText("quiet");
  await selectText(page, "quiet");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".translation-source")).toHaveText("quiet");
  await expect(page.locator(".translation-result")).toHaveText("yên tĩnh");
  await page.getByRole("button", { name: "Save to vocabulary", exact: true }).click();
  await expect(page.getByLabel("English word or phrase", { exact: true })).toHaveValue("quiet");
  await expect(page.getByLabel("Vietnamese meaning", { exact: true })).toHaveValue("yên tĩnh");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await nativeCalls(page)).toEqual(["quiet"]);

  await page.reload();
  await expect(page.getByTestId("reader-text")).toContainText("quiet");
  await selectText(page, "quiet");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.locator(".translation-result")).toHaveText("yên tĩnh");
  expect(await nativeCalls(page)).toEqual([]);
  expect(network).toEqual([]);
});

test("a word selected with a real mouse double-click translates from the selection toolbar", async ({ page }) => {
  await nativeTranslator(page);
  await page.goto("/read/attention");
  const reader = page.getByTestId("reader-text");
  await expect(reader).toContainText("quiet");
  await reader.scrollIntoViewIfNeeded();
  const point = await reader.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = node.textContent?.indexOf("quiet") ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + 5);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error("The sample word was not found");
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.locator(".translation-source")).toHaveText("quiet");
  await expect(page.locator(".translation-result")).toHaveText(/\S/);
  expect(await nativeCalls(page)).toEqual(["quiet"]);
});

test("saving a selected word fills its meaning automatically", async ({ page }) => {
  await nativeTranslator(page);
  await page.goto("/read/attention");
  await expect(page.getByTestId("reader-text")).toContainText("quiet");
  await selectText(page, "quiet");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByLabel("Vietnamese meaning", { exact: true })).toHaveValue("yên tĩnh");
  expect(await nativeCalls(page)).toEqual(["quiet"]);
});

test("automatic meaning never overwrites a manual edit while a translation is pending", async ({ page }) => {
  await nativeTranslator(page, ["quiet"]);
  await page.goto("/vocabulary");
  await page.getByRole("button", { name: "Add a word", exact: true }).click();
  await page.getByLabel("English word or phrase", { exact: true }).fill("quiet");
  await expect.poll(() => nativeCalls(page)).toEqual(["quiet"]);
  const meaning = page.getByLabel("Vietnamese meaning", { exact: true });
  await meaning.fill("bình yên — nghĩa do tôi chọn");
  await resolveNative(page, "quiet", "yên tĩnh");
  await expect.poll(() => page.evaluate(() => (window as unknown as { nativeState: NativeState }).nativeState.finished)).toEqual(["quiet"]);
  await expect(meaning).toHaveValue("bình yên — nghĩa do tôi chọn");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.locator(".word-meaning")).toHaveText("bình yên — nghĩa do tôi chọn");
});

test("a delayed reply for an old term cannot replace the current term's meaning", async ({ page }) => {
  await nativeTranslator(page, ["quiet", "wonder"]);
  await page.goto("/vocabulary");
  await page.getByRole("button", { name: "Add a word", exact: true }).click();
  const term = page.getByLabel("English word or phrase", { exact: true });
  const meaning = page.getByLabel("Vietnamese meaning", { exact: true });
  await term.fill("quiet");
  await expect.poll(() => nativeCalls(page)).toEqual(["quiet"]);
  await term.fill("wonder");
  await expect.poll(() => nativeCalls(page)).toEqual(["quiet", "wonder"]);
  await resolveNative(page, "wonder", "điều kỳ diệu");
  await expect(meaning).toHaveValue("điều kỳ diệu");
  await resolveNative(page, "quiet", "yên tĩnh");
  await expect.poll(() => page.evaluate(() => (window as unknown as { nativeState: NativeState }).nativeState.finished)).toEqual(["wonder", "quiet"]);
  await expect(term).toHaveValue("wonder");
  await expect(meaning).toHaveValue("điều kỳ diệu");
});

test("an unsupported browser shows an actionable error and still saves manual meanings", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "Translator", { configurable: true, value: undefined }));
  const network = translationNetworkCalls(page);
  await storedProvider(page, "browser");
  await page.goto("/vocabulary");
  await page.getByRole("button", { name: "Add a word", exact: true }).click();
  await page.getByLabel("English word or phrase", { exact: true }).fill("quiet");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/browser|Chrome|Edge/i);
  await page.getByLabel("Vietnamese meaning", { exact: true }).fill("yên tĩnh");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.locator(".word-meaning")).toHaveText("yên tĩnh");
  expect(network).toEqual([]);
});

for (const legacyProvider of ["google", "microsoft"]) {
  test(`legacy ${legacyProvider} settings migrate to automatic local translation`, async ({ page }) => {
    await nativeTranslator(page);
    const network = translationNetworkCalls(page);
    await storedProvider(page, legacyProvider);
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: /Automatic/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Browser translator/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Downloaded model/ })).toBeVisible();
    await expect(page.locator("#translation")).not.toContainText(/credentials|Google Translate|Microsoft Translator/);
    await page.goto("/read/attention");
    await expect(page.getByTestId("reader-text")).toContainText("quiet");
    await selectText(page, "quiet");
    await page.getByRole("button", { name: "Translate", exact: true }).click();
    await expect(page.getByLabel("Translation provider", { exact: true })).toHaveValue("auto");
    await expect(page.locator(".translation-result")).toHaveText("yên tĩnh");
    expect(network).toEqual([]);
  });
}

for (const nativeMode of ["missing", "failure"] as const) {
  test(`real downloaded model handles ${nativeMode} native translation and new text while offline`, async ({ page, context }) => {
    test.skip(!process.env.FOLIO_REAL_TRANSLATION, "Opt in to the model download/inference smoke with FOLIO_REAL_TRANSLATION=1.");
    test.setTimeout(180_000);
    await page.addInitScript(({ nativeMode }) => {
      const state = window as unknown as { nativeFailures: number };
      state.nativeFailures = 0;
      Object.defineProperty(window, "Translator", { configurable: true, value: nativeMode === "missing" ? undefined : {
        availability: async () => "available",
        create: async () => ({
          async translate() { state.nativeFailures++; throw new Error("Native inference failed"); },
          destroy() {}
        })
      } });
    }, { nativeMode });
    const network = translationNetworkCalls(page);
    await page.goto("/vocabulary");
    await page.getByRole("button", { name: "Add a word", exact: true }).click();
    const term = page.getByLabel("English word or phrase", { exact: true });
    const meaning = page.getByLabel("Vietnamese meaning", { exact: true });
    await term.fill("Hello, how are you?");
    await expect(meaning).toHaveValue(/chào|khỏe|bạn/i, { timeout: 120_000 });
    if (nativeMode === "failure") expect(await page.evaluate(() => (window as unknown as { nativeFailures: number }).nativeFailures)).toBeGreaterThan(0);

    // Use a new input so an offline pass requires actual inference, not result-cache reuse.
    await context.setOffline(true);
    await term.fill("I love reading books.");
    await expect(meaning).toHaveValue(/đọc|sách|yêu|thích/i, { timeout: 45_000 });
    expect(network).toEqual([]);
  });
}
