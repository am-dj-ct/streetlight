// Keeps item-registry.mjs's local closed-vocab allowlist in exact sync with
// config/sentinel-v5-registry-fragment.streetlight.json's `id`/`group`
// fields — see item-registry.mjs's header for why this pairing needs an
// explicit test instead of a single source of truth (the fragment is JSON
// consumed by both this repo's own producer AND, eventually, blt-hub's real
// registry; item-registry.mjs is this repo's producer-side mirror of it).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { STREETLIGHT_ITEMS } from "./item-registry.mjs";
import {
  SENTINEL_V5_REASON_CODES,
  SENTINEL_V5_SCHEMA_VERSION,
  evidenceRefFor,
  makeRunId,
  validateCheckinShape,
} from "./checkin-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fragmentPath = path.join(here, "..", "..", "config", "sentinel-v5-registry-fragment.streetlight.json");
const sentinelEmitPath = path.join(here, "..", "ui-sentry", "lib", "sentinel-emit.sh");

// Reads UI_SENTRY_ITEM_A_REASON_CODES/UI_SENTRY_ITEM_B_REASON_CODES straight
// out of sentinel-emit.sh itself — the single source of truth those two
// arrays were added to BE (cross-vendor review of #52, 2nd round, finding
// 2): the OLD version of "every fragment item declares the reason codes its
// producer really emits" below hand-maintained its own separate list, which
// had silently drifted from the real producer (missing state_unverifiable
// and degraded entirely — both real sentinel_emit_item_a paths). Sourcing
// the actual bash file, not re-copying its arrays into JS by hand, is what
// makes a reason code added to sentinel-emit.sh in the future show up here
// automatically instead of requiring someone to remember this test exists.
function readDeclaredReasonCodes() {
  const script = `
set -uo pipefail
source "${sentinelEmitPath}"
printf 'A:%s\\n' "\${UI_SENTRY_ITEM_A_REASON_CODES[*]}"
printf 'B:%s\\n' "\${UI_SENTRY_ITEM_B_REASON_CODES[*]}"
`;
  const result = spawnSync("/bin/bash", ["-c", script], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`failed to read declared reason codes from sentinel-emit.sh: ${result.stderr}`);
  }
  const lines = result.stdout.trim().split("\n");
  const parse = (prefix) => {
    const line = lines.find((entry) => entry.startsWith(prefix));
    if (line === undefined) throw new Error(`sentinel-emit.sh did not print a ${prefix} line`);
    return line.slice(prefix.length).split(" ").filter(Boolean);
  };
  return {
    "sl-ui-sentry": parse("A:"),
    "sl-ui-sentry-live-chat": parse("B:"),
  };
}

test("item-registry.mjs's allowlist matches the registry fragment exactly", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const fragmentIds = fragment.items.map((item) => item.id).sort();
  const localIds = Object.keys(STREETLIGHT_ITEMS).sort();
  assert.deepEqual(localIds, fragmentIds);

  for (const item of fragment.items) {
    const expectedGroup = item.group !== undefined;
    assert.equal(
      Boolean(STREETLIGHT_ITEMS[item.id]?.group),
      expectedGroup,
      `group flag mismatch for ${item.id}`,
    );
  }
});

test("every fragment item id matches the sentinel-v5 item id pattern", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const pattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
  for (const item of fragment.items) {
    assert.match(item.id, pattern, `item id ${item.id} violates SENTINEL_V5_ITEM_ID_PATTERN`);
  }
});

// 2026-08-16: the fleet flipped to zero shadow rows at the full-live
// cutover, and these two rows were merged into blt-hub's authoritative
// config/sentinel-v5-registry.json as shadow:false / enabled:true. The
// fragment is the producer-side declaration of the same rows, so it has to
// say the same thing or the two drift silently -- which is exactly what
// happened between 2026-08-08 and 2026-08-16, when this fragment existed,
// the producer emitted real check-ins on every run, and no registry row
// existed anywhere for them to land on. Ten check-ins, including one red
// job_failed and one red degraded, were discarded.
test("every fragment item carries shadow:false (fleet is zero-shadow since the 2026-08-16 cutover)", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  for (const item of fragment.items) {
    assert.equal(item.shadow, false, `item ${item.id} must have shadow:false`);
    assert.equal(item.enabled, true, `item ${item.id} must be enabled`);
  }
});

// reason_codes became REQUIRED on every check-in item in spec v5.11 and this
// fragment predates it. sl-ui-sentry/sl-ui-sentry-live-chat's expected lists
// are read straight from sentinel-emit.sh's own UI_SENTRY_ITEM_A/B_REASON_
// CODES arrays (readDeclaredReasonCodes above), not hand-copied — a
// hand-copied list here previously went stale and stayed wrong for two full
// review rounds: it was missing degraded (added 2026-09-25) AND
// state_unverifiable (added 2026-09-26) entirely, both real
// sentinel_emit_item_a paths (sentinel-emit.sh's own line 251 at the time
// this was caught), while still passing every run because nothing compared
// it against the actual producer. sl-error-stream-health's producer
// (scripts/error-stream-health/run-error-stream-health.sh) is a separate
// script this fix doesn't touch; kept hand-maintained here for now.
test("every fragment item declares the reason codes its producer really emits", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const declared = readDeclaredReasonCodes();
  const expected = {
    ...declared,
    "sl-error-stream-health": ["ok", "degraded", "job_failed"],
  };
  for (const item of fragment.items) {
    assert.deepEqual(
      [...item.reason_codes].sort(),
      [...expected[item.id]].sort(),
      `item ${item.id} reason_codes drifted from the producer`,
    );
  }
});

// Cross-vendor review of #52, finding 3 (1st round): a set-membership check
// alone (or worse, no check at all) is not proof a real sync to blt-hub
// would accept this fragment's reason codes. This builds a synthetic
// check-in for every (item, reason_code) pair the fragment actually
// declares and runs it through checkin-schema.mjs's REAL structural
// validator (validateCheckinShape, byte-for-byte the same shape blt-hub's
// schema.ts enforces — see that file's own header).
//
// KNOWN, DOCUMENTED EXCEPTION (2nd round, finding 2): sl-ui-sentry's
// "state_unverifiable" reason predates this whole review chain and is NOT
// in checkin-schema.mjs's closed SENTINEL_V5_REASON_CODES vocabulary — the
// same class of gap host_overloaded was in the 1st round, just older and
// already shipping (it distinguishes "we can't even tell what happened"
// from job_failed/degraded in the mail-direct path's subject line and
// receipts — real, load-bearing behavior, not something to revert). It is
// safe ONLY because sentinel_checkin (checkin-lib.sh) never actually calls
// checkin.mjs's emitCheckin/spool path at all any more — every reason code
// for sl-ui-sentry today travels through the mail-direct path alone, never
// through this schema. If that spool path is ever reactivated for this
// item, state_unverifiable would need either a blt-hub schema change or
// remapping to an existing code FIRST — recorded as a known gap in
// ~/notes/LOOSE-ENDS.md, not solved here. Excluded from the strict
// membership/validator check below by name, not silently — every OTHER
// code, for every item, still has to pass both checks.
const KNOWN_LOCAL_ONLY_REASON_CODES = new Set(["state_unverifiable"]);

test("every fragment item's declared reason codes are accepted by checkin-schema.mjs's real validator (except the documented local-only exception)", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const now = new Date();
  for (const item of fragment.items) {
    assert.ok(
      Array.isArray(item.reason_codes) && item.reason_codes.length > 0,
      `item ${item.id} must declare at least one reason_code`,
    );
    for (const reasonCode of item.reason_codes) {
      if (KNOWN_LOCAL_ONLY_REASON_CODES.has(reasonCode)) continue;
      assert.ok(
        SENTINEL_V5_REASON_CODES.includes(reasonCode),
        `item ${item.id} declares reason_code "${reasonCode}", which is not in checkin-schema.mjs's closed vocabulary and is not in KNOWN_LOCAL_ONLY_REASON_CODES either — a sync to blt-hub would reject this`,
      );
      const runId = makeRunId(item.id, now);
      const checkin = {
        schema: SENTINEL_V5_SCHEMA_VERSION,
        item: item.id,
        repo: item.repo,
        status: "red",
        at: now.toISOString(),
        slot: now.toISOString(),
        run_id: runId,
        reason_code: reasonCode,
        overwrote_prior: false,
        evidence_ref: evidenceRefFor(item.id, runId),
      };
      assert.doesNotThrow(
        () => validateCheckinShape(checkin, Boolean(item.group)),
        `a real check-in for item ${item.id} with reason_code "${reasonCode}" was rejected by the actual validator`,
      );
    }
  }
});

test("error-stream health check-in is scheduled on every five-minute slot", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const item = fragment.items.find((candidate) => candidate.id === "sl-error-stream-health");
  assert.equal(item.schedule.cron, "*/5 * * * *");
  assert.equal(item.maintenance_label, "com.streetlight.error-stream-health");
  assert.deepEqual(item.reason_codes, ["ok", "degraded", "job_failed"]);
});
