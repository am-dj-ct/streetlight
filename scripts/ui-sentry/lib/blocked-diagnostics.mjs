// Content-free diagnostics for a client_blocked live-chat turn (4th
// cross-vendor review, 2026-09-26, P1, non-negotiable: no content
// logging). The 3rd review's version copied raw console/page-error TEXT
// (truncated to 200 chars) straight into the run log and the returned
// diagnostics object — truncation bounds length, it does not remove
// content, and a synthetic marker planted in a console error survived
// unchanged into the output. Nothing here ever stores or returns the
// original message text: every console/page-error message is classified
// into one of a FIXED, closed set of category labels the moment it is
// seen, and only the category (never the text that produced it) and
// plain counts/booleans ever leave this module. Extracted into its own
// module (out of tier2.mjs) specifically so this content-safety property
// can be exercised by a real regression test
// (blocked-diagnostics.test.mjs) rather than only reasoned about.

// Matched by substring against the message text, in this fixed order —
// the category NAME appearing in the output is drawn from this list, not
// from the message itself, and nothing outside this list can ever appear.
// "other" is not a substring match target; it is the catch-all when none
// of the real categories match.
export const ERROR_CATEGORIES = [
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "NetworkError",
  "AbortError",
];

// Classifies one message's text into a closed-enum category and discards
// the text — this is the ONLY function in this module that ever reads a
// message's actual content, and its return value is always one of
// ERROR_CATEGORIES or the literal string "other", never a derivative of
// the input text itself.
export function categorizeErrorText(text) {
  const safe = typeof text === "string" ? text : "";
  for (const category of ERROR_CATEGORIES) {
    if (safe.includes(category)) return category;
  }
  return "other";
}

function zeroCategoryCounts() {
  const counts = { other: 0 };
  for (const category of ERROR_CATEGORIES) counts[category] = 0;
  return counts;
}

// A mutable, content-free running tally. Call recordConsole/recordPageError
// as messages arrive (this is where message text is read and immediately
// discarded); snapshot()/diff() give a caller before/after counts for a
// specific window (e.g. "since this turn started") without ever needing to
// retain or replay the messages themselves.
export function makeErrorTally() {
  const state = { consoleErrorCount: 0, pageErrorCount: 0, categoryCounts: zeroCategoryCounts() };
  return {
    recordConsole(type, text) {
      if (type !== "error" && type !== "warning") return;
      state.consoleErrorCount += 1;
      state.categoryCounts[categorizeErrorText(text)] += 1;
    },
    recordPageError(text) {
      state.pageErrorCount += 1;
      state.categoryCounts[categorizeErrorText(text)] += 1;
    },
    snapshot() {
      return {
        consoleErrorCount: state.consoleErrorCount,
        pageErrorCount: state.pageErrorCount,
        categoryCounts: { ...state.categoryCounts },
      };
    },
  };
}

// Non-negative difference between two snapshots — a caller takes one right
// before a turn starts and one right after, and this is "what happened
// during that turn," never a running total.
export function diffSnapshots(before, after) {
  const categoryCounts = {};
  for (const category of Object.keys(after.categoryCounts)) {
    categoryCounts[category] = Math.max(0, (after.categoryCounts[category] ?? 0) - (before.categoryCounts[category] ?? 0));
  }
  return {
    consoleErrorCount: Math.max(0, after.consoleErrorCount - before.consoleErrorCount),
    pageErrorCount: Math.max(0, after.pageErrorCount - before.pageErrorCount),
    categoryCounts,
  };
}

// Assembles the final, log-ready object for one client_blocked turn.
// Every field is a boolean, a count, or a category-keyed count object —
// nothing here can ever be an arbitrary string pulled from page content.
export function buildBlockedDiagnostics({
  monitorPassSelected,
  turnstileFound,
  turnstileWrapped,
  monitorPassFlag,
  streamingInProgress,
  widgetEvalFailed,
  errorDelta,
}) {
  return {
    monitorPassSelected: Boolean(monitorPassSelected),
    turnstileFound: Boolean(turnstileFound),
    turnstileWrapped: Boolean(turnstileWrapped),
    monitorPassFlag: Boolean(monitorPassFlag),
    streamingInProgress: Boolean(streamingInProgress),
    widgetEvalFailed: Boolean(widgetEvalFailed),
    consoleErrorCount: errorDelta?.consoleErrorCount ?? 0,
    pageErrorCount: errorDelta?.pageErrorCount ?? 0,
    errorCategoryCounts: errorDelta?.categoryCounts ?? zeroCategoryCounts(),
  };
}
