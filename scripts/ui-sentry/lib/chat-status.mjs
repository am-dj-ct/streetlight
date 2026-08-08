// Classifies an intercepted /api/chat response into a fixed status label.
// The strings matched here are the app's own fixed, non-user-authored copy
// (src/app/api/chat/route.ts jsonNoStore bodies) — never user or model
// content — matched only to recover which of the route's fixed mainStatus
// values produced this response (R3: "parsed in memory, never persisted").
// The matched literal text is discarded immediately after classification;
// only the resulting label is ever recorded.
//
// Review resolutions this implements:
//   R1 — the caller is responsible for the no-POST/client-withheld-token
//        race; this module only classifies a response that DID arrive.
//   R2 — a 403 that arrived (POST happened, server rejected) is
//        "server_rejected", not "blocked". Only the client-withheld-token
//        path (no POST at all) is "blocked".
//   R3 — 503s are split by fixed body text into misconfigured vs.
//        paused-on-purpose; an unrecognized 503 body is unclassified.

const MISCONFIGURED_503_MARKERS = [
  "This deployment is misconfigured.",
  "The response did not come through. Please try again.",
];
const SOFT_PAUSE_MARKER = "The tool is paused right now";
const DAILY_SPEND_MARKER = "Today's limit has been reached";

export function classifyChatResponse({ status, bodyText }) {
  if (status === 200) {
    return { label: "pass" };
  }

  if (status === 403) {
    // POST happened and the server rejected it — R2: this can mean broken
    // Turnstile config, not bot rejection. Never "blocked".
    return { label: "server_rejected" };
  }

  if (status === 429) {
    return { label: "rate_limited" };
  }

  if (status === 503) {
    let errorField = null;
    try {
      const parsed = JSON.parse(bodyText ?? "");
      errorField = typeof parsed.error === "string" ? parsed.error : null;
    } catch {
      // Body wasn't the expected JSON shape at all — unclassifiable.
    }

    if (errorField && MISCONFIGURED_503_MARKERS.some((marker) => errorField.includes(marker))) {
      return { label: "misconfigured" };
    }
    if (errorField && errorField.includes(SOFT_PAUSE_MARKER)) {
      return { label: "paused_soft_pause" };
    }
    if (errorField && errorField.includes(DAILY_SPEND_MARKER)) {
      return { label: "paused_daily_spend" };
    }

    return { label: "unclassified_503" };
  }

  return { label: "unclassified", httpStatusSeen: status };
}

export const PAUSED_LABELS = new Set(["paused_soft_pause", "paused_daily_spend"]);

// A turn's classification, folded into the run-level three-state verdict.
// "pass" and turns confirmed as an on-purpose pause (via the /healthz
// recheck the caller must perform for any paused_* label before calling
// this — see runTurn in conversation.mjs) both belong to the non-failing
// buckets tier2's uniformity check uses. A raw, un-rechecked paused_*
// label falls through to "fail": failing closed if a caller skips the
// recheck is safer than silently treating an unconfirmed pause as fine.
export function turnBucket(label) {
  if (label === "pass") return "pass";
  if (label === "client_blocked") return "blocked";
  if (label === "paused_confirmed") return "blocked";
  return "fail";
}
