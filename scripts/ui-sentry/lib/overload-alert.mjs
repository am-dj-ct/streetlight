import {
  hasUsableHostLoadSample,
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
  const deferredTimeout =
    observedLevel === "FAIL" &&
    failures.length > 0 &&
    failures.every(
      (testCase) =>
        isTimeoutFailure(testCase) &&
        (!hasUsableHostLoadSample(testCase.hostLoadAtFailure) ||
          isHostOverloaded([testCase.hostLoadAtFailure])),
    );
  const allSamplesOverloaded =
    deferredTimeout && failures.every((testCase) =>
      hasUsableHostLoadSample(testCase.hostLoadAtFailure),
    );
  const failureClass = deferredTimeout
    ? allSamplesOverloaded
      ? "host_overloaded"
      : "host_load_unavailable"
    : null;
  const overloadEpisode = nextHostOverloadEpisode({
    previous: previousState,
    now,
    overloadedFailure: deferredTimeout,
    success: observedLevel === "PASS",
  });
  const overloadAlertDisposition = deferredTimeout
    ? overloadEpisode.shouldPage
      ? "page"
      : "suppress"
    : "normal";
  const effectiveLevel =
    deferredTimeout && !overloadEpisode.shouldPage ? "DEGRADED" : observedLevel;

  return {
    failures,
    hostOverloaded: allSamplesOverloaded,
    failureClass,
    overloadAlertDisposition,
    effectiveLevel,
    overloadEpisode,
  };
}
