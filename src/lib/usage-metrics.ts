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
const periodUniqueVersion = "v2";
const periodUniqueTrackingStartedDateKey = "2026-06-27";
const usageVersion = "v1";
const usageLaunchDateKey = "2026-06-24";
const millisecondsPerDay = 24 * 60 * 60 * 1000;

type UsageFieldMap = Record<string, number>;
type UniqueScope =
  | "chat"
  | "chat_submit"
  | "conversation_page"
  | "llm"
  | "prompt_button"
  | "site";
export type FunnelClickEventType = "chat_submit_click" | "prompt_button_click";

export type UsageDaySummary = {
  chat: {
    requests: number;
    unique: number;
    buttons: Record<string, number>;
    languages: Record<string, number>;
    statuses: Record<string, number>;
  };
  date: string;
  funnel: {
    chatSubmitClicks: number;
    chatSubmitEntries: Record<string, number>;
    chatSubmitLanguages: Record<string, number>;
    chatSubmitUnique: number;
    conversationEntries: Record<string, number>;
    conversationLanguages: Record<string, number>;
    conversationPageUnique: number;
    conversationPageViews: number;
    promptButtonClicks: number;
    promptButtonEntries: Record<string, number>;
    promptButtonLanguages: Record<string, number>;
    promptButtonUnique: number;
  };
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
  periodCounts: {
    siteViews: number;
    trackingStartedDate: string;
  };
  periodUnique: {
    chat: number;
    chatSubmit: number;
    conversationPage: number;
    llm: number;
    promptButton: number;
    site: number;
    startDate: string;
    trackingStartedDate: string;
  };
  retentionDays: number;
};

export function getDefaultUsageDays(now = new Date()): number {
  const launchDate = new Date(`${usageLaunchDateKey}T00:00:00.000Z`);
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const elapsedDays = Math.floor(
    (todayUtc - launchDate.getTime()) / millisecondsPerDay,
  );

  return Math.max(1, elapsedDays + 1);
}

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

function getUsagePeriodKey(): string {
  return `usage:${usageVersion}:period_unique:${periodUniqueVersion}:${periodUniqueTrackingStartedDateKey}`;
}

function getSeenMarkerKey({
  dateKey,
  hashedIp,
  scope,
}: {
  dateKey: string;
  hashedIp: string;
  scope: UniqueScope;
}): string {
  return `usage:${usageVersion}:seen:${scope}:${dateKey}:${hashedIp}`;
}

function getPeriodSeenMarkerKey({
  hashedIp,
  scope,
}: {
  hashedIp: string;
  scope: UniqueScope;
}): string {
  return `usage:${usageVersion}:period_seen:${periodUniqueVersion}:${scope}:${periodUniqueTrackingStartedDateKey}:${hashedIp}`;
}

function sanitizeFieldPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120) || "unknown";
}

function isLikelyAutomatedRequest(headers: HeaderReader): boolean {
  const userAgent = headers.get("user-agent")?.toLowerCase() ?? "";
  const purpose = headers.get("purpose")?.toLowerCase() ?? "";
  const secPurpose = headers.get("sec-purpose")?.toLowerCase() ?? "";
  const nextRouterPrefetch = headers.get("next-router-prefetch");

  if (
    purpose.includes("prefetch") ||
    secPurpose.includes("prefetch") ||
    nextRouterPrefetch === "1"
  ) {
    return true;
  }

  if (!userAgent) {
    return true;
  }

  return /bot|crawler|spider|preview|facebookexternalhit|slackbot|discordbot|telegrambot|linkedinbot|twitterbot|whatsapp|embedly|pinterest|headlesschrome|curl|wget|python-requests|go-http-client|uptime|monitor/i.test(
    userAgent,
  );
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

async function incrementPeriodField(field: string, amount = 1): Promise<void> {
  const key = getUsagePeriodKey();

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
  scope: UniqueScope;
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

async function incrementPeriodUnique({
  field,
  hashedIp,
  scope,
}: {
  field: string;
  hashedIp: null | string;
  scope: UniqueScope;
}): Promise<void> {
  if (!hashedIp) {
    return;
  }

  const markerKey = getPeriodSeenMarkerKey({ hashedIp, scope });
  const result = await kv.set(markerKey, "1", {
    ex: aggregateRetentionSeconds,
    nx: true,
  });

  if (result === "OK") {
    await incrementPeriodField(field);
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
  if (!hasHashedIpSalt() || isLikelyAutomatedRequest(headers)) {
    return false;
  }

  return recordUsage(async () => {
    const now = new Date();
    const dateKey = getUtcDateKey(now);
    const hashedIp = getHashedIpFromHeaders(headers);

    await Promise.all([
      incrementField(dateKey, "site.views"),
      incrementUnique({
        dateKey,
        field: "site.unique",
        hashedIp,
        now,
        scope: "site",
      }),
      incrementPeriodField("site.views"),
      incrementPeriodUnique({
        field: "site.unique",
        hashedIp,
        scope: "site",
      }),
    ]);
  });
}

export async function recordConversationPageViewUsage({
  entryId,
  headers,
  language,
}: {
  entryId: ConversationEntryId;
  headers: HeaderReader;
  language: string;
}): Promise<boolean> {
  if (!hasHashedIpSalt() || isLikelyAutomatedRequest(headers)) {
    return false;
  }

  return recordUsage(async () => {
    const now = new Date();
    const dateKey = getUtcDateKey(now);
    const hashedIp = getHashedIpFromHeaders(headers);

    await Promise.all([
      incrementField(dateKey, "funnel.conversation_page.views"),
      incrementField(
        dateKey,
        `funnel.conversation_page.entry.${sanitizeFieldPart(entryId)}`,
      ),
      incrementField(
        dateKey,
        `funnel.conversation_page.language.${sanitizeFieldPart(language)}`,
      ),
      incrementUnique({
        dateKey,
        field: "funnel.conversation_page.unique",
        hashedIp,
        now,
        scope: "conversation_page",
      }),
      incrementPeriodUnique({
        field: "funnel.conversation_page.unique",
        hashedIp,
        scope: "conversation_page",
      }),
    ]);
  });
}

export async function recordFunnelClickUsage({
  entryId,
  eventType,
  hashedIp,
  language,
}: {
  entryId: ConversationEntryId;
  eventType: FunnelClickEventType;
  hashedIp: null | string;
  language: string;
}): Promise<boolean> {
  return recordUsage(async () => {
    const now = new Date();
    const dateKey = getUtcDateKey(now);

    if (eventType === "prompt_button_click") {
      await Promise.all([
        incrementField(dateKey, "funnel.prompt_button.clicks"),
        incrementField(
          dateKey,
          `funnel.prompt_button.entry.${sanitizeFieldPart(entryId)}`,
        ),
        incrementField(
          dateKey,
          `funnel.prompt_button.language.${sanitizeFieldPart(language)}`,
        ),
        incrementUnique({
          dateKey,
          field: "funnel.prompt_button.unique",
          hashedIp,
          now,
          scope: "prompt_button",
        }),
        incrementPeriodUnique({
          field: "funnel.prompt_button.unique",
          hashedIp,
          scope: "prompt_button",
        }),
      ]);
      return;
    }

    await Promise.all([
      incrementField(dateKey, "funnel.chat_submit.clicks"),
      incrementField(
        dateKey,
        `funnel.chat_submit.entry.${sanitizeFieldPart(entryId)}`,
      ),
      incrementField(
        dateKey,
        `funnel.chat_submit.language.${sanitizeFieldPart(language)}`,
      ),
      incrementUnique({
        dateKey,
        field: "funnel.chat_submit.unique",
        hashedIp,
        now,
        scope: "chat_submit",
      }),
      incrementPeriodUnique({
        field: "funnel.chat_submit.unique",
        hashedIp,
        scope: "chat_submit",
      }),
    ]);
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
    await incrementPeriodUnique({
      field: "chat.unique",
      hashedIp,
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
    await incrementPeriodUnique({
      field: "llm.unique",
      hashedIp,
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
    funnel: {
      chatSubmitClicks: numberFromField(fields["funnel.chat_submit.clicks"]),
      chatSubmitEntries: pickPrefix(fields, "funnel.chat_submit.entry."),
      chatSubmitLanguages: pickPrefix(fields, "funnel.chat_submit.language."),
      chatSubmitUnique: numberFromField(fields["funnel.chat_submit.unique"]),
      conversationEntries: pickPrefix(fields, "funnel.conversation_page.entry."),
      conversationLanguages: pickPrefix(
        fields,
        "funnel.conversation_page.language.",
      ),
      conversationPageUnique: numberFromField(
        fields["funnel.conversation_page.unique"],
      ),
      conversationPageViews: numberFromField(
        fields["funnel.conversation_page.views"],
      ),
      promptButtonClicks: numberFromField(fields["funnel.prompt_button.clicks"]),
      promptButtonEntries: pickPrefix(fields, "funnel.prompt_button.entry."),
      promptButtonLanguages: pickPrefix(fields, "funnel.prompt_button.language."),
      promptButtonUnique: numberFromField(fields["funnel.prompt_button.unique"]),
    },
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

async function getUsagePeriodUniqueSummary(): Promise<UsageSummary["periodUnique"]> {
  const fields =
    (await kv.hgetall<UsageFieldMap>(getUsagePeriodKey()).catch(() => null)) ?? {};

  return {
    chat: numberFromField(fields["chat.unique"]),
    chatSubmit: numberFromField(fields["funnel.chat_submit.unique"]),
    conversationPage: numberFromField(fields["funnel.conversation_page.unique"]),
    llm: numberFromField(fields["llm.unique"]),
    promptButton: numberFromField(fields["funnel.prompt_button.unique"]),
    site: numberFromField(fields["site.unique"]),
    startDate: usageLaunchDateKey,
    trackingStartedDate: periodUniqueTrackingStartedDateKey,
  };
}

async function getUsagePeriodCountSummary(): Promise<UsageSummary["periodCounts"]> {
  const fields =
    (await kv.hgetall<UsageFieldMap>(getUsagePeriodKey()).catch(() => null)) ?? {};

  return {
    siteViews: numberFromField(fields["site.views"]),
    trackingStartedDate: periodUniqueTrackingStartedDateKey,
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
        funnel: {
          chatSubmitClicks: 0,
          chatSubmitEntries: {},
          chatSubmitLanguages: {},
          chatSubmitUnique: 0,
          conversationEntries: {},
          conversationLanguages: {},
          conversationPageUnique: 0,
          conversationPageViews: 0,
          promptButtonClicks: 0,
          promptButtonEntries: {},
          promptButtonLanguages: {},
          promptButtonUnique: 0,
        },
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
      periodCounts: {
        siteViews: 0,
        trackingStartedDate: periodUniqueTrackingStartedDateKey,
      },
      periodUnique: {
        chat: 0,
        chatSubmit: 0,
        conversationPage: 0,
        llm: 0,
        promptButton: 0,
        site: 0,
        startDate: usageLaunchDateKey,
        trackingStartedDate: periodUniqueTrackingStartedDateKey,
      },
      retentionDays: aggregateRetentionSeconds / 24 / 60 / 60,
    };
  }

  return {
    days: await Promise.all(dateKeys.map((dateKey) => getUsageDaySummary(dateKey))),
    generatedAt: new Date().toISOString(),
    periodCounts: await getUsagePeriodCountSummary(),
    periodUnique: await getUsagePeriodUniqueSummary(),
    retentionDays: aggregateRetentionSeconds / 24 / 60 / 60,
  };
}
