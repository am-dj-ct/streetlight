// Cron-schedule slot resolution — ported from blt-hub master's
// src/sentinel-v5/{cron.ts,engine.ts} (spec v5.9 §3.2), via caller-track's
// own port at scripts/sentinel-v5/cron-slot.mjs (same fix history below).
//
// FIX (caller-track's Codex round-1 review, finding #2, carried forward
// here): a naive first pass captured `slot` as plain "now", not the item's
// actual schedule slot. blt-hub's real consumer (engine.ts's
// validateSlotClaim) requires the claimed slot to be a real cron slot for
// THAT item's schedule, or the check-in records as red(slot_mismatch)
// regardless of its claimed status. This file computes the real "latest
// slot at or before now" the same way blt-hub's own captureInvocationSlot
// does, driven by this repo's own registry fragment.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

export class SentinelV5CronError extends Error {}

const FIELD_BOUNDS = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 },  // day of week (0 and 7 are Sunday)
];

export function parseCron(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new SentinelV5CronError(`cron must have 5 fields: ${expression}`);
  }
  const sets = fields.map((field, index) => parseField(field, FIELD_BOUNDS[index].min, FIELD_BOUNDS[index].max));
  const dow = sets[4];
  if (dow.has(7)) dow.add(0);
  return {
    minutes: sets[0],
    hours: sets[1],
    dom: sets[2],
    months: sets[3],
    dow,
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
  };
}

function parseField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    const stepMatch = /^(.+?)\/(\d+)$/.exec(part);
    const base = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (!Number.isInteger(step) || step < 1) throw new SentinelV5CronError(`bad step in: ${field}`);
    let lo, hi;
    if (base === "*") {
      lo = min;
      hi = max;
    } else {
      const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(base);
      if (!rangeMatch) throw new SentinelV5CronError(`bad field: ${field}`);
      lo = Number(rangeMatch[1]);
      hi = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : lo;
    }
    if (lo < min || hi > max || lo > hi) throw new SentinelV5CronError(`out of range: ${field}`);
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  if (values.size === 0) throw new SentinelV5CronError(`empty field: ${field}`);
  return values;
}

function cronDayMatches(spec, year, month, day) {
  if (!spec.months.has(month)) return false;
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const domMatch = spec.dom.has(day);
  const dowMatch = spec.dow.has(dow);
  if (spec.domRestricted && spec.dowRestricted) return domMatch || dowMatch;
  if (spec.domRestricted) return domMatch;
  if (spec.dowRestricted) return dowMatch;
  return true;
}

const formatterCache = new Map();

function zoneFormatter(tz) {
  let formatter = formatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formatterCache.set(tz, formatter);
  }
  return formatter;
}

export function zonedParts(utcMs, tz) {
  const parts = zoneFormatter(tz).formatToParts(new Date(utcMs));
  const get = (type) => {
    const part = parts.find((entry) => entry.type === type);
    if (!part) throw new SentinelV5CronError(`missing ${type} from Intl parts`);
    return Number(part.value);
  };
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export function localToUtc(tz, parts) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = desired;
  for (let round = 0; round < 3; round += 1) {
    const seen = zonedParts(guess, tz);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    const diff = desired - seenAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  const roundTrip = zonedParts(guess, tz);
  if (roundTrip.year !== parts.year || roundTrip.month !== parts.month || roundTrip.day !== parts.day
    || roundTrip.hour !== parts.hour || roundTrip.minute !== parts.minute) {
    return undefined;
  }
  for (const deltaMs of [7_200_000, 3_600_000, 1_800_000]) {
    const earlier = guess - deltaMs;
    const earlierParts = zonedParts(earlier, tz);
    if (earlierParts.year === parts.year && earlierParts.month === parts.month && earlierParts.day === parts.day
      && earlierParts.hour === parts.hour && earlierParts.minute === parts.minute) {
      return earlier;
    }
  }
  return guess;
}

export function isScheduleSlot(schedule, utcMs) {
  if (utcMs % 60_000 !== 0) return false;
  const spec = parseCron(schedule.cron);
  const parts = zonedParts(utcMs, schedule.tz);
  return cronDayMatches(spec, parts.year, parts.month, parts.day)
    && spec.hours.has(parts.hour)
    && spec.minutes.has(parts.minute)
    && localToUtc(schedule.tz, parts) === utcMs;
}

export function slotsBetween(schedule, fromMsExclusive, toMsInclusive) {
  if (toMsInclusive <= fromMsExclusive) return [];
  const spec = parseCron(schedule.cron);
  const slots = [];
  const startParts = zonedParts(fromMsExclusive, schedule.tz);
  const endParts = zonedParts(toMsInclusive, schedule.tz);
  let cursor = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endDate = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  const hours = [...spec.hours].sort((a, b) => a - b);
  const minutes = [...spec.minutes].sort((a, b) => a - b);
  while (cursor <= endDate) {
    const date = new Date(cursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (cronDayMatches(spec, year, month, day)) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const utc = localToUtc(schedule.tz, { year, month, day, hour, minute });
          if (utc === undefined) continue;
          if (utc > fromMsExclusive && utc <= toMsInclusive) slots.push(utc);
        }
      }
    }
    cursor += 86_400_000;
  }
  slots.sort((a, b) => a - b);
  return slots;
}

const ARMING_HORIZONS_MS = [32 * 86_400_000, 400 * 86_400_000, 8 * 366 * 86_400_000];

function normalizeSlotIso(slotIso) {
  const ms = Date.parse(slotIso);
  if (!Number.isFinite(ms)) return slotIso;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The latest slot at or before `now`, matching blt-hub's captureInvocationSlot. */
export function captureInvocationSlot(schedule, now = new Date()) {
  const nowMs = now.getTime();
  for (const horizon of ARMING_HORIZONS_MS) {
    const slots = slotsBetween(schedule, nowMs - horizon, nowMs);
    const last = slots[slots.length - 1];
    if (last !== undefined) return normalizeSlotIso(new Date(last).toISOString());
  }
  return undefined;
}

// ---- streetlight registry fragment lookup (this repo's own schedules) ----

let cachedFragment;

export function loadFragmentSchedules() {
  if (cachedFragment) return cachedFragment;
  const here = dirname(fileURLToPath(import.meta.url));
  const fragmentPath = join(here, "..", "..", "config", "sentinel-v5-registry-fragment.streetlight.json");
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  cachedFragment = new Map(fragment.items.map((item) => [item.id, item.schedule]));
  return cachedFragment;
}

/**
 * Resolve the invocation-start slot for a registered item, using THIS repo's
 * own registry fragment as the schedule source (the cross-repo registry
 * snapshot blt-hub's real producer helper reads isn't reachable from here —
 * same documented gap as spool-producer.mjs's item-registry.mjs).
 */
export function slotForItem(item, now = new Date()) {
  const schedules = loadFragmentSchedules();
  const schedule = schedules.get(item);
  if (!schedule) {
    throw new SentinelV5CronError(`no schedule for item: ${item}`);
  }
  const slot = captureInvocationSlot(schedule, now);
  if (slot === undefined) {
    throw new SentinelV5CronError(`no slot found for item ${item} within the search horizon`);
  }
  return slot;
}
