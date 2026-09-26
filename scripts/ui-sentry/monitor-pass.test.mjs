import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import vm from "node:vm";
import { installMonitorPass, monitorTokenHeader } from "./lib/monitor-pass.mjs";
import { installTurnBudgetGuard } from "./lib/budget-guard.mjs";

const original = process.env.STREETLIGHT_MONITOR_TOKEN;
const token = "synthetic-monitor-secret-".repeat(2);
afterEach(() => {
  if (original === undefined) delete process.env.STREETLIGHT_MONITOR_TOKEN;
  else process.env.STREETLIGHT_MONITOR_TOKEN = original;
});
function harness() {
  const handlers = [], scripts = [];
  const sandbox = { location: { origin: "https://streetlight.help" } };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  // A real page always has these; installMonitorPass's init script now
  // polls for window.turnstile with setInterval rather than trapping the
  // property with a defineProperty getter/setter (5th cross-vendor
  // review, 2026-09-26 — see monitor-pass.mjs's header for why the trap
  // itself broke real Turnstile loading), so this vm sandbox needs them
  // wired to the REAL timers to behave like a real page would.
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  const realm = vm.createContext(sandbox);
  const context = {
    route: async (_pattern, handler) => handlers.push(handler),
    addInitScript: async (fn, arg) => {
      scripts.push(fn.toString());
      vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)})`, realm);
    },
  };
  const page = {
    evaluate: async (fn, arg) => vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)})`, realm),
  };
  async function send({ url = "https://streetlight.help/api/chat", method = "POST" } = {}) {
    let headers = {}, continued = false, aborted = false;
    const request = { url: () => url, method: () => method, headers: () => headers };
    let index = handlers.length;
    const route = {
      fallback: async (options) => {
        headers = options?.headers ?? headers;
        if (index > 0) await handlers[--index](route, request);
        else continued = true;
      },
      continue: async (options) => { headers = options?.headers ?? headers; continued = true; },
      abort: async () => { aborted = true; },
    };
    await route.fallback();
    return { headers, continued, aborted };
  }
  return { context, page, sandbox, scripts, send };
}

test("first turn is real; later opt-in releases client wait and preserves request cap", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  const budget = installTurnBudgetGuard(h.context, 2, undefined, "synthetic-ops", "https://streetlight.help");
  const pass = await installMonitorPass(h.context, "https://streetlight.help");
  let realExecutions = 0, issued;
  h.sandbox.turnstile = {
    render: () => "widget", execute: () => { realExecutions += 1; }, remove: () => {},
  };
  // The wrapping poll (setInterval, 100ms) needs one real tick to notice
  // this assignment and wrap it — a real page always has this much time
  // pass before a second turn happens; a plain unconditional
  // defineProperty trap (the old, since-removed design) wrapped
  // synchronously instead, but broke real Turnstile loading to do it.
  await new Promise((resolve) => setTimeout(resolve, 150));
  h.sandbox.turnstile.render({}, { callback: (value) => { issued = value; } });
  await pass.selectTurn(h.page, 1, true);
  h.sandbox.turnstile.execute("widget");
  assert.equal(realExecutions, 1);
  assert.equal(issued, undefined);
  const first = await h.send();
  assert.equal(first.headers[monitorTokenHeader], undefined);
  assert.equal(first.headers.authorization, "Bearer synthetic-ops");
  await pass.selectTurn(h.page, 2, true);
  h.sandbox.turnstile.execute("widget");
  assert.equal(realExecutions, 1);
  assert.equal(issued, "streetlight-monitor-pass");
  const later = await h.send();
  assert.equal(later.headers[monitorTokenHeader], token);
  assert.equal(later.headers.authorization, "Bearer synthetic-ops");
  assert.equal(later.headers["x-streetlight-synthetic"], "ui-sentry");
  assert.equal((await h.send()).aborted, true);
  assert.equal(budget.used, 3);
  assert.equal(budget.aborted, 1);
  assert.equal(JSON.stringify(h.scripts).includes(token), false);
  assert.equal(JSON.stringify(h.sandbox.__streetlightMonitorPass), "true");
});
test("failed first turn and unselected turns never get the pass", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  const pass = await installMonitorPass(h.context, "https://streetlight.help");
  assert.equal((await h.send()).headers[monitorTokenHeader], undefined);
  await pass.selectTurn(h.page, 2, false);
  assert.equal((await h.send()).headers[monitorTokenHeader], undefined);
  assert.equal(h.sandbox.__streetlightMonitorPass, false);
});
test("credential is confined to chosen same-origin chat POSTs", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  const pass = await installMonitorPass(h.context, "https://streetlight.help");
  await pass.selectTurn(h.page, 2, true);
  for (const options of [
    { url: "https://other.invalid/api/chat" },
    { url: "https://streetlight.help/api/tts" },
    { method: "GET" },
  ]) {
    const result = await h.send(options);
    assert.equal(result.headers[monitorTokenHeader], undefined);
    // The context-setup rule this pass installs must never become a
    // general-purpose blocker (5th cross-vendor review, 2026-09-26):
    // anything that isn't the exact same-origin chat POST it targets is
    // passed straight through (route.fallback(), tracked as `continued`
    // here), never aborted — third-party resources like Turnstile's own
    // api.js must load completely untouched by this route.
    assert.equal(result.continued, true, `must continue() a non-matching request, not block it: ${JSON.stringify(options)}`);
    assert.equal(result.aborted, false);
  }
});
// Anything genuinely third-party (a different origin entirely, like
// Turnstile's own challenges.cloudflare.com) must be just as untouched —
// this route pattern only ever matches a path ending in /api/chat, so a
// script URL never matches it at all, but this asserts that directly
// rather than only by inference.
test("a genuinely third-party request is never touched by the monitor pass's route at all", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  const pass = await installMonitorPass(h.context, "https://streetlight.help");
  await pass.selectTurn(h.page, 2, true);
  const result = await h.send({ url: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", method: "GET" });
  assert.equal(result.continued, true);
  assert.equal(result.aborted, false);
  assert.equal(result.headers[monitorTokenHeader], undefined);
});
for (const value of [undefined, "short"]) {
  test(`missing/short local credential leaves the browser unmodified (${value === undefined ? "missing" : "short"})`, async () => {
    if (value === undefined) delete process.env.STREETLIGHT_MONITOR_TOKEN;
    else process.env.STREETLIGHT_MONITOR_TOKEN = value;
    const h = harness();
    const pass = await installMonitorPass(h.context, "https://streetlight.help");
    await pass.selectTurn(h.page, 2, true);
    assert.equal(h.scripts.length, 0);
    assert.equal((await h.send()).headers[monitorTokenHeader], undefined);
  });
}

// 5th cross-vendor review, 2026-09-26: a live run came back fully blocked
// on every turn, including turn 1 — a zero-spend probe (built exactly
// like tier2's own context) showed the console warning "[Cloudflare
// Turnstile] Turnstile already has been loaded. Was Turnstile imported
// multiple times?" and window.turnstile staying undefined. Root cause:
// the previous version of this file's init script installed
// Object.defineProperty(window, "turnstile", {get, set}) BEFORE any
// navigation. Cloudflare's real api.js checks whether window.turnstile
// already has a property descriptor as its OWN "was I already loaded"
// guard — regardless of what a getter returns — and skips its entire
// initialization when it finds one already there, which our own trap
// always was. Reproduced identically at the very commit that introduced
// this file; not a regression from a later change. This test simulates
// that exact guard (the same check, not just a plain assignment the way
// the OTHER tests in this file and monitor-pass.browser.mjs's fake api.js
// both do — which is exactly why none of them caught this) and proves
// installMonitorPass's init script never trips it, and the real object
// still gets wrapped once it appears.
test("the init script never installs a window.turnstile property descriptor, so a real api.js's own already-loaded guard never trips", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  await installMonitorPass(h.context, "https://streetlight.help");

  // Exactly Cloudflare's own check (confirmed against the real api.js
  // behavior via a live probe): a pre-existing descriptor on
  // window.turnstile — not merely a truthy current value — is treated as
  // proof of a duplicate load, and real initialization is skipped.
  const fixtureApiJs = () => {
    if (Object.getOwnPropertyDescriptor(window, "turnstile")) {
      window.__fixtureAlreadyLoadedGuardTripped = true;
      return;
    }
    window.turnstile = {
      render: (container, options) => {
        window.__fixtureRenderOptions = options;
        return "widget-1";
      },
      execute: () => {
        window.__fixtureRenderOptions?.callback?.("fixture-real-token");
      },
      remove: () => {},
    };
  };
  await h.page.evaluate(fixtureApiJs);

  assert.equal(
    h.sandbox.__fixtureAlreadyLoadedGuardTripped,
    undefined,
    "installMonitorPass must never make a real api.js think Turnstile was already loaded",
  );
  assert.equal(typeof h.sandbox.turnstile, "object");

  // The poll (setInterval, 100ms) needs one real tick to notice the
  // object api.js just assigned and wrap it in place.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.sandbox.turnstile.__streetlightWrapped, true);
  assert.equal(typeof h.sandbox.turnstile.render, "function");
  assert.equal(typeof h.sandbox.turnstile.execute, "function");
});
