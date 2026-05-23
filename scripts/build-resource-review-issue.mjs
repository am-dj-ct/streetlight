import { readFile, writeFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));

if (!args.report || !args.output || !args.runUrl) {
  throw new Error("--report, --output, and --run-url are required.");
}

const report = await readFile(args.report, "utf8");
const summary = parseSummary(report);
const reviewEntries = parseNeedsReviewEntries(report);
const body = renderIssueBody({ reviewEntries, runUrl: args.runUrl, summary });

await writeFile(args.output, body);

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

    parsed[toCamelCase(name.slice(2))] = value;
    index += 1;
  }

  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseSummary(reportText) {
  const getCount = (label) => {
    const match = reportText.match(new RegExp(`^- ${label}: (\\d+)`, "m"));
    return match ? Number.parseInt(match[1], 10) : 0;
  };

  return {
    fetchFailed: getCount("Fetch failed"),
    needsReview: getCount("Needs manual review"),
    total: getCount("Total resources checked"),
  };
}

function parseNeedsReviewEntries(reportText) {
  const sectionMatch = reportText.match(
    /## Needs Manual Review\n\n([\s\S]*?)(?:\n## Looks Unchanged|\n$)/,
  );

  if (!sectionMatch) {
    return [];
  }

  return sectionMatch[1]
    .split(/\n(?=### )/)
    .map((entryText) => entryText.trim())
    .filter(Boolean)
    .map(parseEntry);
}

function parseEntry(entryText) {
  const lines = entryText.split("\n");
  const titleMatch = lines[0].match(/^### (.+?) \/ (.+?) - (.+)$/);
  const sourceMatch = entryText.match(/^- Source: \[(.+?)\]\((.+?)\)$/m);
  const userFacingUrlMatch = entryText.match(
    /^- User-facing URL: \[(.+?)\]\((.+?)\)$/m,
  );
  const maintainedPhonesMatch = entryText.match(/^- Maintained phone\(s\): (.+)$/m);
  const notes = [];

  for (const match of entryText.matchAll(/^  - (.+)$/gm)) {
    notes.push(match[1]);
  }

  return {
    displayName: titleMatch?.[3] ?? "Unknown resource",
    id: titleMatch?.[2] ?? "unknown-id",
    maintainedPhones: maintainedPhonesMatch?.[1] ?? "none",
    notes,
    sourceUrl: sourceMatch?.[2] ?? "",
    userFacingUrl: userFacingUrlMatch?.[2] ?? "",
  };
}

function renderIssueBody({ reviewEntries, runUrl, summary }) {
  const lines = [
    "The scheduled resource check found a few things to review.",
    "",
    "What to do:",
    "",
    "1. Open each source link below.",
    "2. Check whether the listed phone and page still match Streetlight's data.",
    "3. Come back to Codex or Claude Code and say what you found.",
    "4. If it still matches, ask Codex to update `lastVerified` for that resource.",
    "5. If it changed, ask Codex to update the phone, URL, or description, then update `lastVerified`.",
    "",
    `Full run: ${runUrl}`,
    "",
    `Checked ${summary.total} resources. ${summary.needsReview} need review. ${summary.fetchFailed} fetch failed.`,
    "",
    "## Review These",
    "",
  ];

  for (const entry of reviewEntries) {
    lines.push(
      `- [ ] **${entry.displayName}** (\`${entry.id}\`)`,
      `  - Source to open: ${entry.sourceUrl}`,
      `  - Streetlight page: ${entry.userFacingUrl}`,
      `  - Phone in Streetlight: ${entry.maintainedPhones}`,
      `  - Why it was flagged: ${entry.notes.join("; ") || "Scrape-assisted check flagged it."}`,
      "",
    );
  }

  return `${lines.join("\n").trim()}\n`;
}
