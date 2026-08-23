import assert from "node:assert/strict";
import test from "node:test";
import {
  buildErrorStreamHealthSummary,
  getErrorStreamHealthBucketStarts,
} from "../src/lib/usage-metrics.ts";
import { isAuthenticatedSyntheticUiSentryRequest } from "../src/lib/ops-auth.ts";

process.env.OPS_READ_TOKEN = "synthetic-test-token";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

test("five-minute buckets cover the current rolling hour", () => {
  const starts = getErrorStreamHealthBucketStarts(
    new Date("2026-08-23T17:17:42.000Z"),
  );

  assert.equal(starts.length, 13);
  assert.equal(new Date(starts[0]).toISOString(), "2026-08-23T17:15:00.000Z");
  assert.equal(new Date(starts[12]).toISOString(), "2026-08-23T16:15:00.000Z");
});

test("health is red only when error_stream is strictly over half", () => {
  const now = new Date("2026-08-23T17:20:00.000Z");

  assert.equal(
    buildErrorStreamHealthSummary({ buckets: [{ total: 4, error_stream: 2 }], now })
      .status,
    "green",
  );
  assert.equal(
    buildErrorStreamHealthSummary({ buckets: [{ total: 5, error_stream: 3 }], now })
      .status,
    "red",
  );
});

test("health summary is count-only and stable for an empty window", () => {
  const summary = buildErrorStreamHealthSummary({
    buckets: [],
    now: new Date("2026-08-23T17:20:00.000Z"),
  });

  assert.deepEqual(summary, {
    generatedAt: "2026-08-23T17:20:00.000Z",
    windowMinutes: 60,
    totalInteractions: 0,
    errorStreamCount: 0,
    errorStreamRate: 0,
    status: "green",
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    "errorStreamCount",
    "errorStreamRate",
    "generatedAt",
    "status",
    "totalInteractions",
    "windowMinutes",
  ]);
});

test("synthetic turns are excluded only with the ops bearer token", () => {
  const url = "https://streetlight.help/api/chat";

  assert.equal(
    isAuthenticatedSyntheticUiSentryRequest(
      new Request(url, {
        headers: {
          Authorization: "Bearer synthetic-test-token",
          "x-streetlight-synthetic": "ui-sentry",
        },
      }),
    ),
    true,
  );
  assert.equal(
    isAuthenticatedSyntheticUiSentryRequest(
      new Request(url, {
        headers: {
          Authorization: "Bearer wrong-token",
          "x-streetlight-synthetic": "ui-sentry",
        },
      }),
    ),
    false,
  );
  assert.equal(
    isAuthenticatedSyntheticUiSentryRequest(
      new Request(url, {
        headers: { Authorization: "Bearer synthetic-test-token" },
      }),
    ),
    false,
  );
});

test("the ops route requires auth and returns only the count-only contract", async () => {
  const route = await import("../src/app/api/ops/error-stream-health/route.ts");
  const unauthorized = await route.GET(
    new Request("https://streetlight.help/api/ops/error-stream-health"),
  );
  const authorized = await route.GET(
    new Request("https://streetlight.help/api/ops/error-stream-health", {
      headers: { Authorization: "Bearer synthetic-test-token" },
    }),
  );

  assert.equal(unauthorized.status, 401);
  assert.equal(authorized.status, 503);
  assert.equal(authorized.headers.get("cache-control"), "no-store");
  assert.deepEqual(await authorized.json(), {
    error: "Health signal unavailable.",
  });
  assert.equal((await route.POST()).status, 405);
});

test("stream-event logging keeps only the stable provider error type", async () => {
  const chatRoute = await import("../src/app/api/chat/route.ts");

  assert.equal(
    chatRoute.getStreamEventErrorType({
      type: "error",
      error: {
        type: "overloaded_error",
        message: "provider detail must not be logged",
      },
    }),
    "overloaded_error",
  );
  assert.equal(
    chatRoute.getStreamEventErrorType({
      type: "error",
      error: { type: "unsafe value with spaces" },
    }),
    "unknown",
  );
});
