// Content-free host-load snapshot (2026-09-27): the 07:23 run that went red
// while the site itself was fine (load average ~144 on 10 cores, tier1's
// chromium-desktop page loads ~28s) had no evidence in last-run.json or the
// log of WHY the browser-driven checks were slow — only that they were.
// Two numbers only, both plain machine facts, never anything about what
// caused the load: os.loadavg()'s three floats and os.cpus().length.
// Compatibility re-export. The error-stream watcher and UI sentry deliberately
// use the same threshold and sampling implementation.
export {
  hasUsableHostLoadSample,
  isHostOverloaded,
  readHostLoad,
  tryReadHostLoad,
} from "../../lib/host-overload.mjs";
