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

test("every fragment item carries shadow:true (REQUIRED on every check-in item)", () => {
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  for (const item of fragment.items) {
    assert.equal(item.shadow, true, `item ${item.id} must have shadow:true`);
  }
});
