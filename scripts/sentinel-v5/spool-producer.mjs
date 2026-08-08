// Sentinel-v5 spool PRODUCER path — spec v5.9 §3.1, producer path only.
//
// ============================================================================
// CROSS-REPO COORDINATION FLAG (read before touching this file)
// ============================================================================
// Per SPEC-2026-08-06-sentinel-fleet-v5.md §3.1, the producer path is meant
// to be "the shared helper" every job in the fleet calls — one implementation,
// reused fleet-wide, living in blt-hub's src/sentinel-v5/spool.ts (merged via
// blt-hub PR #300). Checked 2026-08-07/08: blt-hub's package.json has no
// "exports"/"bin"/"files" field, and its compiled dist/ is gitignored — there
// is no installable-package or shared-install path a sibling repo can pull
// that helper from today. This lane (streetlight's sentinel-v5 wiring, per
// docs/sentinel-wiring spec) follows the same pattern caller-track already
// used: implement against the documented spool contract directly, with the
// integration point isolated in one module (this file), and flag cross-repo
// helper packaging as an open coordination item for the Sentinel coordinator.
//
// This file is a deliberately narrowed port of blt-hub's spoolProduceCheckin
// (spool.ts), itself re-derived from caller-track's own port at
// scripts/sentinel-v5/spool-producer.mjs (same contract, same directory
// layout, same filename format, same fsync ordering, same lock semantics):
// PRODUCER PATH ONLY. Streetlight never consumes the spool (the consumer,
// sweep, and recovery loops are blt-hub's), so this file omits spool.ts's
// SentinelV5Spool class, quota sweep, and recovery logic entirely —
// reproducing them here would be dead code this repo can never exercise, and
// every unexercised line is a line that can silently drift from the real
// contract. What IS ported (write path, locking, ring eviction, size
// validation) is ported faithfully so that when blt-hub ships a consumable
// package, migrating this repo to it is a pure import swap with no behavior
// change, not a re-derivation.
// ============================================================================

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalSha256Hex, canonicalizeJcs } from "./canonical.mjs";
import { isGroupItem, isKnownItem } from "./item-registry.mjs";
import { validateCheckinShape } from "./checkin-schema.mjs";

export const SENTINEL_V5_ROOT_ENV = "SENTINEL_V5_SPOOL_ROOT";
export const SPOOL_DIRS = ["tmp", "incoming", "processing", "quarantine", "done"];

export const SPOOL_DEFAULT_LIMITS = {
  maxPayloadBytes: 64 * 1024,
  ringSize: 50,
  lockStaleMs: 10 * 60 * 1000,
};

export class SentinelV5SpoolError extends Error {}

export function resolveSpoolRoot(env = process.env) {
  return env[SENTINEL_V5_ROOT_ENV]?.trim() || join(homedir(), ".blt-sentinel", "spool");
}

export function ensureSpoolDirs(root) {
  for (const dir of SPOOL_DIRS) {
    mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
  }
  mkdirSync(join(root, "locks"), { recursive: true, mode: 0o700 });
}

export function spoolFilename(item, runId, hash) {
  // §3.1: `<item>__<run_id>__<full sha256 hex of canonical payload>.json`.
  return `${item}__${runId}__${hash}.json`;
}

const SPOOL_FILENAME_PATTERN =
  /^([a-z0-9][a-z0-9-]{0,63})__\1-(\d{10,14})-(\d{1,7})__([0-9a-f]{64})\.json$/;

export function parseSpoolFilename(name) {
  const match = SPOOL_FILENAME_PATTERN.exec(name);
  if (!match) return undefined;
  const item = match[1];
  const epoch = match[2];
  const pid = match[3];
  return { item, runId: `${item}-${epoch}-${pid}`, hash: match[4], runEpochMs: Number(epoch) };
}

function isFsError(error, ...codes) {
  return Boolean(error && typeof error === "object" && "code" in error && codes.includes(error.code));
}

function fsyncDir(dir) {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function oldestFirst(a, b) {
  if (a.mtime !== b.mtime) return a.mtime - b.mtime;
  const ea = parseSpoolFilename(a.name)?.runEpochMs ?? Number.MAX_SAFE_INTEGER;
  const eb = parseSpoolFilename(b.name)?.runEpochMs ?? Number.MAX_SAFE_INTEGER;
  if (ea !== eb) return ea - eb;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function listSpoolEntries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => parseSpoolFilename(name) !== undefined)
    .map((name) => {
      try {
        const stats = statSync(join(dir, name));
        return { name, mtime: stats.mtimeMs, size: stats.size };
      } catch (error) {
        if (isFsError(error, "ENOENT")) return undefined;
        throw new SentinelV5SpoolError(`stat failed on ${join(dir, name)}: ${error.code ?? error}`);
      }
    })
    .filter((entry) => entry !== undefined)
    .sort(oldestFirst);
}

/**
 * Producer path (§3.1) — serialized per item by a per-item mkdir lock.
 * Never blocks indefinitely, never silently rejects: oversize is replaced
 * in-band; an unknown item or malformed payload throws to the caller (this
 * repo's callers are all in-process shell/node wrappers, so a thrown error
 * is a loud failure, not a silent drop).
 */
export function spoolProduceCheckin(root, checkin, limits = SPOOL_DEFAULT_LIMITS) {
  ensureSpoolDirs(root);
  if (!isKnownItem(checkin.item)) {
    throw new SentinelV5SpoolError(`unknown item: ${checkin.item}`);
  }
  const isGroup = isGroupItem(checkin.item);
  let payload = validateCheckinShape({ ...checkin, overwrote_prior: false }, isGroup);
  let replaced = null;
  let canonical = canonicalizeJcs(payload);
  if (Buffer.byteLength(canonical, "utf8") > limits.maxPayloadBytes) {
    // §3.1 step 1 — oversize is REPLACED by a minimal red check-in.
    const minimal = {
      schema: 2,
      item: payload.item,
      repo: payload.repo,
      status: "red",
      at: payload.at,
      slot: payload.slot,
      run_id: payload.run_id,
      reason_code: "oversize",
      overwrote_prior: false,
      ...(isGroup ? { children: [] } : {}),
      evidence_ref: payload.evidence_ref,
    };
    payload = validateCheckinShape(minimal, isGroup);
    canonical = canonicalizeJcs(payload);
    replaced = "oversize";
  }

  const lockDir = join(root, "locks", `item-${payload.item}.lock`);
  const lockToken = acquireLock(lockDir, limits.lockStaleMs);
  try {
    // §3.1 step 2 — ring eviction: if incoming holds >= ringSize for this
    // item, unlink oldest until <= ringSize - 1 (evict-below-then-add).
    let evicted = 0;
    for (;;) {
      const mine = listSpoolEntries(join(root, "incoming")).filter((entry) =>
        entry.name.startsWith(`${payload.item}__`),
      );
      if (mine.length < limits.ringSize) break;
      const target = mine[0].name;
      try {
        unlinkSync(join(root, "incoming", target));
        evicted += 1;
      } catch (error) {
        if (!isFsError(error, "ENOENT")) {
          throw new SentinelV5SpoolError(`ring eviction failed on ${target}: ${error.code ?? error}`);
        }
      }
      if (evicted > 0 && !payload.overwrote_prior) {
        // overwrote_prior flips BEFORE hashing (§3.1 step 2).
        payload = { ...payload, overwrote_prior: true };
        canonical = canonicalizeJcs(payload);
      }
    }

    // §3.1 step 3 — write tmp, fsync file, rename into incoming, fsync dir.
    const hash = canonicalSha256Hex(payload);
    const filename = spoolFilename(payload.item, payload.run_id, hash);
    const tmpPath = join(root, "tmp", filename);
    const fd = openSync(tmpPath, "w", 0o600);
    try {
      writeFileSync(fd, canonical, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, join(root, "incoming", filename));
    fsyncDir(join(root, "incoming"));
    return { admitted: true, filename, replaced, evicted };
  } finally {
    releaseLock(lockDir, lockToken);
  }
}

// ---- mkdir lock with ownership token + liveness-checked staleness break ---
// Ported from spool.ts's acquireLock/releaseLock (same semantics: owner file
// records "<pid>-<epoch>-<nonce>"; a stale break requires BOTH the age
// threshold AND the recorded holder pid being dead, unless past 6x the
// threshold (pid-reuse hard cap)).

function acquireLock(lockDir, staleMs) {
  const token = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new SentinelV5SpoolError(`lock acquisition timeout: ${lockDir}`);
    }
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner"), token, "utf8");
      if (readLockOwner(lockDir) !== token) {
        busyWaitMs(10);
        continue;
      }
      return token;
    } catch (error) {
      if (isFsError(error, "ENOENT")) {
        mkdirSync(join(lockDir, ".."), { recursive: true, mode: 0o700 });
        continue;
      }
      if (!isFsError(error, "EEXIST")) throw error;
      const observedOwner = readLockOwner(lockDir) ?? "<no-owner>";
      const staleOwner = lockIsBreakableFor(lockDir, staleMs, observedOwner) ? observedOwner : undefined;
      if (staleOwner !== undefined) {
        const tombstone = `${lockDir}.stale-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
        try {
          renameSync(lockDir, tombstone);
          const renamedOwner = readLockOwner(tombstone) ?? "<no-owner>";
          if (renamedOwner !== staleOwner) {
            renameSync(tombstone, lockDir);
          } else {
            rmSync(tombstone, { recursive: true, force: true });
          }
        } catch {
          // Lost the break race — retry the acquire loop.
        }
        continue;
      }
      busyWaitMs(10);
    }
  }
}

function lockIsBreakableFor(lockDir, staleMs, observedOwner) {
  let age;
  try {
    age = Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return false;
  }
  if ((readLockOwner(lockDir) ?? "<no-owner>") !== observedOwner) return false;
  if (age <= staleMs) return false;
  if (age > staleMs * 6) return true;
  const pid = pidFromOwner(observedOwner);
  if (pid === undefined) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function pidFromOwner(owner) {
  const pid = Number(owner.split("-")[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function readLockOwner(lockDir) {
  try {
    return readFileSync(join(lockDir, "owner"), "utf8");
  } catch {
    return undefined;
  }
}

function releaseLock(lockDir, token) {
  try {
    const owner = readFileSync(join(lockDir, "owner"), "utf8");
    if (owner !== token) return;
    unlinkSync(join(lockDir, "owner"));
    rmdirSync(lockDir);
  } catch {
    // Already broken; nothing to release.
  }
}

function busyWaitMs(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Deliberate synchronous spin — lock windows here are microseconds to
    // low-milliseconds (mkdir + single small file write), matching spool.ts.
  }
}
