// Proves run-ui-sentry.sh publishes the digest summary on EVERY way it can
// end, and that nothing about publishing can change its exit code.
//
// The wrapper is copied into a scratch tree next to stub neighbours, so no
// real sentinel check-in, Doppler call, browser or GitHub request happens.
// The stub publisher just records that it was called. macOS only, like the
// rest of the wrapper (BSD stat in its stale-lock check).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function scratch({ publisher = "process.exit(0);", withNodeModules = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ui-sentry-wrapper-"));
  const sentryDir = path.join(root, "scripts", "ui-sentry");
  mkdirSync(path.join(sentryDir, "lib"), { recursive: true });
  mkdirSync(path.join(root, "scripts", "sentinel-v5"), { recursive: true });
  copyFileSync(path.join(here, "run-ui-sentry.sh"), path.join(sentryDir, "run-ui-sentry.sh"));
  chmodSync(path.join(sentryDir, "run-ui-sentry.sh"), 0o755);
  writeFileSync(
    path.join(root, "scripts", "sentinel-v5", "checkin-lib.sh"),
    "sentinel_capture_invocation() { :; }\nsentinel_doppler_run() { return \"${STUB_ORCHESTRATOR_EXIT:-0}\"; }\n",
  );
  writeFileSync(
    path.join(sentryDir, "lib", "sentinel-emit.sh"),
    "UI_SENTRY_LAST_SUCCESS_AT=\"\"\nsentinel_emit_item_a() { :; }\nsentinel_emit_item_b() { :; }\n",
  );
  const marker = path.join(root, "publish-called");
  writeFileSync(
    path.join(sentryDir, "publish-result.mjs"),
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(marker)}, "called\\n");\n${publisher}\n`,
  );
  if (withNodeModules) mkdirSync(path.join(sentryDir, "node_modules"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, path.join(bin, "node"));
  return { root, sentryDir, marker, bin, stateRoot: path.join(root, "state") };
}

function run(s, { path: pathValue, env = {} } = {}) {
  return spawnSync("bash", [path.join(s.sentryDir, "run-ui-sentry.sh"), "--live"], {
    env: {
      HOME: s.root,
      PATH: pathValue ?? `${s.bin}:/usr/bin:/bin`,
      UI_SENTRY_CAFFEINATED: "1",
      UI_SENTRY_STATE_ROOT: s.stateRoot,
      ...env,
    },
    encoding: "utf8",
    timeout: 30_000,
  });
}

const called = (s) => existsSync(s.marker);

test("normal ending: orchestrator exit code is preserved and the summary is published", () => {
  const s = scratch();
  try {
    // doppler must resolve on PATH for the preflight to pass
    writeFileSync(path.join(s.bin, "doppler"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(s.bin, "doppler"), 0o755);
    const result = run(s, { env: { STUB_ORCHESTRATOR_EXIT: "1" } });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(called(s));
    assert.equal(existsSync(path.join(s.stateRoot, "run.lock")), false, "lock released");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a crashing or failing publisher never changes the exit code", () => {
  for (const publisher of ["process.exit(9);", "throw new Error('boom');"]) {
    const s = scratch({ publisher });
    try {
      writeFileSync(path.join(s.bin, "doppler"), "#!/bin/sh\nexit 0\n");
      chmodSync(path.join(s.bin, "doppler"), 0o755);
      assert.equal(run(s, { env: { STUB_ORCHESTRATOR_EXIT: "2" } }).status, 2);
      assert.equal(run(s, { env: { STUB_ORCHESTRATOR_EXIT: "0" } }).status, 0);
      assert.ok(called(s));
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  }
});

test("PATH-preflight early exit (exit 5) still publishes", () => {
  const s = scratch(); // no doppler on PATH
  try {
    const result = run(s);
    assert.equal(result.status, 5, result.stderr);
    assert.ok(called(s));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("node_modules-missing early exit (exit 4) still publishes", () => {
  const s = scratch({ withNodeModules: false });
  try {
    writeFileSync(path.join(s.bin, "doppler"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(s.bin, "doppler"), 0o755);
    const result = run(s);
    assert.equal(result.status, 4, result.stderr);
    assert.ok(called(s));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("lock-held early exit (exit 3) publishes and leaves the other run's lock alone", () => {
  const s = scratch();
  try {
    writeFileSync(path.join(s.bin, "doppler"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(s.bin, "doppler"), 0o755);
    mkdirSync(path.join(s.stateRoot, "run.lock"), { recursive: true });
    const result = run(s);
    assert.equal(result.status, 3, result.stderr);
    assert.ok(called(s));
    assert.ok(existsSync(path.join(s.stateRoot, "run.lock")), "must not release a lock it does not own");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("UI_SENTRY_PUBLISH=0 skips publishing without changing anything else", () => {
  const s = scratch();
  try {
    writeFileSync(path.join(s.bin, "doppler"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(s.bin, "doppler"), 0o755);
    const result = run(s, { env: { UI_SENTRY_PUBLISH: "0", STUB_ORCHESTRATOR_EXIT: "1" } });
    assert.equal(result.status, 1);
    assert.equal(called(s), false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("usage errors exit 2 before any publishing is armed", () => {
  const s = scratch();
  try {
    const result = spawnSync("bash", [path.join(s.sentryDir, "run-ui-sentry.sh")], {
      env: { HOME: s.root, PATH: `${s.bin}:/usr/bin:/bin`, UI_SENTRY_CAFFEINATED: "1", UI_SENTRY_STATE_ROOT: s.stateRoot },
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.equal(called(s), false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
