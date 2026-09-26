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

// A read-and-think pause between chat turns. Root-caused 2026-09-26: a
// production run (turns logged 14:24:01 -> 14:24:49) sent all 6 tier-2
// fixture turns back to back — no real user reads a reply and composes the
// next question in a few seconds flat, turn after turn, for an entire
// conversation. Turn 1 got a Turnstile token; turns 2-6 all came back
// client_blocked (turn 2 timed out at ~30s waiting for one, turns 3-6 were
// refused in ~3s each) — a pattern consistent with Cloudflare's behavioral
// scoring flagging the same widget/session for firing several challenges
// in under a minute, not with Turnstile being down. This pause only slows
// this sentry's own pacing down to something a reading, typing human would
// actually take; it changes no launch flag, no fingerprint, no launch arg,
// and solves nothing on Turnstile's behalf — it stays inside the
// no-escalation rule in docs/decisions/2026-08-07-...-live-chat-check.md
// (tier2.mjs's CHROMIUM_LAUNCH_ARGS comment) by construction, since it adds
// no evasion technique at all, only realistic timing.
export async function humanPause(page, { minMs = 6000, maxMs = 14000 } = {}) {
  const durationMs = minMs + Math.random() * (maxMs - minMs);
  await page.waitForTimeout(durationMs);
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
