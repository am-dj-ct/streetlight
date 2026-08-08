#!/usr/bin/env node
// Sentinel-v5 check-in emitter for streetlight — the one call each wired job
// entry point makes. Builds a schema-v2 payload (spec v5.9 §3.2) and admits
// it to the local spool via spool-producer.mjs.
//
// Importable API: emitCheckin({ item, status, reasonCode, at, slot, runSuffix }).
// CLI: node scripts/sentinel-v5/checkin.mjs --item sl-ui-sentry
//        --status green --reason-code ok --at 2026-08-08T14:23:00Z --slot 2026-08-08T14:23:00Z
//
// `at` and `slot` MUST be captured TOGETHER at invocation start, before the
// job body runs, and the same `at` passed through unchanged to the final
// emitCheckin call — never recomputed at completion. blt-hub's real consumer
// (src/sentinel-v5/engine.ts's validateSlotClaim) cross-checks that `at`
// (invocation time) maps to that EXACT slot via captureInvocationSlot — a
// completion-time `at` on a long job can map to a later slot than the one
// legitimately claimed, and a non-schedule-aligned `slot` never validates at
// all. Use `node checkin.mjs --capture-invocation --item <id>` (see
// cron-slot.mjs and checkin-lib.sh's sentinel_capture_invocation) at the top
// of the wrapper, before the job body starts.

import { makeRunId, evidenceRefFor, SENTINEL_V5_REASON_CODES, SENTINEL_V5_STATUSES } from "./checkin-schema.mjs";
import { resolveSpoolRoot, spoolProduceCheckin } from "./spool-producer.mjs";
import { slotForItem } from "./cron-slot.mjs";

export const STREETLIGHT_REPO = "streetlight";

export function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {object} args
 * @param {string} args.item - registry item id (e.g. "sl-ui-sentry")
 * @param {"green"|"yellow"|"red"} args.status
 * @param {string} args.reasonCode - closed vocab, see checkin-schema.mjs
 * @param {string} args.slot - ISO UTC slot, captured at invocation start
 * @param {string} [args.at] - ISO UTC invocation instant, captured at the
 *   SAME moment as slot (never at completion time). Defaults to "now" only
 *   for direct callers that don't care about slot-claim validation; every
 *   wired job entry point passes this explicitly.
 * @param {string} [args.repo] - defaults to "streetlight"
 * @param {string} [args.runSuffix] - appended to the run_id's pid segment
 *   for deterministic, idempotent run ids.
 * @param {string} [args.spoolRoot] - override for tests
 * @param {Date} [args.now] - override for both "at" (when args.at is not
 *   given) and the run_id timestamp, for tests
 */
export function emitCheckin({ item, status, reasonCode, slot, at: atArg, repo = STREETLIGHT_REPO, runSuffix, spoolRoot, now }) {
  if (!SENTINEL_V5_STATUSES.includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  if (!SENTINEL_V5_REASON_CODES.includes(reasonCode)) {
    throw new Error(`invalid reason_code: ${reasonCode}`);
  }
  const at = atArg ?? (now ? now.toISOString() : nowIso());
  const runId = runSuffix ? `${item}-${runSuffix}` : makeRunId(item, now ?? new Date());
  const checkin = {
    schema: 2,
    item,
    repo,
    status,
    at,
    slot,
    run_id: runId,
    reason_code: reasonCode,
    overwrote_prior: false,
    evidence_ref: evidenceRefFor(item, runId),
  };
  const root = spoolRoot ?? resolveSpoolRoot();
  return spoolProduceCheckin(root, checkin);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === "now" || key === "capture-invocation") {
      out[key] = true;
      continue;
    }
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

// CLI entry point — only runs when invoked directly (`node checkin.mjs ...`),
// never when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (args.now) {
    // Legacy raw-timestamp query, kept for callers that only want a plain
    // ISO instant with no slot semantics. checkin-lib.sh's real wrapper
    // usage is --capture-invocation below, not this.
    process.stdout.write(`${nowIso()}\n`);
    process.exit(0);
  }
  if (args["capture-invocation"]) {
    // Captures `at` and the item's real schedule `slot` TOGETHER, at
    // invocation start — see the file header. Outputs JSON on stdout so the
    // bash wrapper can pull both fields with jq without any risk of a
    // partial/torn read.
    try {
      const at = nowIso();
      const slot = slotForItem(args.item, new Date(at));
      process.stdout.write(`${JSON.stringify({ at, slot })}\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`sentinel slot capture failed: ${err?.message ?? err}\n`);
      process.exit(1);
    }
  }
  try {
    const result = emitCheckin({
      item: args.item,
      status: args.status,
      reasonCode: args["reason-code"],
      at: args.at,
      slot: args.slot,
      repo: args.repo,
    });
    process.stdout.write(`${result.filename}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`sentinel checkin failed: ${err?.message ?? err}\n`);
    // Producers never block and are never silently rejected (spec v5.9
    // §3.1) — but a producer-side failure must not fail the CALLER's own
    // job. Every wrapper in checkin-lib.sh backgrounds/ignores this exit
    // code deliberately; see checkin-lib.sh's header comment.
    process.exit(1);
  }
}
