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
    await context.addInitScript(({ origin }) => {
      if (location.origin !== origin || window !== window.top) return;
      const callbacks = new Map();
      let api;
      window.__streetlightMonitorPass = false;
      Object.defineProperty(window, "turnstile", {
        configurable: true,
        get: () => api,
        set(value) {
          api = value;
          if (!value || value.__streetlightWrapped) return;
          const render = value.render.bind(value);
          const execute = value.execute.bind(value);
          const remove = value.remove.bind(value);
          value.render = (container, options) => {
            const id = render(container, options);
            callbacks.set(id, options.callback);
            return id;
          };
          value.execute = (id, ...args) => {
            if (window.__streetlightMonitorPass && callbacks.has(id)) {
              callbacks.get(id)("streetlight-monitor-pass");
              return;
            }
            return execute(id, ...args);
          };
          value.remove = (id) => {
            callbacks.delete(id);
            return remove(id);
          };
          value.__streetlightWrapped = true;
        },
      });
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
