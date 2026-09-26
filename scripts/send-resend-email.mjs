import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function sendEmail(args, env = process.env, fetcher = fetch) {
  const job = args.job;
  if (!["usage-digest", "resource-review", "digest-watch"].includes(job) || !args.receipt) {
    throw new Error("A known --job and --receipt path are required.");
  }
  const receipt = { timestamp: new Date().toISOString(), job, httpStatus: null, resendId: null };
  if (job === "digest-watch") {
    if (!["test_failure", "missing_success", "gh_failed", "invalid_runs"].includes(args.reason)) throw new Error("Invalid reason.");
    receipt.reason = args.reason;
  }
  let accepted = false;
  // Ensure receipt storage works before sending. Do not print provider error bodies.
  await mkdir(path.dirname(args.receipt), { recursive: true });
  await appendFile(args.receipt, "", { mode: 0o600 });
  try {
    if (!args.body || !args.subject || !env.RESEND_API_KEY || !env.RESOURCE_REVIEW_EMAIL_FROM || !env.RESOURCE_REVIEW_EMAIL_TO) {
      throw new Error("Missing email configuration.");
    }
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: job === "digest-watch" ? "notifications@alerts.ctpipeline.com" : env.RESOURCE_REVIEW_EMAIL_FROM,
        to: job === "digest-watch" ? ["jesse@balancedlivingtherapy.com"] : env.RESOURCE_REVIEW_EMAIL_TO.split(",").map((email) => email.trim()).filter(Boolean),
        subject: args.subject,
        text: await readFile(args.body, "utf8"),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    receipt.httpStatus = response.status;
    const result = await response.json().catch(() => null);
    // The only provider string we retain is a validated message UUID.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result?.id ?? "")) receipt.resendId = result.id;
    accepted = response.ok && receipt.resendId !== null;
  } catch {
    // Network/timeout/configuration failure: null HTTP status, never raw errors.
  } finally {
    const line = `EMAIL_RECEIPT ${JSON.stringify(receipt)}`;
    await appendFile(args.receipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    console.log(line);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `\n${line}\n`);
  }
  if (!accepted) throw new Error("Email was not confirmed accepted; see content-free receipt.");
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  try { await sendEmail(args); } catch { console.error("Email send failed; inspect receipt."); process.exitCode = 1; }
}
