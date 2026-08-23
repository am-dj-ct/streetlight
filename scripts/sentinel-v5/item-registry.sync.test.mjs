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

test("error-stream health check-in is scheduled on every five-minute slot", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  const item = fragment.items.find((candidate) => candidate.id === "sl-error-stream-health");
  assert.equal(item.schedule.cron, "*/5 * * * *");
  assert.equal(item.maintenance_label, "com.streetlight.error-stream-health");
  assert.deepEqual(item.reason_codes, ["ok", "degraded", "job_failed"]);
});
