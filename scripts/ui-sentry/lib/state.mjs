// Atomic last-run.json read/write. R13: state is written atomically no
// matter how the run ends — write to a temp file in the same directory,
// then rename over the target (rename is atomic on the same filesystem).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LAST_RUN_PATH, STATE_ROOT } from "./paths.mjs";

export function readPreviousState() {
  try {
    const raw = readFileSync(LAST_RUN_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeStateAtomic(state) {
  mkdirSync(STATE_ROOT, { recursive: true });
  const tmpPath = path.join(STATE_ROOT, `.last-run.json.tmp-${process.pid}`);
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, LAST_RUN_PATH);
}
