// State lives under ~/.streetlight/ui-sentry/, never inside the repo working
// tree (spec: caller-track's work/ui-health/ in-tree state is a known
// mistake). Override with UI_SENTRY_STATE_ROOT for local testing only.
import os from "node:os";
import path from "node:path";

export const STATE_ROOT =
  process.env.UI_SENTRY_STATE_ROOT ??
  path.join(os.homedir(), ".streetlight", "ui-sentry");

export const LOG_DIR = path.join(STATE_ROOT, "logs");
export const SCREENSHOT_DIR = path.join(STATE_ROOT, "screenshots");
export const LAST_RUN_PATH = path.join(STATE_ROOT, "last-run.json");
export const LOCK_DIR = path.join(STATE_ROOT, "run.lock");
