// Local closed-vocab snapshot of streetlight's own sentinel-v5 item ids.
//
// The real registry (schedule/tier/protected paths/escalation/oracle) lives
// in blt-hub's config/sentinel-v5-registry.json (spec v5.9 §3.2) — this lane
// does NOT own that file and does not commit to it. This lane delivers
// config/sentinel-v5-registry-fragment.streetlight.json as a reviewed
// artifact for the Sentinel coordinator to land after this PR. blt-hub's
// real producer helper validates admission against "the helper's installed
// registry snapshot" (spec v5.9 §3.1 step 1) fetched from that file.
//
// This repo has no access to that file (cross-repo) and no shared package
// to pull it from (see spool-producer.mjs's header). Until that exists,
// this local allowlist is the closed vocabulary this repo's own producer
// enforces at the door — it MUST be kept in exact sync with the `id`/`group`
// fields of config/sentinel-v5-registry-fragment.streetlight.json. Enforced
// by item-registry.sync.test.mjs (same pattern caller-track uses).
export const STREETLIGHT_ITEMS = {
  // "the sentry ran" — status green/red from the job's own exit.
  "sl-ui-sentry": { group: false },
  // "live chat has succeeded recently" — status computed ONLY from the age
  // of lastSuccessfulLiveChatAt in last-run.json, never from exit code.
  // Threshold N = 10 days (three full Mon/Wed/Fri cycles plus margin); see
  // the PR body for the full rationale — the fragment's `oracle` field is
  // schema-locked to the literal string "self_report" (blt-hub
  // registry.ts's ORACLE_KEYS), so it cannot itself carry prose.
  "sl-ui-sentry-live-chat": { group: false },
  // Five-minute, count-only rolling error-stream rate watcher.
  "sl-error-stream-health": { group: false },
};

export function isKnownItem(item) {
  return Object.prototype.hasOwnProperty.call(STREETLIGHT_ITEMS, item);
}

export function isGroupItem(item) {
  return Boolean(STREETLIGHT_ITEMS[item]?.group);
}
