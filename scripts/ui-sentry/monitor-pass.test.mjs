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
  ]) assert.equal((await h.send(options)).headers[monitorTokenHeader], undefined);
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
