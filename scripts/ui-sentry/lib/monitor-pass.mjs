// Install AFTER the budget guard but BEFORE creating/navigating the page.
// No token is ever passed to browser JavaScript. Do not enable tracing/HAR.
export const monitorTokenHeader = "x-streetlight-monitor-token";

export async function installMonitorPass(context, baseUrl) {
  const token = process.env.STREETLIGHT_MONITOR_TOKEN?.trim();
  const configured = Boolean(token && Buffer.byteLength(token, "utf8") >= 32);
  const origin = new URL(baseUrl).origin;
  let enabled = false;

  if (configured) {
    // The client otherwise withholds the POST when Turnstile does not issue
    // a token. Capture callbacks without altering real first-turn execution.
    //
    // Root cause of a live run that came back fully blocked on every turn,
    // including turn 1 (5th cross-vendor review, 2026-09-26 — found with a
    // zero-spend probe that builds this exact context and reports
    // typeof window.turnstile after 10s): this used to install an
    // Object.defineProperty(window, "turnstile", {get, set}) trap BEFORE
    // any navigation. Cloudflare's own api.js checks for a PRE-EXISTING
    // property descriptor on window.turnstile as its own "was I already
    // loaded" guard — regardless of what a getter returns — and when it
    // finds one, it logs "[Cloudflare Turnstile] Turnstile already has
    // been loaded. Was Turnstile imported multiple times?" and skips its
    // own initialization entirely. window.turnstile never actually became
    // the real widget object at all, for any turn, in either browser
    // engine tier 2 uses. Reproduced identically at the very commit that
    // introduced this file — this was never a working design, not a
    // regression from a later change, even though it happened not to
    // trip on an earlier live run. Fixed by never touching the
    // window.turnstile property descriptor ourselves: wrap the real
    // object's own render/execute/remove methods IN PLACE, once it
    // actually exists, via plain polling — a plain property read is
    // invisible to api.js's descriptor check, unlike defineProperty.
    await context.addInitScript(({ origin }) => {
      if (location.origin !== origin || window !== window.top) return;
      const callbacks = new Map();
      window.__streetlightMonitorPass = false;

      function wrap(api) {
        if (!api || api.__streetlightWrapped) return;
        const render = typeof api.render === "function" ? api.render.bind(api) : null;
        const execute = typeof api.execute === "function" ? api.execute.bind(api) : null;
        const remove = typeof api.remove === "function" ? api.remove.bind(api) : null;
        if (render) {
          api.render = (container, options) => {
            const id = render(container, options);
            callbacks.set(id, options.callback);
            return id;
          };
        }
        if (execute) {
          api.execute = (id, ...args) => {
            if (window.__streetlightMonitorPass && callbacks.has(id)) {
              callbacks.get(id)("streetlight-monitor-pass");
              return;
            }
            return execute(id, ...args);
          };
        }
        if (remove) {
          api.remove = (id) => {
            callbacks.delete(id);
            return remove(id);
          };
        }
        api.__streetlightWrapped = true;
      }

      if (window.turnstile) {
        wrap(window.turnstile);
        return;
      }

      // Astra's review, 2026-09-26: the 100ms poll alone has a real gap —
      // the app can call turnstile.render() (capturing that widget's
      // callback into ITS OWN closure, not ours) in the same task api.js
      // finishes loading, before the next poll tick ever runs. Once that
      // happens, THAT widget's callback is permanently missed: wrapping
      // render() later never recovers a call that already happened.
      // A capture-phase "load" listener on document fires the instant the
      // <script src="...turnstile.../api.js"> element itself finishes
      // loading — which is after api.js has fully executed (so
      // window.turnstile already exists) but, by DOM event ordering,
      // BEFORE any onload handler attached directly to that same script
      // element (the app's own render() call almost certainly lives in
      // one of those) ever runs: a capturing listener on an ancestor
      // always fires before a target-phase listener on the element
      // itself. This wraps synchronously at that exact moment, closing
      // the race outright rather than shrinking the poll interval.
      document.addEventListener("load", (event) => {
        const src = event.target?.src;
        if (typeof src === "string" && src.includes("challenges.cloudflare.com/turnstile") && window.turnstile) {
          wrap(window.turnstile);
        }
      }, true);

      // Kept as a fallback for anything the load listener could miss (a
      // dynamically inserted script with no traditional load event, a
      // proxied/renamed URL, or window.turnstile arriving some other way)
      // — never the primary mechanism any more. Bounded well past any
      // realistic load time so a page that never gets the real widget at
      // all doesn't leave a timer running forever.
      let attempts = 0;
      const intervalId = setInterval(() => {
        attempts += 1;
        if (window.turnstile) {
          wrap(window.turnstile);
          clearInterval(intervalId);
        } else if (attempts >= 200) {
          clearInterval(intervalId);
        }
      }, 100);
    }, { origin });

    // Playwright caveat (Astra's review, 2026-09-26, pre-existing —
    // documented here rather than left an unchecked assumption): this
    // origin/pathname check governs which request the header override is
    // ADDED to, but if that specific request were itself redirected,
    // Playwright's own docs note the overridden headers can carry onto
    // the redirected request too, regardless of ITS destination. That
    // would matter if /api/chat ever redirected somewhere cross-origin —
    // it never does (src/app/api/chat/route.ts returns a Response
    // directly on every path, no 3xx anywhere), which
    // monitor-pass.test.mjs asserts directly rather than only assuming.
    await context.route("**/api/chat", async (route, request) => {
      try {
        if (enabled && request.method() === "POST" &&
            new URL(request.url()).origin === origin &&
            new URL(request.url()).pathname === "/api/chat") {
          await route.fallback({
            headers: { ...request.headers(), [monitorTokenHeader]: token },
          });
        } else {
          await route.fallback();
        }
      } catch {
        // Playwright errors may carry headers. Never propagate or print them.
        await route.abort("failed").catch(() => {});
      }
    });
  }

  return {
    // 1-based turn number. First-turn success must come from runTurn's result,
    // not from an issued token or a successful page load.
    // Returns the `enabled` value it just set, so a caller diagnosing a
    // client_blocked turn (4th cross-vendor review, 2026-09-26 — "the 3/6
    // cause is still unknown... instrument it") can log exactly what this
    // call decided for THIS turn, rather than re-deriving or guessing it.
    async selectTurn(page, turnNumber, firstTurnPassed) {
      enabled = configured && Number.isInteger(turnNumber) &&
        turnNumber > 1 && firstTurnPassed === true;
      if (configured) {
        await page.evaluate((active) => {
          window.__streetlightMonitorPass = active;
        }, enabled);
      }
      return enabled;
    },
  };
}
