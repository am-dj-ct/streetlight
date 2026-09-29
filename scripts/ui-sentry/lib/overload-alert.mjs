import {
  isHostOverloaded,
  isTimeoutFailure,
  nextHostOverloadEpisode,
} from "../../lib/host-overload.mjs";

function failedTier1Cases(tier1) {
  return (tier1?.engines ?? []).flatMap((engine) =>
    (engine.cases ?? []).filter((testCase) => testCase.status === "fail"),
  );
}

export function classifyOverloadAlert({ observedLevel, tier1, previousState, now }) {
  const failures = failedTier1Cases(tier1);
  const overloadOnlyTimeout =
    observedLevel === "FAIL" &&
    failures.length > 0 &&
    failures.every(
      (testCase) =>
        isTimeoutFailure(testCase) &&
        testCase.hostLoadAtFailure != null &&
        isHostOverloaded([testCase.hostLoadAtFailure]),
    );
  const overloadEpisode = nextHostOverloadEpisode({
    previous: previousState,
    now,
    overloadedFailure: overloadOnlyTimeout,
    success: observedLevel === "PASS",
  });
  const overloadAlertDisposition = overloadOnlyTimeout
    ? overloadEpisode.shouldPage
      ? "page"
      : "suppress"
    : "normal";
  const effectiveLevel =
    overloadOnlyTimeout && !overloadEpisode.shouldPage ? "DEGRADED" : observedLevel;

  return {
    failures,
    hostOverloaded: overloadOnlyTimeout,
    failureClass: overloadOnlyTimeout ? "host_overloaded" : null,
    overloadAlertDisposition,
    effectiveLevel,
    overloadEpisode,
  };
}
