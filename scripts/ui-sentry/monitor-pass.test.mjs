import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const handlers = [], scripts = [], routePatterns = [], captureLoadHandlers = [];
  const sandbox = { location: { origin: "https://streetlight.help" } };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  // A real page always has these; installMonitorPass's init script polls
  // for window.turnstile with setInterval as a FALLBACK (5th cross-vendor
  // review, 2026-09-26 — see monitor-pass.mjs's header for why the old
  // defineProperty trap broke real Turnstile loading), so this vm sandbox
  // needs them wired to the REAL timers to behave like a real page would.
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  // Minimal stand-in for document.addEventListener("load", fn, true) —
  // just enough for the init script's capture-phase listener (Astra's
  // review, same day: the poll alone can miss a render() call that
  // happens in the same task api.js finishes loading) to register
  // itself, and for a test to fire it deterministically at the exact
  // point a real <script src> element's own "load" event would — which,
  // by real DOM event ordering, is always BEFORE any listener attached
  // directly to that element (the app's own onload-driven render() call).
  sandbox.document = {
    addEventListener(type, handler, capture) {
      if (type === "load" && capture) captureLoadHandlers.push(handler);
    },
  };
  const realm = vm.createContext(sandbox);
  const context = {
    route: async (pattern, handler) => {
      routePatterns.push(pattern);
      handlers.push(handler);
    },
    addInitScript: async (fn, arg) => {
      scripts.push(fn.toString());
      vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)})`, realm);
    },
  };
  const page = {
    evaluate: async (fn, arg) => vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)})`, realm),
  };
  // Fires every registered capture-phase "load" listener, synchronously,
  // exactly as the browser would the instant the Turnstile <script>
  // element itself finishes loading — before returning control to
  // whatever the app does next (its own onload handler).
  function fireScriptLoadCapture(src = "https://challenges.cloudflare.com/turnstile/v0/api.js") {
    for (const handler of captureLoadHandlers) handler({ target: { src } });
  }
  async function send({ url = "https://streetlight.help/api/chat", method = "POST" } = {}) {
    let headers = {}, continued = false, aborted = false;
    const request = { url: () => url, method: () => method, headers: () => headers };
    // Only handlers whose REGISTERED glob pattern actually matches this
    // URL are reachable at all — Astra's review, 2026-09-26: the previous
    // version of this harness unconditionally invoked whatever handler(s)
    // were registered, regardless of the pattern context.route() was
    // given, so a test here could only ever prove the HANDLER's own
    // internal same-origin/method check, never that a genuinely
    // third-party request (Turnstile's own api.js) is excluded at the
    // routing layer itself, the way real Playwright route matching would
    // be. globToRegExp below is a minimal, faithful-enough translation of
    // Playwright's own glob syntax for this one purpose.
    const matchingIndexes = handlers
      .map((_, i) => i)
      .filter((i) => globToRegExp(routePatterns[i]).test(url));
    if (matchingIndexes.length === 0) {
      return { headers, continued: true, aborted: false, matchedRoute: false };
    }
    let cursor = matchingIndexes.length;
    const route = {
      fallback: async (options) => {
        headers = options?.headers ?? headers;
        if (cursor > 0) await handlers[matchingIndexes[--cursor]](route, request);
        else continued = true;
      },
      continue: async (options) => { headers = options?.headers ?? headers; continued = true; },
      abort: async () => { aborted = true; },
    };
    await route.fallback();
    return { headers, continued, aborted, matchedRoute: true };
  }
  return { context, page, sandbox, scripts, routePatterns, send, fireScriptLoadCapture };
}

// A minimal translation of Playwright's own glob-pattern syntax
// (https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
// into a RegExp — `**` matches anything including `/`, `*` matches
// anything except `/`, everything else is literal. Used only to prove,
// in this fast vm-based harness, whether a given URL would actually
// reach a context.route() handler registered under a given pattern —
// not a general-purpose glob library.
function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        pattern += ".*";
        i += 1;
      } else {
        pattern += "[^/]*";
      }
    } else if (".+?^${}()|[]\\".includes(c)) {
      pattern += `\\${c}`;
    } else {
      pattern += c;
    }
  }
  return new RegExp(`^${pattern}$`);
}

test("first turn is real; later opt-in releases client wait and preserves request cap", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  const budget = installTurnBudgetGuard(h.context, 2, undefined, "synthetic-ops", "https://streetlight.help");
  const pass = await installMonitorPass(h.context, "https://streetlight.help");
  let realExecutions = 0, issued;
  // Reproduces the exact race Astra's review found (2026-09-26): the app
  // can call turnstile.render() in the SAME task api.js finishes loading
  // — before the 100ms poll ever gets a tick. An earlier version of this
  // test waited 150ms before rendering, which hid that race entirely
  // (nothing here is testing the poll's own worst case, only a
  // comfortably-late render). This instead fires the capture-phase load
  // listener FIRST — matching real DOM event order, where a capturing
  // ancestor listener always runs before a listener on the target
  // element itself — then calls render() immediately after, with NO wait
  // at all. Without the capture-phase fix in monitor-pass.mjs, this exact
  // sequence is what silently lost the callback (render ran through the
  // still-unwrapped function, so the callback below is never captured
  // into this module's own map, and turn 2 falls through to a second
  // real execution instead of the pass).
  h.sandbox.turnstile = {
    render: () => "widget", execute: () => { realExecutions += 1; }, remove: () => {},
  };
  h.fireScriptLoadCapture();
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
// Turnstile's own challenges.cloudflare.com) must be just as untouched.
// Astra's review, 2026-09-26: asserting only continued/aborted here
// proves the HANDLER's own same-origin check works, but the harness used
// to invoke that handler unconditionally regardless of what pattern
// context.route() was actually given — so it could never prove a
// third-party request doesn't even reach the routing layer at all, the
// way real Playwright glob matching would exclude it. `matchedRoute`
// (from the harness's own globToRegExp match against the pattern
// installMonitorPass registered) makes that the direct claim instead of
// an inference.
test("a genuinely third-party request never matches this pass's route pattern at all, let alone its header logic", async () => {
  process.env.STREETLIGHT_MONITOR_TOKEN = token;
  const h = harness();
  const pass = await installMonitorPass(h.context, "https://streetlight.help");
  await pass.selectTurn(h.page, 2, true);
  assert.deepEqual(h.routePatterns, ["**/api/chat"]);
  const result = await h.send({ url: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", method: "GET" });
  assert.equal(result.matchedRoute, false, "a Turnstile script URL must not match the **/api/chat pattern at all");
  assert.equal(result.continued, true);
  assert.equal(result.aborted, false);
  assert.equal(result.headers[monitorTokenHeader], undefined);
});
// Playwright caveat, documented rather than silently relied on (Astra's
// review, 2026-09-26): route.fallback()'s header override is scoped to
// the request it's called for, but if THAT request is itself redirected,
// Playwright's own docs note overridden headers can be carried onto the
// redirected request too — which would matter a great deal if the
// destination were cross-origin, since the monitor token would then
// leave this app's own origin. /api/chat is this app's own route
// handler, which never issues a redirect (confirmed by reading
// src/app/api/chat/route.ts: every path returns a Response directly, no
// NextResponse.redirect or 3xx status anywhere in it) — so the header
// this override adds never has a redirect to follow in the first place.
// This asserts that contract stays true rather than leaving it as an
// unchecked assumption.
test("api/chat's own route handler never redirects (the header override this pass adds has nowhere to leak to)", async () => {
  const routeSource = await readFile(
    new URL("../../src/app/api/chat/route.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/NextResponse\.redirect|status:\s*30[1278]/.test(routeSource), false);
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
