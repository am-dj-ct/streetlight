import {
  isOpsRequestAuthorized,
  opsUnauthorizedResponse,
} from "../../../lib/ops-auth";
import {
  getUsageSummary,
  type UsageDaySummary,
} from "../../../lib/usage-metrics";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDays(request: Request): number {
  const url = new URL(request.url);
  const parsed = Number(url.searchParams.get("days") ?? 14);

  return Number.isFinite(parsed) ? parsed : 14;
}

function sumRecord(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function topItems(values: Record<string, number>, limit = 4): string {
  const items = Object.entries(values)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);

  if (items.length === 0) {
    return "None";
  }

  return items
    .map(([key, value]) => `${escapeHtml(key)} (${value})`)
    .join(", ");
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

function buildRows(days: UsageDaySummary[]): string {
  return days
    .map(
      (day) => `<tr>
        <td>${escapeHtml(day.date)}</td>
        <td>${day.site.unique}</td>
        <td>${day.site.views}</td>
        <td>${day.chat.unique}</td>
        <td>${day.chat.requests}</td>
        <td>${day.llm.unique}</td>
        <td>${day.llm.turns}</td>
        <td>${topItems(day.chat.statuses)}</td>
        <td>${topItems(day.llm.categories)}</td>
        <td>${topItems(day.llm.models)}</td>
        <td>${formatCurrency(day.spendUsd)}</td>
      </tr>`,
    )
    .join("\n");
}

function buildHtml(summary: Awaited<ReturnType<typeof getUsageSummary>>): string {
  const totals = summary.days.reduce(
    (result, day) => ({
      chatRequests: result.chatRequests + day.chat.requests,
      chatStatuses: result.chatStatuses + sumRecord(day.chat.statuses),
      llmTurns: result.llmTurns + day.llm.turns,
      siteViews: result.siteViews + day.site.views,
      spendUsd: result.spendUsd + day.spendUsd,
    }),
    {
      chatRequests: 0,
      chatStatuses: 0,
      llmTurns: 0,
      siteViews: 0,
      spendUsd: 0,
    },
  );

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
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #d4ded7;
      background: #ffffff;
      border-radius: 8px;
    }
    table {
      border-collapse: collapse;
      min-width: 1120px;
      width: 100%;
    }
    th, td {
      border-bottom: 1px solid #e5ebe7;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #eef4ef;
      color: #263d36;
      font-size: 12px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
  </style>
</head>
<body>
  <main>
    <h1>Streetlight Usage</h1>
    <p>Aggregate counts only. No raw IPs, user agents, messages, answers, paths, or session records.</p>
    <section class="summary">
      <div class="metric"><span>Site views</span><strong>${totals.siteViews}</strong></div>
      <div class="metric"><span>Chat requests</span><strong>${totals.chatRequests}</strong></div>
      <div class="metric"><span>LLM turns</span><strong>${totals.llmTurns}</strong></div>
      <div class="metric"><span>Tracked outcomes</span><strong>${totals.chatStatuses}</strong></div>
      <div class="metric"><span>Spend</span><strong>${formatCurrency(totals.spendUsd)}</strong></div>
    </section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Site unique</th>
            <th>Site views</th>
            <th>Chat unique</th>
            <th>Chat requests</th>
            <th>LLM unique</th>
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
  if (!isOpsRequestAuthorized(request)) {
    return opsUnauthorizedResponse();
  }

  const summary = await getUsageSummary({ days: getDays(request) });

  return new Response(buildHtml(summary), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
