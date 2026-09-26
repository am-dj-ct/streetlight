import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cooling, createdRange, decide, pacificDay } from "./watch.mjs";
import { sendEmail } from "../send-resend-email.mjs";
const exec = promisify(execFile);
const uuid = "12345678-1234-1234-1234-123456789012";
const run = (createdAt, status = "completed", conclusion = "success") => ({ createdAt, status, conclusion });

test("Pacific day survives UTC midnight, winter and DST boundaries", () => {
  for (const [now, same, prior] of [
    ["2026-09-27T05:00:00Z", "2026-09-26T16:00:00Z", "2026-09-26T06:59:59Z"],
    ["2026-12-27T06:00:00Z", "2026-12-26T16:00:00Z", "2026-12-26T07:59:59Z"],
    ["2026-03-09T05:00:00Z", "2026-03-08T16:00:00Z", "2026-03-08T07:59:59Z"],
    ["2026-11-02T06:00:00Z", "2026-11-01T16:00:00Z", "2026-11-01T06:59:59Z"],
  ]) {
    assert.equal(decide([run(same)], new Date(now)), "ok");
    assert.equal(decide([run(prior)], new Date(now)), "missing_success");
  }
  assert.equal(createdRange(new Date("2026-09-27T05:00:00Z")), "2026-09-26..2026-09-27");
});
test("requires completed success; earlier success survives failed rerun", () => {
  const now = new Date("2026-09-26T20:00:00Z");
  assert.equal(decide([], now), "missing_success");
  assert.equal(decide([run(now.toISOString(), "in_progress", null)], now), "missing_success");
  assert.equal(decide([run(now.toISOString(), "completed", "failure")], now), "missing_success");
  assert.equal(decide([run(now.toISOString()), run(now.toISOString(), "completed", "failure")], now), "ok");
  assert.equal(decide({}, now), "invalid_runs");
  assert.equal(decide([run("bad")], now), "invalid_runs");
  assert.equal(cooling(100, 21600099), true);
  assert.equal(cooling(100, 21600100), false);
  assert.equal(cooling(null, 100), false);
});
test("sender records safe success, HTTP failure and transport failure in file + summary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mail-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const body = path.join(root, "body");
  await writeFile(body, "synthetic body must never reach receipt");
  const env = { RESEND_API_KEY: "synthetic-secret", RESOURCE_REVIEW_EMAIL_FROM: "wrong", RESOURCE_REVIEW_EMAIL_TO: "wrong", GITHUB_STEP_SUMMARY: path.join(root, "summary") };
  const args = { job: "digest-watch", reason: "test_failure", receipt: path.join(root, "receipt"), body, subject: "[TEST] synthetic" };
  await sendEmail(args, env, async (_url, request) => {
    assert.deepEqual(JSON.parse(request.body).to, ["jesse@balancedlivingtherapy.com"]);
    assert.equal(JSON.parse(request.body).from, "notifications@alerts.ctpipeline.com");
    return new Response(JSON.stringify({ id: uuid }), { status: 200 });
  });
  await assert.rejects(sendEmail(args, env, async () => new Response('synthetic-secret', { status: 429 })));
  await assert.rejects(sendEmail(args, env, async () => { throw Error("synthetic-secret"); }));
  const receipts = (await readFile(args.receipt, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(receipts.map((r) => r.httpStatus), [200, 429, null]);
  assert.equal(receipts[0].resendId, uuid);
  const summary = await readFile(env.GITHUB_STEP_SUMMARY, "utf8");
  assert.equal(summary.includes("synthetic-secret"), false);
  assert.equal(summary.includes("synthetic body"), false);
  assert.equal(summary.split("EMAIL_RECEIPT").length, 4);
});
test("real bash entry: healthy silent; distinct gh failure; one test mail; shared cooldown", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "digest-watch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"); await mkdir(bin);
  const gh = path.join(bin, "gh");
  await writeFile(gh, `#!/bin/sh\nprintf '%s' '${JSON.stringify([run(new Date().toISOString())])}'\n`, { mode: 0o700 });
  await writeFile(path.join(bin, "doppler"), '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o700 });
  const preload = path.join(root, "fetch.mjs");
  await writeFile(preload, `globalThis.fetch = async () => new Response(JSON.stringify({id: '${uuid}'}), {status:200});`);
  const env = { ...process.env, RESEND_API_KEY: "synthetic", PATH: `${bin}:${process.env.PATH}`, STREETLIGHT_DIGEST_WATCH_STATE_ROOT: path.join(root, "state"), NODE_OPTIONS: `--import=${preload}` };
  const invoke = async (args = []) => exec("bash", ["scripts/watch-usage-digest.sh", ...args], { env }).catch((e) => ({ stdout: e.stdout, code: e.code }));
  assert.match((await invoke()).stdout, /"reason":"ok"/);
  assert.equal(pacificDay(new Date()).length, 10);
  assert.match((await invoke(["--test"])).stdout, /EMAIL_RECEIPT/);
  assert.match((await invoke(["--test"])).stdout, /test_already_attempted/);
  await writeFile(gh, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const failed = await invoke();
  assert.match(failed.stdout, /gh_failed/);
  assert.match(failed.stdout, /email_cooldown/);
  const receipts = (await readFile(path.join(root, "state/receipts.jsonl"), "utf8")).trim().split("\n");
  assert.equal(receipts.length, 1);
  assert.equal(JSON.parse(receipts[0]).resendId, uuid);
});
