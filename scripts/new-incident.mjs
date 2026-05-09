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

function normalizeSeverity(value) {
  if (!value) {
    return "Sev-2";
  }

  const normalized = value.toLowerCase();

  if (normalized === "sev-1" || normalized === "1") {
    return "Sev-1";
  }

  if (normalized === "sev-2" || normalized === "2") {
    return "Sev-2";
  }

  fail("Severity must be Sev-1, Sev-2, 1, or 2.");
}

function normalizeStatus(value) {
  if (!value) {
    return "Draft";
  }

  if (value === "Draft" || value === "Final") {
    return value;
  }

  fail("Status must be Draft or Final.");
}

const args = parseArgs(process.argv.slice(2));
const openedDate = args.opened ?? new Date().toISOString().slice(0, 10);
const slug = args.slug;

if (!slug) {
  fail("Usage: node scripts/new-incident.mjs --slug short-name [--severity Sev-1|Sev-2] [--status Draft|Final] [--opened YYYY-MM-DD] [--resolved YYYY-MM-DD]");
}

if (!/^[a-z0-9-]+$/.test(slug)) {
  fail("Slug must use lowercase letters, numbers, and hyphens only.");
}

const parsedOpenedDate = parseStrictIsoDate(openedDate);

if (parsedOpenedDate === null) {
  fail("Opened date must use YYYY-MM-DD.");
}

const resolvedDate = args.resolved ?? "";
const parsedResolvedDate = resolvedDate ? parseStrictIsoDate(resolvedDate) : null;

if (resolvedDate && parsedResolvedDate === null) {
  fail("Resolved date must use YYYY-MM-DD.");
}

if (
  parsedResolvedDate !== null &&
  parsedOpenedDate !== null &&
  parsedResolvedDate < parsedOpenedDate
) {
  fail("Resolved date cannot be earlier than opened date.");
}

const severity = normalizeSeverity(args.severity);
const status = normalizeStatus(args.status);
const dryRun = args["dry-run"] === "true";
const root = process.cwd();
const templatePath = path.join(root, "incidents", "TEMPLATE.md");
const outputPath = path.join(root, "incidents", `${openedDate}-${slug}.md`);

const template = await readFile(templatePath, "utf8");
const output = template
  .replace("# YYYY-MM-DD-shortname", `# ${openedDate}-${slug}`)
  .replace("Severity: Sev-1 or Sev-2", `Severity: ${severity}`)
  .replace("Status: Draft / Final", `Status: ${status}`)
  .replace("Date opened:", `Date opened: ${openedDate}`)
  .replace("Date resolved:", `Date resolved: ${resolvedDate}`);

if (dryRun) {
  console.log(`Would create ${path.relative(root, outputPath)}`);
  console.log("");
  console.log(output);
  process.exit(0);
}

await writeFile(outputPath, output, { flag: "wx" });

console.log(`Created ${path.relative(root, outputPath)}`);
