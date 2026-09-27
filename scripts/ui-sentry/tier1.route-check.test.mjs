// Covers checkReportProblemPage/checkHorizontalOverflow (tier1.mjs),
// 2026-09-27 (2nd round of cross-vendor review of #52, finding 1): the OLD
// ready checks for both cases could pass against a real 404. report-problem
// waited for "form, section" — this page renders no literal <form> at all,
// so that selector matched only on <section>, which src/app/not-found.tsx
// (a real 404) also renders, inside an <h1>, with no response-status check
// at either. The overflow scan had no ready check or status check whatsoever
// — a flat 300ms wait, so a 404 with zero horizontal overflow (the common
// case) passed silently. These tests reproduce a real 404-shaped fixture
// page (same tags a real not-found.tsx renders: <h1> and <section>, never
// <form>/<select>/<article>/a conversation link) and prove BOTH functions
// now fail against it, using the exact functions tier1.mjs itself calls.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import test from "node:test";
import { checkHorizontalOverflow, checkReportProblemPage } from "./tier1.mjs";

const FIXTURE_ORIGIN = "https://ui-sentry-route-check-fixture.test";

// Same shape a real 404 renders (src/app/not-found.tsx): an <h1> and a
// <section>, nothing else — no <form>, <select>, <article>, or a
// conversation link anywhere.
const NOT_FOUND_BODY =
  '<!doctype html><html><body><h1>Not found</h1><section><p>go home</p></section></body></html>';

function htmlRoute(body) {
  return (route) => route.fulfill({ status: 200, contentType: "text/html", body });
}

function notFoundRoute() {
  return (route) => route.fulfill({ status: 404, contentType: "text/html", body: NOT_FOUND_BODY });
}

test("checkReportProblemPage passes against the real page's own shape (a <select>, HTTP 200)", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route(
      `${FIXTURE_ORIGIN}/report-problem`,
      htmlRoute(
        '<!doctype html><html><body><h1>Report a problem</h1><select><option>main-screen</option></select></body></html>',
      ),
    );
    await assert.doesNotReject(() => checkReportProblemPage(page, FIXTURE_ORIGIN));
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("checkReportProblemPage FAILS against a real 404 (same <h1>/<section> shape not-found.tsx renders)", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route(`${FIXTURE_ORIGIN}/report-problem`, notFoundRoute());
    await assert.rejects(
      () => checkReportProblemPage(page, FIXTURE_ORIGIN),
      /responded 404/,
      "a 404 with a <section> and no <select> must be caught by the response-status check, not silently accepted",
    );
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

const HAPPY_BODY_FOR_PATH = {
  "/": '<!doctype html><html><body><h1>home</h1><a href="/conversation/type-your-own">go</a></body></html>',
  "/find-human": '<!doctype html><html><body><h1>find human</h1><article>referral</article></body></html>',
  "/about": '<!doctype html><html><body><h1>about</h1><article>section</article></body></html>',
};

async function routeAllPaths(context, bodyForPath) {
  for (const [path, body] of Object.entries(bodyForPath)) {
    await context.route(`${FIXTURE_ORIGIN}${path}`, htmlRoute(body));
  }
}

test("checkHorizontalOverflow passes when every path renders its own real ready selector with no overflow", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await routeAllPaths(context, HAPPY_BODY_FOR_PATH);
    await assert.doesNotReject(() => checkHorizontalOverflow(page, FIXTURE_ORIGIN));
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});

test("checkHorizontalOverflow FAILS when one path 404s (same <h1>/<section> shape not-found.tsx renders), even though a 404 has no horizontal overflow", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await routeAllPaths(context, {
      "/": HAPPY_BODY_FOR_PATH["/"],
      "/find-human": HAPPY_BODY_FOR_PATH["/find-human"],
    });
    // /about 404s — a real not-found.tsx response, which itself has zero
    // horizontal overflow. The OLD body (no status check, no ready
    // selector) would have measured this page, found no overflow, and
    // passed. This must fail instead, on the status.
    await context.route(`${FIXTURE_ORIGIN}/about`, notFoundRoute());
    await assert.rejects(
      () => checkHorizontalOverflow(page, FIXTURE_ORIGIN),
      /\/about responded 404/,
      "a 404 page with no overflow must still fail the scan, on its response status",
    );
    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
});
