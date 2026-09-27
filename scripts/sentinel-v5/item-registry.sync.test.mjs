// Keeps item-registry.mjs's local closed-vocab allowlist in exact sync with
// config/sentinel-v5-registry-fragment.streetlight.json's `id`/`group`
// fields — see item-registry.mjs's header for why this pairing needs an
// explicit test instead of a single source of truth (the fragment is JSON
// consumed by both this repo's own producer AND, eventually, blt-hub's real
// registry; item-registry.mjs is this repo's producer-side mirror of it).
import assert from "node:assert/strict";
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
// fragment predates it. The arrays must match what run-ui-sentry.sh actually
// emits, not what looks reasonable: the sentry reports green/ok or
// red/job_failed, and the live-chat check reports green/ok or red/degraded.
// (2026-09-27, host-load.mjs: a tier1 failure under Mac load this run judged
// excessive still reports red/job_failed — see the ADR's "host overload"
// note — with the extra context carried only in the email TEXT, never as a
// separate reason_code; checkin-schema.mjs's SENTINEL_V5_REASON_CODES is a
// cross-repo-synced closed vocabulary this lane does not grow, per its own
// header and per cross-vendor review of #52 finding 3.)
test("every fragment item declares the reason codes its producer really emits", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const expected = {
    "sl-ui-sentry": ["ok", "job_failed"],
    "sl-ui-sentry-live-chat": ["ok", "degraded"],
    "sl-error-stream-health": ["ok", "degraded", "job_failed"]
  };
  for (const item of fragment.items) {
    assert.deepEqual(item.reason_codes, expected[item.id], `item ${item.id} reason_codes drifted from the producer`);
  }
});

// Cross-vendor review of #52, finding 3: a set-membership check alone (or
// worse, no check at all) is not proof a real sync to blt-hub would accept
// this fragment's reason codes — it only proves the two hand-maintained
// lists happen to agree with each other. This builds a synthetic check-in
// for every (item, reason_code) pair the fragment actually declares and
// runs it through checkin-schema.mjs's REAL structural validator
// (validateCheckinShape, byte-for-byte the same shape blt-hub's schema.ts
// enforces — see that file's own header) — a genuine reproduction of "would
// this reason_code be rejected," not a hand-check that could itself drift
// from the real schema.
test("every fragment item's declared reason codes are accepted by checkin-schema.mjs's real validator", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const now = new Date();
  for (const item of fragment.items) {
    assert.ok(
      Array.isArray(item.reason_codes) && item.reason_codes.length > 0,
      `item ${item.id} must declare at least one reason_code`,
    );
    for (const reasonCode of item.reason_codes) {
      assert.ok(
        SENTINEL_V5_REASON_CODES.includes(reasonCode),
        `item ${item.id} declares reason_code "${reasonCode}", which is not in checkin-schema.mjs's closed vocabulary — a sync to blt-hub would reject this`,
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
