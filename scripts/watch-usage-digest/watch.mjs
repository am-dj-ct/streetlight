import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const exec = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const COOLDOWN = 6 * 60 * 60 * 1000;
export function pacificDay(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function createdRange(now) {
  // Query both UTC dates covered by the Pacific day, then filter precisely.
  const day = pacificDay(now);
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${day}..${next.toISOString().slice(0, 10)}`;
}
export function decide(runs, now) {
  if (!Array.isArray(runs) || runs.some((run) => !run || !Number.isFinite(Date.parse(run.createdAt)) || typeof run.status !== "string" || !(run.conclusion === null || typeof run.conclusion === "string"))) return "invalid_runs";
  return runs.some((run) => run.status === "completed" && run.conclusion === "success" && pacificDay(new Date(run.createdAt)) === pacificDay(now)) ? "ok" : "missing_success";
}
export function cooling(last, now) { return Number.isFinite(last) && now - last < COOLDOWN; }

export async function watch(testMode = false) {
  const root = process.env.STREETLIGHT_DIGEST_WATCH_STATE_ROOT ?? path.join(os.homedir(), ".streetlight/digest-watch");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const now = new Date();
  let reason = "test_failure";
  if (!testMode) {
    try {
      const result = await exec("gh", ["run", "list", "--repo", "am-dj-ct/streetlight", "--workflow", "usage-digest.yml", "--created", createdRange(now), "--limit", "1000", "--json", "conclusion,createdAt,status"], { timeout: 30_000, maxBuffer: 2_000_000 });
      try { reason = decide(JSON.parse(result.stdout), now); } catch { reason = "invalid_runs"; }
    } catch { reason = "gh_failed"; }
  }
  const observation = { timestamp: now.toISOString(), date: pacificDay(now), reason };
  await appendFile(path.join(root, "checks.jsonl"), `${JSON.stringify(observation)}\n`, { mode: 0o600 });
  console.log(`digest-watch: ${JSON.stringify(observation)}`);
  if (reason === "ok") return 0;
  // OS advisory lock covers cooldown reservation + mail; released even on SIGKILL.
  const result = await exec("python3", [path.join(directory, "mail-lock.py"), root,
    process.execPath, path.join(directory, "watch.mjs"), "--send", reason, pacificDay(now)],
  { timeout: 130_000, maxBuffer: 100_000 }).catch((error) => ({ stdout: error.stdout ?? "", failed: true,
    lockTimedOut: error.stderr?.includes("digest-watch: mail_lock_timeout after 60 seconds") }));
  process.stdout.write(result.stdout);
  if (result.lockTimedOut) console.error("digest-watch: mail_lock_timeout after 60 seconds");
  if (result.failed) console.error("digest-watch: email_unconfirmed");
  return 1;
}
async function send(reason, day) {
  const root = process.env.STREETLIGHT_DIGEST_WATCH_STATE_ROOT ?? path.join(os.homedir(), ".streetlight/digest-watch");
  // Tests cannot reserve or consume the real alert cooldown.
  const marker = path.join(root, reason === "test_failure" ? "last-test-attempt.json" : "last-attempt.json");
  const testMarker = path.join(root, "test-attempted");
  if (reason === "test_failure") {
    try { await writeFile(testMarker, new Date().toISOString(), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; console.log("digest-watch: test_already_attempted"); return; }
  }
  let last = null;
  try { last = JSON.parse(await readFile(marker, "utf8")).at; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (cooling(last, Date.now())) { console.log("digest-watch: email_cooldown"); return; }
  // Reserve before sending: ambiguous network acceptance must not cause duplicate mail.
  await writeFile(marker, JSON.stringify({ at: Date.now() }), { mode: 0o600 });
  const body = path.join(root, "mail-body.tmp");
  await writeFile(body, `Usage Digest has no confirmed successful run for Pacific date ${day}. Reason: ${reason}.\nCheck the Usage Digest workflow in am-dj-ct/streetlight.\n`, { mode: 0o600 });
  const receipt = path.join(root, "receipts.jsonl");
  try {
    const result = await exec("doppler", ["run", "-p", "agent-secrets", "-c", "dev", "--", process.execPath, path.join(directory, "../send-resend-email.mjs"),
      "--job", "digest-watch", "--reason", reason, "--receipt", receipt, "--body", body,
      "--subject", `${reason === "test_failure" ? "[TEST] " : ""}Streetlight usage digest did not run`],
    { timeout: 60_000, env: { ...process.env,
      RESOURCE_REVIEW_EMAIL_FROM: "notifications@alerts.ctpipeline.com",
      RESOURCE_REVIEW_EMAIL_TO: "jesse@balancedlivingtherapy.com" }, maxBuffer: 100_000 });
    process.stdout.write(result.stdout);
  } catch (error) {
    // The sender prints only fixed messages + its allowlisted receipt.
    if (error.stdout?.startsWith("EMAIL_RECEIPT ")) process.stdout.write(error.stdout);
    else {
      const entry = { timestamp: new Date().toISOString(), job: "digest-watch", reason, httpStatus: null, resendId: null };
      await appendFile(receipt, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      console.log(`EMAIL_RECEIPT ${JSON.stringify(entry)}`);
    }
    throw new Error("email_unconfirmed");
  } finally { await rm(body, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--send") await send(process.argv[3], process.argv[4]);
    else if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--test")) process.exitCode = await watch(process.argv[2] === "--test");
    else throw new Error("invalid_arguments");
  } catch { console.error("digest-watch: local_or_mail_failure"); process.exitCode = 1; }
}
