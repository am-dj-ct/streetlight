import os from "node:os";

export const DEFAULT_OVERLOAD_THRESHOLD_MULTIPLIER = 3;
export const DEFAULT_SUSTAINED_OVERLOAD_MINUTES = 60;

export function readHostLoad() {
  if (process.env.STREETLIGHT_HOST_LOAD_SAMPLE_JSON) {
    return JSON.parse(process.env.STREETLIGHT_HOST_LOAD_SAMPLE_JSON);
  }
  const [load1, load5, load15] = os.loadavg();
  return { load1, load5, load15, cpuCount: os.cpus().length };
}

export function tryReadHostLoad() {
  try {
    const sample = readHostLoad();
    return hasUsableHostLoadSample(sample) ? sample : null;
  } catch {
    return null;
  }
}

export function hasUsableHostLoadSample(sample) {
  return Number.isFinite(sample?.load1) && Number.isFinite(sample?.cpuCount) && sample.cpuCount > 0;
}

export function isHostOverloaded(
  samples,
  thresholdMultiplier = DEFAULT_OVERLOAD_THRESHOLD_MULTIPLIER,
) {
  const cpuCount = samples.find((sample) => Number.isFinite(sample?.cpuCount))?.cpuCount ?? null;
  if (!cpuCount) return false;
  const load1Values = samples
    .map((sample) => sample?.load1)
    .filter((value) => Number.isFinite(value));
  if (load1Values.length === 0) return false;
  return Math.max(...load1Values) > thresholdMultiplier * cpuCount;
}

export function isTimeoutFailure(errorOrRecord) {
  const errorClass = String(errorOrRecord?.errorClass ?? errorOrRecord?.name ?? "").toLowerCase();
  return errorClass === "timeouterror" || errorClass === "deadline_exceeded";
}

export function nextHostOverloadEpisode({
  previous = {},
  now = new Date(),
  overloadedFailure,
  success = false,
  thresholdMinutes = DEFAULT_SUSTAINED_OVERLOAD_MINUTES,
}) {
  previous = previous ?? {};
  if (success || !overloadedFailure) {
    return {
      overloadFirstObservedAt: null,
      overloadLastObservedAt: null,
      overloadConsecutiveFailures: 0,
      overloadEscalationActive: false,
      overloadDurationMinutes: 0,
      shouldPage: false,
    };
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const previousFirst = Date.parse(previous.overloadFirstObservedAt ?? "");
  const firstMs = Number.isFinite(previousFirst) ? previousFirst : nowDate.getTime();
  const durationMinutes = Math.max(0, Math.floor((nowDate.getTime() - firstMs) / 60_000));
  const wasActive = previous.overloadEscalationActive === true;
  const shouldPage = durationMinutes >= thresholdMinutes && !wasActive;

  return {
    overloadFirstObservedAt: new Date(firstMs).toISOString(),
    overloadLastObservedAt: nowDate.toISOString(),
    overloadConsecutiveFailures: Math.max(0, Number(previous.overloadConsecutiveFailures) || 0) + 1,
    // The caller sets this true only after the mail path reports confirmed
    // or uncertain delivery. A cooldown/rejection must leave it pending.
    overloadEscalationActive: wasActive,
    overloadDurationMinutes: durationMinutes,
    shouldPage,
  };
}
