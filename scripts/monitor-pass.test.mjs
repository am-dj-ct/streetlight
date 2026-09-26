import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
import { consumeMonitorPass, monitorTokenHeader } from "../src/lib/monitor-pass.ts";
import { getRuntimeState } from "../src/lib/runtime-state.ts";
import { POST } from "../src/app/api/chat/route.ts";
import { proxy } from "../src/proxy.ts";

// Synthetic only. Never load real credentials or call an external service.
const credential = "synthetic-monitor-credential-".repeat(2);
const originalEnv = { ...process.env };
let reserve, rate, spend, siteverify, logs;
function request(token = credential, options = {}) {
  return new Request("https://streetlight.help/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.1",
      authorization: "Bearer synthetic-ops",
      "x-streetlight-synthetic": "ui-sentry",
      ...(token === null ? {} : { [monitorTokenHeader]: token }),
      ...options.headers,
    },
    body: JSON.stringify({
      entryId: "understand-letter-or-form", language: "en",
      messages: [{ id: "synthetic-turn", role: "user", text: "Synthetic test message" }],
      turnstileToken: "synthetic-turnstile",
      ...options.body,
    }),
  });
}
beforeEach(() => {
  Object.assign(process.env, {
    STREETLIGHT_MONITOR_TOKEN: credential,
    KV_REST_API_URL: "https://synthetic.invalid",
    KV_REST_API_TOKEN: "synthetic-kv",
    HASHED_IP_SALT: "synthetic-salt", OPS_READ_TOKEN: "synthetic-ops",
    VERCEL_ENV: "production", DEV_MOCK_CHAT: "false", DEV_MOCK_TTS: "false",
    TURNSTILE_ENABLED: "true", TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-sitekey",
    SOFT_PAUSE_ENABLED: "false", HARD_PAUSE_ENABLED: "false",
    MAIN_MODEL: "synthetic-main", CLASSIFIER_MODEL: "synthetic-classifier",
    DAILY_SPEND_LIMIT_USD: "1",
    MAIN_MODEL_INPUT_COST_PER_MILLION_USD: "1",
    MAIN_MODEL_OUTPUT_COST_PER_MILLION_USD: "1",
    CLASSIFIER_MODEL_INPUT_COST_PER_MILLION_USD: "1",
    CLASSIFIER_MODEL_OUTPUT_COST_PER_MILLION_USD: "1",
  });
  reserve = mock.fn(async () => 1);
  rate = mock.fn(async () => 101);
  spend = mock.fn(async () => 2);
  siteverify = mock.fn(async (url, options) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(JSON.stringify(options).includes(credential), false);
    return Response.json({ success: true });
  });
  mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).startsWith("https://challenges.cloudflare.com/")) return siteverify(url, options);
    assert.equal(String(url).startsWith("https://synthetic.invalid"), true);
    const raw = JSON.parse(options.body);
    const pipeline = Array.isArray(raw[0]);
    const results = await Promise.all((pipeline ? raw : [raw]).map(async (cmd) => {
      const name = cmd[0].toLowerCase();
      try {
        if (name === "eval") return { result: await reserve(cmd[1], [cmd[3]], cmd.slice(4)) };
        if (name === "incr") return { result: await rate(cmd[1]) };
        if (name === "get") return { result: await spend(cmd[1]) };
        throw new Error("Unexpected synthetic KV command");
      } catch {
        return { error: credential };
      }
    }));
    return Response.json(pipeline ? results : results[0]);
  });
  logs = [];
  for (const method of ["log", "info", "error", "warn"]) {
    mock.method(console, method, (...args) => logs.push(JSON.stringify(args)));
  }
});
afterEach(() => {
  assert.equal(logs.join("\n").includes(credential), false);
  assert.equal(logs.join("\n").includes(monitorTokenHeader), false);
  mock.restoreAll();
  mock.timers.reset();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

test("valid credential bypasses only Turnstile; rate limit still rejects", async () => {
  const response = await POST(request());
  assert.equal(response.status, 429);
  assert.ok(logs.length > 0);
  assert.equal(siteverify.mock.callCount(), 0);
  assert.equal(reserve.mock.callCount(), 1);
  assert.equal(rate.mock.callCount(), 1);
  assert.equal((await response.text()).includes(credential), false);
});
for (const [name, token, configured] of [
  ["invalid", "wrong", credential],
  ["same-length invalid", "x".repeat(credential.length), credential],
  ["missing header", null, credential],
  ["short config", "short", "short"],
  ["missing config", credential, ""],
]) {
  test(`${name} follows ordinary Turnstile without reserving quota`, async () => {
    process.env.STREETLIGHT_MONITOR_TOKEN = configured;
    const response = await POST(request(token));
    assert.equal(response.status, 429);
    assert.equal(siteverify.mock.callCount(), 1);
    assert.equal(reserve.mock.callCount(), 0);
  });
}
for (const [name, result] of [["cap reached", 0], ["unexpected KV reply", 2], ["null KV reply", null]]) {
  test(`${name} falls back to real Turnstile`, async () => {
    reserve.mock.mockImplementation(async () => result);
    assert.equal((await POST(request())).status, 429);
    assert.equal(siteverify.mock.callCount(), 1);
  });
}
test("KV exception is swallowed without logging its credential-bearing details", async () => {
  reserve.mock.mockImplementation(async () => { throw new Error(credential); });
  assert.equal((await POST(request())).status, 429);
  assert.equal(siteverify.mock.callCount(), 1);
});
test("absent KV disables the pass; preview continues through normal Turnstile", async () => {
  delete process.env.KV_REST_API_URL;
  process.env.VERCEL_ENV = "preview";
  siteverify.mock.mockImplementation(async () => Response.json({ success: false }));
  assert.equal((await POST(request())).status, 403);
  assert.equal(reserve.mock.callCount(), 0);
  assert.equal(siteverify.mock.callCount(), 1);
  assert.equal(getRuntimeState().abuseControls.monitorPassConfigured, false);
});
test("failed pass cannot authorize the nonsecret client marker", async () => {
  reserve.mock.mockImplementation(async () => 0);
  siteverify.mock.mockImplementation(async () => Response.json({ success: false }));
  assert.equal((await POST(request(credential, { body: { turnstileToken: "streetlight-monitor-pass" } }))).status, 403);
  assert.equal(rate.mock.callCount(), 0);
});
test("soft pause and input limits reject before consuming a pass", async () => {
  process.env.SOFT_PAUSE_ENABLED = "true";
  assert.equal((await POST(request())).status, 503);
  assert.equal((await POST(request(credential, { headers: { "content-length": "5000000" } }))).status, 413);
  assert.equal((await POST(request(credential, { body: { messages: [] } }))).status, 400);
  assert.equal(reserve.mock.callCount(), 0);
});
test("hard pause still intercepts authenticated monitor traffic", async () => {
  process.env.HARD_PAUSE_ENABLED = "true";
  const response = proxy(new NextRequest(request()));
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(credential), false);
  assert.equal(reserve.mock.callCount(), 0);
});
test("daily spend cap still rejects after the pass", async () => {
  rate.mock.mockImplementation(async () => 2);
  assert.equal((await POST(request())).status, 503);
  assert.equal(spend.mock.callCount(), 1);
  assert.equal(siteverify.mock.callCount(), 0);
});
test("production missing controls still reject before the pass", async () => {
  delete process.env.HASHED_IP_SALT;
  assert.equal((await POST(request())).status, 503);
  assert.equal(reserve.mock.callCount(), 0);
});
test("quota operation carries only date, cap and absolute expiry, never credential", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-26T23:59:59Z") });
  assert.equal(await consumeMonitorPass(request()), true);
  const first = reserve.mock.calls[0].arguments;
  assert.deepEqual(first.slice(1), [["monitor-pass:2026-09-26"], [12, Date.parse("2026-09-27T00:01:00Z") / 1000]]);
  assert.equal(JSON.stringify(first).includes(credential), false);
  mock.timers.tick(1000);
  await consumeMonitorPass(request());
  assert.deepEqual(reserve.mock.calls[1].arguments[1], ["monitor-pass:2026-09-27"]);
});
test("other routes/methods cannot reserve a pass", async () => {
  for (const [url, method] of [["https://streetlight.help/api/tts", "POST"], ["https://streetlight.help/api/chat", "GET"]]) {
    assert.equal(await consumeMonitorPass(new Request(url, { method, headers: { [monitorTokenHeader]: credential } })), false);
  }
  assert.equal(reserve.mock.callCount(), 0);
});
test("health contains a configuration boolean only and absence is optional", () => {
  assert.equal(getRuntimeState().abuseControls.monitorPassConfigured, true);
  process.env.VERCEL_ENV = "preview";
  for (const value of ["", "short"]) {
    process.env.STREETLIGHT_MONITOR_TOKEN = value;
    const state = getRuntimeState();
    assert.equal(state.abuseControls.monitorPassConfigured, false);
    assert.equal(state.deployConfigOk, true);
    assert.equal(JSON.stringify(state).includes(credential), false);
  }
});
