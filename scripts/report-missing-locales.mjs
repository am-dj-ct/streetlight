import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./lib/json-file.mjs";

const cwd = process.cwd();
const summaryOnly = process.argv.includes("--summary");

function flattenObject(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenObject(value, nextKey);
    }

    return [nextKey];
  });
}

function getMissingKeys(baseValue, compareValue, prefix = "") {
  return Object.entries(baseValue).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    const compareEntry = compareValue?.[key];

    if (Array.isArray(value)) {
      return Array.isArray(compareEntry) && compareEntry.length > 0 ? [] : [nextKey];
    }

    if (value && typeof value === "object") {
      return getMissingKeys(value, compareEntry ?? {}, nextKey);
    }

    return compareEntry === undefined ? [nextKey] : [];
  });
}

async function reportDirectory(relativeDir, baseFileName) {
  const directoryPath = path.join(cwd, relativeDir);
  const files = (await readdir(directoryPath)).filter((name) => name.endsWith(".json"));
  const baseDocument = await readJsonFile(path.join(directoryPath, baseFileName));
  let totalMissing = 0;
  let incompleteFiles = 0;
  const incompleteSummaries = [];

  console.log(`\n[${relativeDir}]`);

  for (const fileName of files) {
    const document = await readJsonFile(path.join(directoryPath, fileName));
    const missing = getMissingKeys(baseDocument, document);

    if (fileName === baseFileName) {
      console.log(`${fileName}: baseline (${flattenObject(baseDocument).length} keys)`);
      continue;
    }

    const fileSummary =
      missing.length === 0 ? "complete" : `${missing.length} missing`;
    console.log(`${fileName}: ${fileSummary}`);

    if (missing.length > 0) {
      incompleteFiles += 1;
      totalMissing += missing.length;
      incompleteSummaries.push(`${fileName} (${missing.length})`);

      if (!summaryOnly) {
        for (const key of missing) {
          console.log(`  - ${key}`);
        }
      }
    }
  }

  console.log(
    `Summary: ${incompleteFiles} incomplete file(s), ${totalMissing} missing key(s)`,
  );

  if (summaryOnly && incompleteSummaries.length > 0) {
    console.log(`Incomplete files: ${incompleteSummaries.join(", ")}`);
  }
}

await reportDirectory("src/data/ui-copy", "en.json");
await reportDirectory("src/data/conversation-content", "en.json");
await reportDirectory("src/data/static-pages", "en.json");
