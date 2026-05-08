import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

async function readJson(filePath) {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents);
}

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
  const baseDocument = await readJson(path.join(directoryPath, baseFileName));

  console.log(`\n[${relativeDir}]`);

  for (const fileName of files) {
    const document = await readJson(path.join(directoryPath, fileName));
    const missing = getMissingKeys(baseDocument, document);

    if (fileName === baseFileName) {
      console.log(`${fileName}: baseline (${flattenObject(baseDocument).length} keys)`);
      continue;
    }

    console.log(
      `${fileName}: ${missing.length === 0 ? "complete" : `${missing.length} missing`}`,
    );

    if (missing.length > 0) {
      for (const key of missing) {
        console.log(`  - ${key}`);
      }
    }
  }
}

await reportDirectory("src/data/ui-copy", "en.json");
await reportDirectory("src/data/conversation-content", "en.json");
await reportDirectory("src/data/static-pages", "en.json");
