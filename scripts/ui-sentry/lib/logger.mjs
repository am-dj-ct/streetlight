// Content-free structured logger. Every line is a fixed-shape status line —
// case name, HTTP status, timing, byte counts — never typed prompts, never
// model replies, never full response bodies. Callers are responsible for
// only ever passing metadata through here (see AGENTS.md: no content
// logging anywhere, including test logs and emails).
import { appendFileSync, mkdirSync } from "node:fs";

export class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    mkdirSync(new URL(".", `file://${logPath}`).pathname, { recursive: true });
  }

  line(message) {
    const stamped = `[${new Date().toISOString()}] ${message}`;
    console.log(stamped);
    try {
      appendFileSync(this.logPath, `${stamped}\n`);
    } catch {
      // A log-write failure must never take down the run; the finalizer's
      // job is state + email, not disk logging.
    }
  }
}
