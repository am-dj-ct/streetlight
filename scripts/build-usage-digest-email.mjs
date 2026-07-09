import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
const outputPath = args.output ?? "tmp/usage-digest-email.md";
const baseUrl = normalizeBaseUrl(
  args.baseUrl ?? process.env.STREETLIGHT_BASE_URL ?? "https://streetlight.help",
);
const days = normalizeDays(args.days ?? process.env.USAGE_DIGEST_DAYS ?? "180");
const reportDate = args.date ?? getPreviousUtcDateKey(new Date());
const opsReadToken = process.env.OPS_READ_TOKEN;

if (!opsReadToken) {
  throw new Error("OPS_READ_TOKEN is required.");
}

const summary = await fetchUsageSummary({ baseUrl, days, opsReadToken });
const body = buildUsageDigest({ reportDate, summary });

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, body, "utf8");

console.log(`Wrote usage digest for ${reportDate} to ${outputPath}`);

async function fetchUsageSummary({ baseUrl, days, opsReadToken }) {
  const url = new URL("/api/ops/usage", baseUrl);
  url.searchParams.set("days", String(days));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opsReadToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Usage summary fetch failed: ${response.status} ${detail.slice(0, 500)}`,
    );
  }

  const summary = await response.json();

  if (!summary || !Array.isArray(summary.days)) {
    throw new Error("Usage summary response did not include a days array.");
  }

  return summary;
}

function buildUsageDigest({ reportDate, summary }) {
  const daily = getDay(summary, reportDate);
  const periodCounts = summary.periodCounts ?? {};
  const periodUnique = summary.periodUnique ?? {};
  const returnedDays = Array.isArray(summary.days) ? summary.days : [];
  const actionStartDate =
    periodUnique.trackingStartedDate ?? periodUnique.startDate ?? "2026-06-27";
  const launchStartDate = periodUnique.startDate ?? "2026-06-24";
  const actionRows = returnedDays.filter((day) => day.date >= actionStartDate);
  const launchRows = returnedDays.filter((day) => day.date >= launchStartDate);
  const cumulativePromptClicks = sum(actionRows, (day) =>
    numberValue(day.funnel?.promptButtonClicks),
  );
  const cumulativeSubmitClicks = sum(actionRows, (day) =>
    numberValue(day.funnel?.chatSubmitClicks),
  );
  const cumulativeChatRequests = sum(actionRows, (day) =>
    numberValue(day.chat?.requests),
  );
  const cumulativeLlmTurns = sum(actionRows, (day) =>
    numberValue(day.llm?.turns),
  );
  const cumulativeSpend = sum(launchRows, (day) => numberValue(day.spendUsd));
  const generatedAt = summary.generatedAt
    ? `Generated from Streetlight usage data at ${summary.generatedAt}.`
    : null;
  const rows = [
    [
      "Homepage",
      `${daily.site.unique} unique / ${daily.site.views} opens`,
      `${numberValue(periodCounts.siteUnique)} unique / ${numberValue(periodCounts.siteViews)} opens since ${periodCounts.trackingStartedDate ?? "2026-07-01"}`,
    ],
    [
      "Conversation",
      `${daily.funnel.conversationPageUnique} unique / ${daily.funnel.conversationPageViews} opens`,
      `${numberValue(periodCounts.conversationPageUnique)} unique / ${numberValue(periodCounts.conversationPageViews)} opens since ${periodCounts.conversationTrackingStartedDate ?? "2026-07-01"}`,
    ],
    [
      "Prompt starts",
      `${daily.funnel.promptButtonUnique} unique / ${daily.funnel.promptButtonClicks} clicks`,
      `${numberValue(periodUnique.promptButton)} unique / ${cumulativePromptClicks} clicks since ${actionStartDate}`,
    ],
    [
      "Submit",
      `${daily.funnel.chatSubmitUnique} unique / ${daily.funnel.chatSubmitClicks} clicks`,
      `${numberValue(periodUnique.chatSubmit)} unique / ${cumulativeSubmitClicks} clicks since ${actionStartDate}`,
    ],
    [
      "Chat API",
      `${daily.chat.unique} unique / ${daily.chat.requests} requests`,
      `${numberValue(periodUnique.chat)} unique / ${cumulativeChatRequests} requests since ${actionStartDate}`,
    ],
    [
      "LLM",
      `${daily.llm.unique} unique / ${daily.llm.turns} turns`,
      `${numberValue(periodUnique.llm)} unique / ${cumulativeLlmTurns} turns since ${actionStartDate}`,
    ],
    [
      "Spend",
      formatUsd(daily.spendUsd),
      `${formatUsd(cumulativeSpend)} since ${launchStartDate}`,
    ],
  ];
  const dailyDetails = formatOptionalDailyDetails(daily);
  const lines = [
    `# Streetlight usage digest - ${reportDate}`,
    "",
    "Aggregate counts only. No raw IPs, user agents, messages, answers, paths, or session records.",
    "",
    generatedAt,
    "",
    formatTableRow([
      "Metric",
      `Last complete UTC day (${reportDate})`,
      "Cumulative",
    ]),
    formatTableRow(["---", "---", "---"]),
    ...rows.map(formatTableRow),
  ];

  if (dailyDetails.length > 0) {
    lines.push(
      "",
      "## Daily details",
      "",
      formatTableRow(["Item", "Count"]),
      formatTableRow(["---", "---"]),
      ...dailyDetails.map(formatTableRow),
    );
  }

  lines.push("");

  return lines.filter((line) => line !== null).join("\n");
}

function formatOptionalDailyDetails(day) {
  const statuses = formatTopEntries(day.chat.statuses);
  const categories = formatTopEntries(day.llm.categories);
  const models = formatTopEntries(day.llm.models);
  const rows = [];

  if (statuses !== "None") {
    rows.push(["Outcomes", statuses]);
  }

  if (categories !== "None") {
    rows.push(["Weak category flags", categories]);
  }

  if (models !== "None") {
    rows.push(["Models", models]);
  }

  return rows;
}

function formatTableRow(cells) {
  return `| ${cells.map(formatTableCell).join(" | ")} |`;
}

function formatTableCell(value) {
  return String(value).replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function formatTopEntries(values, limit = 5) {
  const entries = Object.entries(values ?? {})
    .map(([label, count]) => [label, numberValue(count)])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (entries.length === 0) {
    return "None";
  }

  return entries.map(([label, count]) => `${label} (${count})`).join(", ");
}

function getDay(summary, reportDate) {
  const day = summary.days.find((candidate) => candidate.date === reportDate);

  if (day) {
    return normalizeDay(day);
  }

  return emptyDay(reportDate);
}

function normalizeDay(day) {
  return {
    chat: {
      requests: numberValue(day.chat?.requests),
      statuses: day.chat?.statuses ?? {},
      unique: numberValue(day.chat?.unique),
    },
    date: day.date,
    funnel: {
      chatSubmitClicks: numberValue(day.funnel?.chatSubmitClicks),
      chatSubmitUnique: numberValue(day.funnel?.chatSubmitUnique),
      conversationPageUnique: numberValue(day.funnel?.conversationPageUnique),
      conversationPageViews: numberValue(day.funnel?.conversationPageViews),
      promptButtonClicks: numberValue(day.funnel?.promptButtonClicks),
      promptButtonUnique: numberValue(day.funnel?.promptButtonUnique),
    },
    llm: {
      categories: day.llm?.categories ?? {},
      models: day.llm?.models ?? {},
      turns: numberValue(day.llm?.turns),
      unique: numberValue(day.llm?.unique),
    },
    site: {
      unique: numberValue(day.site?.unique),
      views: numberValue(day.site?.views),
    },
    spendUsd: numberValue(day.spendUsd),
  };
}

function emptyDay(date) {
  return normalizeDay({
    chat: {
      requests: 0,
      statuses: {},
      unique: 0,
    },
    date,
    funnel: {
      chatSubmitClicks: 0,
      chatSubmitUnique: 0,
      conversationPageUnique: 0,
      conversationPageViews: 0,
      promptButtonClicks: 0,
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
  });
}

function sum(values, selector) {
  return values.reduce((total, value) => total + selector(value), 0);
}

function numberValue(value) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value) {
  return `$${numberValue(value).toFixed(2)}`;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString();
}

function normalizeDays(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 180;
  }

  return Math.max(1, Math.min(180, Math.floor(parsed)));
}

function getPreviousUtcDateKey(now) {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );

  return date.toISOString().slice(0, 10);
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];

    if (!name.startsWith("--")) {
      continue;
    }

    const value = values[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }

    parsed[name.slice(2)] = value;
    index += 1;
  }

  return parsed;
}
