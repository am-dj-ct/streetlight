import { kv } from "@vercel/kv";
import { hasHashedIpSalt, hasKvConfig } from "./env";
import type { ConversationEntryId, WeakCategory } from "./chat-types";
import type { MainStatus } from "./metadata-log";
import {
  getHashedIpFromHeaders,
  type HeaderReader,
} from "./rate-limit";

const aggregateRetentionSeconds = 180 * 24 * 60 * 60;
const markerRetentionBufferSeconds = 24 * 60 * 60;
const usageVersion = "v1";

type UsageFieldMap = Record<string, number>;

export type UsageDaySummary = {
  chat: {
    requests: number;
    unique: number;
    buttons: Record<string, number>;
    languages: Record<string, number>;
    statuses: Record<string, number>;
  };
  date: string;
  llm: {
    turns: number;
    unique: number;
    categories: Record<string, number>;
    models: Record<string, number>;
  };
  site: {
    views: number;
    unique: number;
  };
  spendUsd: number;
};

export type UsageSummary = {
  days: UsageDaySummary[];
  generatedAt: string;
  retentionDays: number;
};

function getUtcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function getSecondsUntilUtcMidnight(now: Date): number {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );

  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

function getUsageDayKey(dateKey: string): string {
  return `usage:${usageVersion}:day:${dateKey}`;
}

function getSeenMarkerKey({
  dateKey,
  hashedIp,
  scope,
}: {
  dateKey: string;
  hashedIp: string;
  scope: "chat" | "llm" | "site";
}): string {
  return `usage:${usageVersion}:seen:${scope}:${dateKey}:${hashedIp}`;
}

function sanitizeFieldPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120) || "unknown";
}

async function incrementField(
  dateKey: string,
  field: string,
  amount = 1,
): Promise<void> {
  const key = getUsageDayKey(dateKey);

  await kv.hincrby(key, field, amount);
  await kv.expire(key, aggregateRetentionSeconds).catch(() => undefined);
}

async function incrementUnique({
  dateKey,
  field,
  hashedIp,
  now,
  scope,
}: {
  dateKey: string;
  field: string;
  hashedIp: null | string;
  now: Date;
  scope: "chat" | "llm" | "site";
}): Promise<void> {
  if (!hashedIp) {
    return;
  }

  const markerKey = getSeenMarkerKey({ dateKey, hashedIp, scope });
  const markerTtl =
    getSecondsUntilUtcMidnight(now) + markerRetentionBufferSeconds;
  const result = await kv.set(markerKey, "1", {
    ex: markerTtl,
    nx: true,
  });

  if (result === "OK") {
    await incrementField(dateKey, field);
  }
}

async function recordUsage(
  callback: () => Promise<void>,
): Promise<boolean> {
  if (!hasKvConfig()) {
    return false;
  }

  try {
    await callback();
    return true;
  } catch {
    return false;
  }
}

export async function recordSiteUsageFromHeaders(
  headers: HeaderReader,
): Promise<boolean> {
  if (!hasHashedIpSalt()) {
    return false;
  }

  return recordUsage(async () => {
    const now = new Date();
    const dateKey = getUtcDateKey(now);
    const hashedIp = getHashedIpFromHeaders(headers);

    await incrementField(dateKey, "site.views");
    await incrementUnique({
      dateKey,
      field: "site.unique",
      hashedIp,
      now,
      scope: "site",
    });
  });
}

export async function recordChatRequestUsage({
  hashedIp,
}: {
  hashedIp: null | string;
}): Promise<boolean> {
  return recordUsage(async () => {
    const now = new Date();
    const dateKey = getUtcDateKey(now);

    await incrementField(dateKey, "chat.requests");
    await incrementUnique({
      dateKey,
      field: "chat.unique",
      hashedIp,
      now,
      scope: "chat",
    });
  });
}

export async function recordLlmTurnStartedUsage({
  hashedIp,
}: {
  hashedIp: null | string;
}): Promise<boolean> {
  return recordUsage(async () => {
    const now = new Date();
    const dateKey = getUtcDateKey(now);

    await incrementField(dateKey, "llm.turns");
    await incrementUnique({
      dateKey,
      field: "llm.unique",
      hashedIp,
      now,
      scope: "llm",
    });
  });
}

export async function recordChatTurnOutcomeUsage({
  buttonId,
  classifierCategory,
  language,
  mainStatus,
  modelMain,
}: {
  buttonId: ConversationEntryId;
  classifierCategory: WeakCategory;
  language: string;
  mainStatus: MainStatus;
  modelMain: string;
}): Promise<boolean> {
  return recordUsage(async () => {
    const dateKey = getUtcDateKey(new Date());
    const llmReachedProvider =
      mainStatus === "completed" ||
      mainStatus === "error_no_text" ||
      mainStatus === "error_stream";
    const increments = [
      incrementField(dateKey, `chat.status.${sanitizeFieldPart(mainStatus)}`),
      incrementField(dateKey, `chat.language.${sanitizeFieldPart(language)}`),
      incrementField(dateKey, `chat.button.${sanitizeFieldPart(buttonId)}`),
    ];

    if (llmReachedProvider) {
      increments.push(
        incrementField(
          dateKey,
          `llm.category.${sanitizeFieldPart(classifierCategory)}`,
        ),
        incrementField(dateKey, `llm.model.${sanitizeFieldPart(modelMain)}`),
      );
    }

    await Promise.all(increments);
  });
}

function numberFromField(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function pickPrefix(fields: UsageFieldMap, prefix: string): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    result[key.slice(prefix.length)] = value;
  }

  return result;
}

function getDateKeys(days: number, now = new Date()): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - index);

    return getUtcDateKey(date);
  });
}

async function getDailySpendUsd(dateKey: string): Promise<number> {
  const value = await kv
    .get<string | number>(`daily-spend:${dateKey}`)
    .catch(() => 0);

  return numberFromField(value);
}

async function getUsageDaySummary(dateKey: string): Promise<UsageDaySummary> {
  const fields =
    (await kv.hgetall<UsageFieldMap>(getUsageDayKey(dateKey)).catch(() => null)) ??
    {};
  const spendUsd = await getDailySpendUsd(dateKey);

  return {
    chat: {
      buttons: pickPrefix(fields, "chat.button."),
      languages: pickPrefix(fields, "chat.language."),
      requests: numberFromField(fields["chat.requests"]),
      statuses: pickPrefix(fields, "chat.status."),
      unique: numberFromField(fields["chat.unique"]),
    },
    date: dateKey,
    llm: {
      categories: pickPrefix(fields, "llm.category."),
      models: pickPrefix(fields, "llm.model."),
      turns: numberFromField(fields["llm.turns"]),
      unique: numberFromField(fields["llm.unique"]),
    },
    site: {
      unique: numberFromField(fields["site.unique"]),
      views: numberFromField(fields["site.views"]),
    },
    spendUsd,
  };
}

export async function getUsageSummary({
  days,
}: {
  days: number;
}): Promise<UsageSummary> {
  const boundedDays = Math.max(1, Math.min(90, Math.floor(days)));
  const dateKeys = getDateKeys(boundedDays);

  if (!hasKvConfig()) {
    return {
      days: dateKeys.map((dateKey) => ({
        chat: {
          buttons: {},
          languages: {},
          requests: 0,
          statuses: {},
          unique: 0,
        },
        date: dateKey,
        llm: {
          categories: {},
          models: {},
          turns: 0,
          unique: 0,
        },
        site: {
          unique: 0,
          views: 0,
        },
        spendUsd: 0,
      })),
      generatedAt: new Date().toISOString(),
      retentionDays: aggregateRetentionSeconds / 24 / 60 / 60,
    };
  }

  return {
    days: await Promise.all(dateKeys.map((dateKey) => getUsageDaySummary(dateKey))),
    generatedAt: new Date().toISOString(),
    retentionDays: aggregateRetentionSeconds / 24 / 60 / 60,
  };
}
