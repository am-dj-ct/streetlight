import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseStrictIsoDate } from "./lib/iso-date.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith("--")) {
      fail(`Unexpected argument: ${current}`);
    }

    const key = current.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const date = args.date ?? new Date().toISOString().slice(0, 10);
const dryRun = args["dry-run"] === "true";

if (parseStrictIsoDate(date) === null) {
  fail("Date must use a valid YYYY-MM-DD calendar date.");
}

if (!args.what || !args.action || !args.outcome) {
  fail("Usage: node scripts/append-sev3-note.mjs --what \"...\" --action \"...\" --outcome \"...\" [--follow-up \"...\"] [--date YYYY-MM-DD]");
}

const followUp = args["follow-up"] ?? "None noted yet.";
const root = process.cwd();
const logPath = path.join(root, "incidents", "log.md");
let current = await readFile(logPath, "utf8");

const entry = [
  `- Date: ${date}`,
  `- What happened: ${args.what}`,
  `- First action taken: ${args.action}`,
  `- Outcome: ${args.outcome}`,
  `- Follow-up needed: ${followUp}`,
  "",
  "---",
  "",
].join("\n");

current = current.replace(/\n## Entries\n\nNone yet\.\n?$/, "\n## Entries\n\n");
current += entry;

if (dryRun) {
  console.log(`Would update ${path.relative(root, logPath)}`);
  console.log("");
  console.log(entry);
  process.exit(0);
}

await writeFile(logPath, current);

console.log(`Updated ${path.relative(root, logPath)}`);
