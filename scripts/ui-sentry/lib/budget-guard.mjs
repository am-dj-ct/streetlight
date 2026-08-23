// R17: the turn cap is enforced at the request boundary. Every /api/chat
// POST attempt in this browser context increments a shared counter; any
// attempt past the cap is aborted before it reaches the network, so a bug
// in the turn-counting logic elsewhere in this package can never turn into
// unbounded live spend. Manual runs share the same cap (spec: "manual runs
// use the same caps") because this guard is installed by the orchestrator
// regardless of how the run was invoked.
//
// tier2.mjs's Turnstile retry (docs/decisions/2026-08-07-...-live-chat-check.md
// amendment) can install this guard twice in one run — once per attempt,
// each with its own browser/context — and the two attempts MUST NOT get
// separate caps, or a blocked-then-retried run could spend up to 2x the
// budget. Pass the same `budget` object into both calls so the counter (and
// therefore the cap) is shared across attempts; a fresh object is created
// only when the caller omits one, which keeps every other, single-attempt
// caller of this function working unchanged.
export function installTurnBudgetGuard(
  context,
  cap,
  budget = { used: 0, cap, aborted: 0 },
  opsReadToken = process.env.OPS_READ_TOKEN,
  baseUrl = process.env.STREETLIGHT_BASE_URL ?? "https://streetlight.help",
) {
  if (!opsReadToken) {
    throw new Error("OPS_READ_TOKEN is required to authenticate synthetic UI-sentry chat turns");
  }

  context.route("**/api/chat", async (route, request) => {
    // A route handler throwing becomes an unhandledRejection at the
    // process level, detached from any case-level try/catch — never let
    // that crash the whole run. The counters above are updated before this
    // try, so budget accounting stays correct even if the actual
    // continue/abort call itself races another handler.
    try {
      if (new URL(request.url()).origin !== new URL(baseUrl).origin) {
        await route.continue();
        return;
      }

      if (request.method() !== "POST") {
        await route.continue();
        return;
      }

      budget.used += 1;

      if (budget.used > cap) {
        budget.aborted += 1;
        await route.abort("failed");
        return;
      }

      await route.continue({
        headers: {
          ...request.headers(),
          authorization: `Bearer ${opsReadToken}`,
          "x-streetlight-synthetic": "ui-sentry",
        },
      });
    } catch {
      // best-effort only
    }
  });

  return budget;
}
