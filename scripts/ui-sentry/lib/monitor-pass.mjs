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
      // api.js assigns window.turnstile asynchronously after its own
      // script executes — poll for it rather than relying on any single
      // event, bounded well past any realistic load time so a page that
      // never gets the real widget at all doesn't leave a timer running
      // forever.
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
