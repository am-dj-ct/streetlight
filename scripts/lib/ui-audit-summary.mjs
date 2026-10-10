// Content-free summary of the nightly UI sentry result, and the one-line
// verdict the Streetlight usage digest prints from it.
//
// The sentry runs on Jesse's Mac and its result lives only in
// ~/.streetlight/ui-sentry/last-run.json. The digest runs in GitHub's cloud
// and cannot read that file. So the Mac publishes a small summary into a
// GitHub Actions repo variable (scripts/ui-sentry/publish-result.mjs), and
// the digest workflow hands that variable to scripts/build-usage-digest-
// email.mjs, which calls formatAuditLine() below.
//
// Both halves live in this one module so the shape they agree on cannot
// drift. Pure functions, no I/O, no imports: it must run on the Mac under
// the sentry's own node and on a bare GitHub runner with no npm install.
//
// Content-free by construction (ADR 2026-08-17-ui-sentry-reports-without-
// email): the summary carries statuses, counts, a fixed headline, and the
// fixed names of failed test cases ("chromium-desktop: home loads"). It
// never copies page text, chat turns, error text, or log paths.

export const AUDIT_SUMMARY_VERSION = 1;

// The sentry runs once a day, so a result older than this means a missed
// run or a broken publish. 30h leaves a few hours of slack past 24h.
export const STALE_AFTER_MS = 30 * 60 * 60 * 1000;

const MAX_FAILED_NAMES = 8;
// Allowlists, not scrubbing: anything that is not a recognisable fixed test
// name or sentry headline is replaced, never truncated, so unexpected text
// cannot slip through as a prefix. Case names are fixed strings in tier0/1
// ("chromium-desktop: home loads"); they use letters, digits, spaces and a
// little punctuation, and one em dash.
const CASE_NAME_PATTERN = /^[A-Za-z0-9 .,:;()/_'+>\u2014-]{1,160}$/;
const HEADLINE_PATTERN = /^Streetlight UI sentry: (PASS|DEGRADED|FAIL)( \([A-Za-z0-9 ,.-]{1,80}\))?$/;
const UNRECOGNIZED_NAME = "unrecognized check name";
const STATUSES = new Set(["PASS", "DEGRADED", "FAIL", "UNKNOWN"]);
const TIER_STATUSES = new Set(["pass", "fail", "blocked", "partial", "skipped", "missing", "unknown"]);
// Tolerated clock skew between the Mac that stamped finishedAt and the runner.
const FUTURE_SKEW_MS = 10 * 60 * 1000;
const TIME_ZONE = "America/Los_Angeles";

const TIER_LABELS = {
  tier0: "tier 0 (health gate)",
  tier1: "tier 1 (structural)",
  tier2: "tier 2 (live chat)",
};

// ---------------------------------------------------------------------------
// Mac side: last-run.json -> summary
// ---------------------------------------------------------------------------

/**
 * @param {object} state parsed last-run.json
 * @param {{ headline?: string|null }} [options] headline is computed by the
 *   caller from the sentry's own subject builder, so wording stays in one place.
 * @returns {object} the summary to publish
 */
export function buildAuditSummary(state, { headline = null } = {}) {
  const tier0 = state?.tier0 ?? null;
  const tier1 = state?.tier1 ?? null;
  const tier2 = state?.tier2 ?? null;
  const tier2Skipped = Boolean(state?.tier2Skipped);

  const tier0Cases = casesOf(tier0?.cases);
  const tier1Cases = Array.isArray(tier1?.engines)
    ? tier1.engines.flatMap((engine) => casesOf(engine?.cases))
    : [];

  // Tier 2 is one live conversation, so it counts as a single check rather
  // than one per turn. A tier that did not run contributes no checks and is
  // reported through its tier status instead.
  const tier2Checks = tier2 && !tier2Skipped ? [{ name: "tier 2: live chat conversation", status: tier2.status }] : [];

  const allChecks = [...tier0Cases, ...tier1Cases, ...tier2Checks];
  const failed = allChecks.filter((check) => check.status !== "pass");

  return {
    v: AUDIT_SUMMARY_VERSION,
    status: STATUSES.has(state?.status) ? state.status : "UNKNOWN",
    headline: typeof headline === "string" && HEADLINE_PATTERN.test(headline) ? headline : null,
    finishedAt: validIso(state?.finishedAt),
    exitCode: Number.isInteger(state?.exitCode) ? state.exitCode : null,
    tiers: {
      tier0: tierStatus(tier0),
      tier1: tierStatus(tier1),
      tier2: tier2Skipped ? "skipped" : tierStatus(tier2),
    },
    tier0Reason: fixedToken(tier0?.reason, null),
    failureClass: fixedToken(state?.failureClass, null),
    totalChecks: allChecks.length,
    failedChecks: failed.length,
    failedNames: failed
      .slice(0, MAX_FAILED_NAMES)
      .map((check) => safeCaseName(check.name)),
  };
}

function casesOf(cases) {
  if (!Array.isArray(cases)) return [];
  return cases.map((c) => ({ name: typeof c?.name === "string" ? c.name : "unnamed check", status: c?.status ?? "unknown" }));
}

// "pass" | "fail" | "blocked" | "partial" | "skipped" | "missing" ...
function tierStatus(tier) {
  if (!tier) return "missing";
  const status = fixedToken(tier.status, "unknown").toLowerCase();
  return TIER_STATUSES.has(status) ? status : "unknown";
}

// A short machine token (PASS, host_overloaded, ...). Anything else, such as
// free text that should never be here, is replaced rather than published.
function fixedToken(value, fallback) {
  if (typeof value === "string" && /^[A-Za-z0-9_]{1,40}$/.test(value)) return value;
  return fallback;
}

function safeCaseName(value) {
  return typeof value === "string" && CASE_NAME_PATTERN.test(value) ? value : UNRECOGNIZED_NAME;
}

function validIso(value) {
  if (typeof value !== "string") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

// ---------------------------------------------------------------------------
// Digest side: published summary -> one plain-English line
// ---------------------------------------------------------------------------

/**
 * Always returns a line starting "UI/UX audit:". Never throws and never
 * returns an empty string: a missing, unreadable, or old result is reported
 * as NO RESULT rather than silently left out of the email.
 *
 * @param {string|object|null|undefined} raw the repo variable's value
 * @param {{ now?: Date }} [options]
 */
export function formatAuditLine(raw, { now = new Date() } = {}) {
  const summary = parseSummary(raw, now);

  if (summary === "missing") {
    return "UI/UX audit: NO RESULT - nothing has been published yet by the nightly audit on Jesse's Mac";
  }
  if (summary === "future") {
    return "UI/UX audit: NO RESULT - the published audit result is dated in the future, so its clock cannot be trusted";
  }
  if (summary === "unreadable") {
    return "UI/UX audit: NO RESULT - the published audit result could not be read";
  }

  const finishedMs = Date.parse(summary.finishedAt);
  const when = formatLocalTime(new Date(finishedMs));
  const ageMs = now.getTime() - finishedMs;

  if (ageMs > STALE_AFTER_MS) {
    return `UI/UX audit: NO RESULT - last result is from ${when} (${formatAge(ageMs)} ago), so last night's audit did not report`;
  }

  if (isFullPass(summary)) {
    return `UI/UX audit: PASSED IN FULL - all ${summary.totalChecks} checks passed (run ${when})`;
  }

  return `UI/UX audit: NOT A FULL PASS - ${describeProblem(summary)} (run ${when})`;
}

// The variable is operator-editable and travels into an email, so the digest
// side validates the whole shape rather than trusting it: a wrong version,
// an unknown status, a non-integer count, or a name outside the allowlist
// makes the result "unreadable" (reported as NO RESULT), never printed.
function parseSummary(raw, now) {
  if (raw === undefined || raw === null) return "missing";
  let value = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return "missing";
    try {
      value = JSON.parse(raw);
    } catch {
      return "unreadable";
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unreadable";
  if (value.v !== AUDIT_SUMMARY_VERSION) return "unreadable";
  if (!STATUSES.has(value.status)) return "unreadable";
  if (typeof value.finishedAt !== "string" || !Number.isFinite(Date.parse(value.finishedAt))) return "unreadable";

  const tiers = value.tiers;
  if (!tiers || typeof tiers !== "object") return "unreadable";
  for (const key of ["tier0", "tier1", "tier2"]) {
    if (!TIER_STATUSES.has(tiers[key])) return "unreadable";
  }

  const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 100000;
  if (!isCount(value.totalChecks) || !isCount(value.failedChecks) || value.failedChecks > value.totalChecks) {
    return "unreadable";
  }
  if (!Array.isArray(value.failedNames) || value.failedNames.length > MAX_FAILED_NAMES) return "unreadable";

  const finishedMs = Date.parse(value.finishedAt);
  if (finishedMs - now.getTime() > FUTURE_SKEW_MS) return "future";

  return {
    status: value.status,
    finishedAt: value.finishedAt,
    tiers: { tier0: tiers.tier0, tier1: tiers.tier1, tier2: tiers.tier2 },
    tier0Reason: typeof value.tier0Reason === "string" && /^[a-z0-9_]{1,40}$/.test(value.tier0Reason) ? value.tier0Reason : null,
    totalChecks: value.totalChecks,
    failedChecks: value.failedChecks,
    failedNames: value.failedNames.map(safeCaseName),
  };
}

// A full pass needs the sentry's own verdict to be PASS and all three tiers
// to have actually passed. A tier 2 that was blocked, partial, or skipped
// still yields status PASS or DEGRADED upstream, so it is checked here
// explicitly: "skipped" or "blocked" is not a full pass.
function isFullPass(summary) {
  const tiers = summary.tiers ?? {};
  return (
    summary.status === "PASS" &&
    tiers.tier0 === "pass" &&
    tiers.tier1 === "pass" &&
    tiers.tier2 === "pass" &&
    Number(summary.failedChecks) === 0 &&
    Number(summary.totalChecks) > 0
  );
}

function describeProblem(summary) {
  const tiers = summary.tiers ?? {};
  const parts = [String(summary.status)];

  const tierNotes = ["tier0", "tier1", "tier2"]
    .filter((key) => tiers[key] !== "pass")
    .map((key) => `${TIER_LABELS[key]} ${describeTier(key, tiers[key], summary)}`);
  if (tierNotes.length > 0) parts.push(tierNotes.join(", "));

  const total = Number(summary.totalChecks) || 0;
  const failed = Number(summary.failedChecks) || 0;
  const names = Array.isArray(summary.failedNames) ? summary.failedNames.filter((n) => typeof n === "string") : [];
  let counts = `${failed} of ${total} checks failed`;
  if (names.length > 0) {
    const more = failed > names.length ? `, and ${failed - names.length} more` : "";
    counts += `: ${names.join("; ")}${more}`;
  }
  parts.push(counts);

  return parts.join(", ");
}

function describeTier(key, status, summary) {
  switch (status) {
    case "fail": {
      const reason = key === "tier0" ? summary.tier0Reason : null;
      return reason ? `failed (${reason.replace(/_/g, " ")})` : "failed";
    }
    case "blocked":
      return "blocked (chat could not be exercised)";
    case "partial":
      return "only partly passed";
    case "skipped":
      return "skipped (structural-only run)";
    case "missing":
      return "did not run";
    default:
      return `reported ${status}`;
  }
}

function formatLocalTime(date) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatAge(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)} days`;
}
