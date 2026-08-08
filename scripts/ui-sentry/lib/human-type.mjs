// Ports the humanType/settleComposer per-key-jitter concept from
// tmp/stress-test/lib.cjs. Text passed in is always a synthetic fixture
// string (fixtures/tier2-prompts.mjs) or an inert probe string used only to
// confirm the composer accepts and clears typed text (tier 1) — callers
// must never pass anything derived from a live model response.
export async function humanType(page, text, { delayMs = 35 } = {}) {
  await page.click("#conversation-input");
  for (const ch of text) {
    if (ch === "\n") {
      await page.keyboard.press("Shift+Enter");
    } else {
      await page.keyboard.type(ch);
    }
    if (delayMs > 0) {
      await page.waitForTimeout(delayMs * (0.6 + Math.random() * 0.8));
    }
  }
  await settleComposer(page);
}

// Waits until the composer's DOM value stops changing across reads, then
// yields a frame, so a submit dispatched right after reads the fully
// committed draft.
export async function settleComposer(page) {
  let prev = null;
  for (let i = 0; i < 20; i += 1) {
    const value = await page.inputValue("#conversation-input");
    if (value === prev) break;
    prev = value;
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
}
