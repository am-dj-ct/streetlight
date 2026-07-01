import {
  clearOpsSessionCookie,
  isOpsRequestAuthorized,
  isOpsPasswordValid,
  makeOpsSessionCookie,
} from "../../../lib/ops-auth";
import {
  getDefaultUsageDays,
  getUsageSummary,
  type UsageDaySummary,
} from "../../../lib/usage-metrics";
import { getAlternateActions, getPromptButtons } from "../../../lib/buttons";
import { languageOptions } from "../../../lib/languages";

type UsageDashboardTotals = {
  chatLanguages: Record<string, number>;
  chatRequests: number;
  chatStatuses: Record<string, number>;
  chatUnique: number;
  chatSubmitClicks: number;
  chatSubmitLanguages: Record<string, number>;
  chatSubmitUnique: number;
  conversationPageViews: number;
  conversationLanguages: Record<string, number>;
  conversationPageUnique: number;
  llmCategories: Record<string, number>;
  llmModels: Record<string, number>;
  llmTurns: number;
  llmUnique: number;
  promptButtonClicks: number;
  promptButtonEntries: Record<string, number>;
  promptButtonLanguages: Record<string, number>;
  promptButtonUnique: number;
  siteUnique: number;
  siteViews: number;
  spendUsd: number;
};

type AggregateUniqueDisplays = {
  chat: number;
  chatSubmit: number;
  conversationPage: number;
  llm: number;
  promptButton: number;
  site: number;
};

const conversationLabelById: ReadonlyMap<string, string> = new Map(
  [...getPromptButtons("en"), ...getAlternateActions("en")].map((entry) => [
    entry.id,
    entry.label,
  ]),
);
const languageLabelByCode: ReadonlyMap<string, string> = new Map(
  languageOptions.map((language) => [language.code, language.label]),
);
const statusLabels: Record<string, string> = {
  blocked_abuse_controls: "Blocked: abuse controls misconfigured",
  blocked_daily_spend: "Blocked: daily spend cap",
  blocked_rate_limit: "Blocked: rate limit",
  blocked_soft_pause: "Blocked: soft pause",
  blocked_turnstile: "Blocked: human check",
  completed: "Completed",
  error_no_text: "Error: no text",
  error_request_setup: "Error: request setup",
  error_stream: "Error: stream",
  not_started: "Not started",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDays(request: Request): number {
  const url = new URL(request.url);
  const daysParam = url.searchParams.get("days");
  const parsed = daysParam ? Number(daysParam) : getDefaultUsageDays();

  return Number.isFinite(parsed) ? parsed : 1;
}

function getSecureCookieFlag(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function humanizeKey(value: string): string {
  return value
    .replace(/^openai:/, "OpenAI fallback: ")
    .replace(/[-_:.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function labelConversationEntry(value: string): string {
  return conversationLabelById.get(value) ?? humanizeKey(value);
}

function labelLanguage(value: string): string {
  return languageLabelByCode.get(value) ?? humanizeKey(value);
}

function labelStatus(value: string): string {
  return statusLabels[value] ?? humanizeKey(value);
}

function labelModel(value: string): string {
  return value.startsWith("openai:") ? humanizeKey(value) : value;
}

function addRecords(
  left: Record<string, number>,
  right: Record<string, number>,
): Record<string, number> {
  const result = { ...left };

  for (const [key, value] of Object.entries(right)) {
    result[key] = (result[key] ?? 0) + value;
  }

  return result;
}

function filterRecord(
  values: Record<string, number>,
  predicate: (key: string, value: number) => boolean,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => predicate(key, value)),
  );
}

function topItems(
  values: Record<string, number>,
  limit = 4,
  labelValue: (value: string) => string = humanizeKey,
): string {
  const items = Object.entries(values)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);

  if (items.length === 0) {
    return "None";
  }

  return items
    .map(([key, value]) => `${escapeHtml(labelValue(key))} (${value})`)
    .join(", ");
}

function buildBreakdownList({
  labelValue = humanizeKey,
  limit = 6,
  values,
}: {
  labelValue?: (value: string) => string;
  limit?: number;
  values: Record<string, number>;
}): string {
  const items = Object.entries(values)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);

  if (items.length === 0) {
    return '<p class="empty">None</p>';
  }

  return `<ol class="breakdown-list">${items
    .map(
      ([key, value]) =>
        `<li><span>${escapeHtml(labelValue(key))}</span><strong>${value}</strong></li>`,
    )
    .join("")}</ol>`;
}

function formatCountWithUnique(count: number, unique: number): string {
  return `${count} (${unique} unique)`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "n/a";
  }

  const percentage = (numerator / denominator) * 100;

  return `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

function buildMetricHtml({
  label,
  value,
  unique,
  uniqueLabel = "unique",
}: {
  label: string;
  value: number | string;
  unique?: number;
  uniqueLabel?: string;
}): string {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong>${
    unique === undefined ? "" : `<small>${unique} ${escapeHtml(uniqueLabel)}</small>`
  }</div>`;
}

function buildPanelHtml({
  body,
  subtitle,
  title,
}: {
  body: string;
  subtitle?: string;
  title: string;
}): string {
  return `<details class="panel"><summary><span class="panel-title">${escapeHtml(title)}</span><span class="panel-action"><span class="open-label">Show</span><span class="close-label">Hide</span></span></summary><div class="panel-body">${
    subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""
  }${body}</div></details>`;
}

function buildFunnelRows(totals: UsageDashboardTotals): string {
  const rows = [
    {
      from: totals.siteViews,
      label: "Site to prompt",
      to: totals.promptButtonClicks,
    },
    {
      from: totals.promptButtonClicks,
      label: "Prompt to conversation",
      to: totals.conversationPageViews,
    },
    {
      from: totals.conversationPageViews,
      label: "Conversation to submit",
      to: totals.chatSubmitClicks,
    },
    {
      from: totals.chatSubmitClicks,
      label: "Submit to chat request",
      to: totals.chatRequests,
    },
    {
      from: totals.chatRequests,
      label: "Chat request to LLM",
      to: totals.llmTurns,
    },
  ];

  return rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.to} / ${row.from}</td>
        <td>${formatPercent(row.to, row.from)}</td>
        <td>${Math.max(row.from - row.to, 0)}</td>
      </tr>`,
    )
    .join("");
}

function buildLoginHtml({
  days,
  error = false,
}: {
  days: number;
  error?: boolean;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Streetlight Usage</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      background: #f7f8f4;
      color: #071f1a;
    }
    body {
      display: grid;
      margin: 0;
      min-height: 100vh;
      place-items: center;
    }
    main {
      background: #ffffff;
      border: 1px solid #d4ded7;
      border-radius: 8px;
      box-sizing: border-box;
      max-width: 420px;
      padding: 28px;
      width: calc(100% - 32px);
    }
    h1 {
      font-size: 24px;
      margin: 0 0 8px;
    }
    p {
      color: #42524d;
      line-height: 1.4;
      margin: 0 0 18px;
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    input {
      border: 1px solid #9fb4aa;
      border-radius: 8px;
      box-sizing: border-box;
      font: inherit;
      margin-bottom: 14px;
      padding: 12px;
      width: 100%;
    }
    button {
      background: #245f4f;
      border: 0;
      border-radius: 8px;
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      padding: 12px 16px;
      width: 100%;
    }
    .error {
      color: #9f241b;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>Streetlight Usage</h1>
    <p>Enter the ops password to view aggregate usage counts.</p>
    ${error ? '<p class="error">That password did not work.</p>' : ""}
    <form method="post" action="/ops/usage?days=${days}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
      <button type="submit">Open dashboard</button>
    </form>
  </main>
</body>
</html>`;
}

function buildRows(days: UsageDaySummary[]): string {
  return days
    .map(
      (day) => `<tr>
        <td>${escapeHtml(day.date)}</td>
        <td>${formatCountWithUnique(day.site.views, day.site.unique)}</td>
        <td>${formatCountWithUnique(
          day.funnel.promptButtonClicks,
          day.funnel.promptButtonUnique,
        )}</td>
        <td>${formatCountWithUnique(
          day.funnel.conversationPageViews,
          day.funnel.conversationPageUnique,
        )}</td>
        <td>${formatCountWithUnique(
          day.funnel.chatSubmitClicks,
          day.funnel.chatSubmitUnique,
        )}</td>
        <td>${formatCountWithUnique(day.chat.requests, day.chat.unique)}</td>
        <td>${formatCountWithUnique(day.llm.turns, day.llm.unique)}</td>
        <td>${topItems(day.chat.statuses)}</td>
        <td>${topItems(day.llm.categories)}</td>
        <td>${topItems(day.llm.models)}</td>
        <td>${formatCurrency(day.spendUsd)}</td>
      </tr>`,
    )
    .join("\n");
}

function getAggregateUniqueDisplays(
  summary: Awaited<ReturnType<typeof getUsageSummary>>,
): AggregateUniqueDisplays {
  return {
    chat: summary.periodUnique.chat,
    chatSubmit: summary.periodUnique.chatSubmit,
    conversationPage: summary.periodUnique.conversationPage,
    llm: summary.periodUnique.llm,
    promptButton: summary.periodUnique.promptButton,
    site: summary.periodUnique.site,
  };
}

function buildHtml(summary: Awaited<ReturnType<typeof getUsageSummary>>): string {
  const totals = summary.days.reduce<UsageDashboardTotals>(
    (result, day) => ({
      chatLanguages: addRecords(result.chatLanguages, day.chat.languages),
      chatRequests: result.chatRequests + day.chat.requests,
      chatStatuses: addRecords(result.chatStatuses, day.chat.statuses),
      chatUnique: result.chatUnique + day.chat.unique,
      chatSubmitClicks:
        result.chatSubmitClicks + day.funnel.chatSubmitClicks,
      chatSubmitLanguages: addRecords(
        result.chatSubmitLanguages,
        day.funnel.chatSubmitLanguages,
      ),
      chatSubmitUnique:
        result.chatSubmitUnique + day.funnel.chatSubmitUnique,
      conversationPageViews:
        result.conversationPageViews + day.funnel.conversationPageViews,
      conversationLanguages: addRecords(
        result.conversationLanguages,
        day.funnel.conversationLanguages,
      ),
      conversationPageUnique:
        result.conversationPageUnique + day.funnel.conversationPageUnique,
      llmCategories: addRecords(result.llmCategories, day.llm.categories),
      llmModels: addRecords(result.llmModels, day.llm.models),
      llmTurns: result.llmTurns + day.llm.turns,
      llmUnique: result.llmUnique + day.llm.unique,
      promptButtonClicks:
        result.promptButtonClicks + day.funnel.promptButtonClicks,
      promptButtonEntries: addRecords(
        result.promptButtonEntries,
        day.funnel.promptButtonEntries,
      ),
      promptButtonLanguages: addRecords(
        result.promptButtonLanguages,
        day.funnel.promptButtonLanguages,
      ),
      promptButtonUnique:
        result.promptButtonUnique + day.funnel.promptButtonUnique,
      siteUnique: result.siteUnique + day.site.unique,
      siteViews: result.siteViews + day.site.views,
      spendUsd: result.spendUsd + day.spendUsd,
    }),
    {
      chatLanguages: {},
      chatRequests: 0,
      chatStatuses: {},
      chatUnique: 0,
      chatSubmitClicks: 0,
      chatSubmitLanguages: {},
      chatSubmitUnique: 0,
      conversationPageViews: 0,
      conversationLanguages: {},
      conversationPageUnique: 0,
      llmCategories: {},
      llmModels: {},
      llmTurns: 0,
      llmUnique: 0,
      promptButtonClicks: 0,
      promptButtonEntries: {},
      promptButtonLanguages: {},
      promptButtonUnique: 0,
      siteUnique: 0,
      siteViews: 0,
      spendUsd: 0,
    },
  );
  const aggregateUnique = getAggregateUniqueDisplays(summary);
  const cleanHomepageViews = summary.periodCounts.siteViews;
  const cleanConversationPageViews = summary.periodCounts.conversationPageViews;
  const funnelTotals: UsageDashboardTotals = {
    ...totals,
    conversationPageViews: cleanConversationPageViews,
    siteViews: cleanHomepageViews,
  };
  const blockedOrErrorStatuses = filterRecord(
    totals.chatStatuses,
    (key) => key !== "completed",
  );
  const newestDate = summary.days[0]?.date ?? "";
  const oldestDate = summary.days.at(-1)?.date ?? newestDate;
  const rangeLabel =
    oldestDate && newestDate && oldestDate !== newestDate
      ? `${oldestDate} through ${newestDate}`
      : newestDate;
  const aggregateUniqueLabel = `unique since ${summary.periodUnique.trackingStartedDate}`;
  const homepageUniqueLabel = `unique since ${summary.periodCounts.trackingStartedDate}`;
  const conversationUniqueLabel = `unique since ${summary.periodCounts.conversationTrackingStartedDate}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Streetlight Usage</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      background: #f7f8f4;
      color: #071f1a;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
    }
    h1 {
      font-size: 28px;
      margin: 0 0 6px;
    }
    p {
      color: #42524d;
      margin: 0 0 24px;
    }
    .summary {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-bottom: 24px;
    }
    .metric {
      border: 1px solid #d4ded7;
      background: #ffffff;
      border-radius: 8px;
      padding: 14px;
    }
    .metric span {
      display: block;
      color: #586761;
      font-size: 12px;
      text-transform: uppercase;
    }
    .metric strong {
      display: block;
      font-size: 24px;
      margin-top: 6px;
    }
    .metric small {
      color: #586761;
      display: block;
      font-size: 13px;
      margin-top: 4px;
    }
    .insights {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-bottom: 16px;
    }
    .panel {
      border: 1px solid #d4ded7;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
    }
    .panel summary {
      align-items: center;
      cursor: pointer;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      list-style: none;
      min-height: 38px;
      padding: 0 10px;
    }
    .panel summary::-webkit-details-marker {
      display: none;
    }
    .panel summary:focus-visible {
      outline: 2px solid #245f4f;
      outline-offset: -2px;
    }
    .panel-title {
      color: #263d36;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .panel-action {
      border: 1px solid #d4ded7;
      border-radius: 999px;
      color: #405047;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
      white-space: nowrap;
    }
    .close-label {
      display: none;
    }
    .panel[open] .open-label {
      display: none;
    }
    .panel[open] .close-label {
      display: inline;
    }
    .panel-body {
      border-top: 1px solid #edf1ee;
      padding: 12px;
    }
    .panel-body h3 {
      color: #263d36;
      font-size: 12px;
      margin: 14px 0 8px;
      text-transform: uppercase;
    }
    .panel-body p {
      color: #586761;
      font-size: 13px;
      line-height: 1.4;
      margin: 0 0 12px;
    }
    .breakdown-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .breakdown-list li {
      align-items: baseline;
      border-bottom: 1px solid #edf1ee;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 7px 0;
    }
    .breakdown-list li:last-child {
      border-bottom: 0;
    }
    .breakdown-list span {
      color: #1d2a22;
      font-size: 14px;
      line-height: 1.35;
    }
    .breakdown-list strong {
      font-size: 14px;
      white-space: nowrap;
    }
    .empty {
      color: #586761;
      font-size: 14px;
      margin: 0;
    }
    .funnel-table {
      border-collapse: collapse;
      width: 100%;
    }
    .funnel-table th, .funnel-table td {
      border-bottom: 1px solid #edf1ee;
      font-size: 13px;
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
    }
    .funnel-table th {
      color: #586761;
      font-size: 11px;
      text-transform: uppercase;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #d4ded7;
      background: #ffffff;
      border-radius: 8px;
    }
    .table-wrap table {
      border-collapse: collapse;
      min-width: 1120px;
      width: 100%;
    }
    .table-wrap th, .table-wrap td {
      border-bottom: 1px solid #e5ebe7;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    .table-wrap th {
      background: #eef4ef;
      color: #263d36;
      font-size: 12px;
      text-transform: uppercase;
    }
    .table-wrap tr:last-child td {
      border-bottom: 0;
    }
  </style>
</head>
<body>
  <main>
    <h1>Streetlight Usage</h1>
    <p>Daily table covers ${escapeHtml(rangeLabel)}. Homepage views use a clean browser-open counter started ${escapeHtml(
      summary.periodCounts.trackingStartedDate,
    )}; conversation views use a clean page-open counter started ${escapeHtml(
      summary.periodCounts.conversationTrackingStartedDate,
    )}. Earlier site-view and conversation-view rows are legacy context. No raw IPs, user agents, messages, answers, paths, or session records.</p>
    <section class="summary">
      ${buildMetricHtml({
        label: "Homepage views",
        unique: summary.periodCounts.siteUnique,
        uniqueLabel: homepageUniqueLabel,
        value: cleanHomepageViews,
      })}
      ${buildMetricHtml({
        label: "Prompt clicks",
        unique: aggregateUnique.promptButton,
        uniqueLabel: aggregateUniqueLabel,
        value: totals.promptButtonClicks,
      })}
      ${buildMetricHtml({
        label: "Conversation views",
        unique: summary.periodCounts.conversationPageUnique,
        uniqueLabel: conversationUniqueLabel,
        value: cleanConversationPageViews,
      })}
      ${buildMetricHtml({
        label: "Submit clicks",
        unique: aggregateUnique.chatSubmit,
        uniqueLabel: aggregateUniqueLabel,
        value: totals.chatSubmitClicks,
      })}
      ${buildMetricHtml({
        label: "Chat requests",
        unique: aggregateUnique.chat,
        uniqueLabel: aggregateUniqueLabel,
        value: totals.chatRequests,
      })}
      ${buildMetricHtml({
        label: "LLM turns",
        unique: aggregateUnique.llm,
        uniqueLabel: aggregateUniqueLabel,
        value: totals.llmTurns,
      })}
      ${buildMetricHtml({
        label: "Spend",
        value: formatCurrency(totals.spendUsd),
      })}
    </section>
    <section class="insights">
      ${buildPanelHtml({
        body: `<table class="funnel-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Moved</th>
              <th>Rate</th>
              <th>Dropoff</th>
            </tr>
          </thead>
          <tbody>${buildFunnelRows(funnelTotals)}</tbody>
        </table>`,
        subtitle: "Homepage and conversation steps use clean counters; direct links can make later steps higher than earlier steps.",
        title: "Dropoff",
      })}
      ${buildPanelHtml({
        body: `<h3>Prompt clicks</h3>${buildBreakdownList({
          labelValue: labelLanguage,
          values: totals.promptButtonLanguages,
        })}<h3>Chat requests</h3>${buildBreakdownList({
          labelValue: labelLanguage,
          values: totals.chatLanguages,
        })}`,
        subtitle: "Aggregate language counts for early intent and actual chat requests.",
        title: "Language",
      })}
      ${buildPanelHtml({
        body: buildBreakdownList({
          labelValue: labelConversationEntry,
          values: totals.promptButtonEntries,
        }),
        subtitle: "Which first-screen prompts people choose.",
        title: "Starting buttons",
      })}
      ${buildPanelHtml({
        body: buildBreakdownList({
          labelValue: labelStatus,
          values: blockedOrErrorStatuses,
        }),
        subtitle: "Blocks and failures before or during a chat turn.",
        title: "Blocks and errors",
      })}
      ${buildPanelHtml({
        body: buildBreakdownList({
          labelValue: humanizeKey,
          values: totals.llmCategories,
        }),
        subtitle: "Classifier labels from completed or provider-reached turns.",
        title: "Weak categories",
      })}
      ${buildPanelHtml({
        body: buildBreakdownList({
          labelValue: labelModel,
          values: totals.llmModels,
        }),
        subtitle: "Shows primary, Anthropic fallback, and rare OpenAI fallback model usage.",
        title: "Models",
      })}
    </section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Daily site views</th>
            <th>Prompt clicks</th>
            <th>Conversation views</th>
            <th>Submit clicks</th>
            <th>Chat requests</th>
            <th>LLM turns</th>
            <th>Outcomes</th>
            <th>Categories</th>
            <th>Models</th>
            <th>Spend</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(summary.days)}
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

export async function GET(request: Request) {
  const days = getDays(request);
  const url = new URL(request.url);

  if (url.searchParams.get("logout") === "1") {
    return new Response(null, {
      headers: {
        "Cache-Control": "no-store",
        Location: `/ops/usage?days=${days}`,
        "Set-Cookie": clearOpsSessionCookie(),
      },
      status: 303,
    });
  }

  if (!isOpsRequestAuthorized(request)) {
    return new Response(buildLoginHtml({ days }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
      status: 200,
    });
  }

  const summary = await getUsageSummary({ days });

  return new Response(buildHtml(summary), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export async function POST(request: Request) {
  const days = getDays(request);
  const formData = await request.formData().catch(() => null);
  const passwordEntry = formData?.get("password");
  const password = typeof passwordEntry === "string" ? passwordEntry : null;

  if (!isOpsPasswordValid(password)) {
    return new Response(buildLoginHtml({ days, error: true }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
      status: 401,
    });
  }

  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: `/ops/usage?days=${days}`,
      "Set-Cookie": makeOpsSessionCookie({
        secure: getSecureCookieFlag(request),
      }),
    },
    status: 303,
  });
}
