// R17: the turn cap is enforced at the request boundary. Every /api/chat
// POST attempt in this browser context increments a shared counter; any
// attempt past the cap is aborted before it reaches the network, so a bug
// in the turn-counting logic elsewhere in this package can never turn into
// unbounded live spend. Manual runs share the same cap (spec: "manual runs
// use the same caps") because this guard is installed by the orchestrator
// regardless of how the run was invoked.
export function installTurnBudgetGuard(context, cap) {
  const budget = { used: 0, cap, aborted: 0 };

  context.route("**/api/chat", async (route, request) => {
    // A route handler throwing becomes an unhandledRejection at the
    // process level, detached from any case-level try/catch — never let
    // that crash the whole run. The counters above are updated before this
    // try, so budget accounting stays correct even if the actual
    // continue/abort call itself races another handler.
    try {
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

      await route.continue();
    } catch {
      // best-effort only
    }
  });

  return budget;
}
