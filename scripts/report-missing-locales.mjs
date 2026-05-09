import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./lib/json-file.mjs";
import {
  isSupportedLanguageCode,
  supportedLanguageCodes,
} from "./lib/taxonomy.mjs";

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

function fail(message) {
  throw new Error(message);
}

function assertSameSet(label, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));

  if (missing.length === 0 && extra.length === 0) {
    return;
  }

  const parts = [];

  if (missing.length > 0) {
    parts.push(`missing: ${missing.join(", ")}`);
  }

  if (extra.length > 0) {
    parts.push(`extra: ${extra.join(", ")}`);
  }

  fail(`${label} mismatch (${parts.join("; ")}).`);
}

function assertLocaleMetadata(document, languageCode, relativePath) {
  if (!document || typeof document !== "object") {
    fail(`${relativePath} must contain a JSON object.`);
  }

  if (!document.meta || typeof document.meta !== "object") {
    fail(`${relativePath} must include a meta object.`);
  }

  if (document.meta.languageCode !== languageCode) {
    fail(`${relativePath} must declare meta.languageCode="${languageCode}".`);
  }

  if (typeof document.meta.translated !== "boolean") {
    fail(`${relativePath} must declare meta.translated as a boolean.`);
  }

  if (
    document.meta.inherits !== undefined &&
    document.meta.inherits !== "en" &&
    document.meta.inherits !== languageCode
  ) {
    fail(`${relativePath} has unsupported meta.inherits="${document.meta.inherits}".`);
  }
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

function getExtraKeys(baseValue, compareValue, prefix = "") {
  if (!compareValue || typeof compareValue !== "object" || Array.isArray(compareValue)) {
    return [];
  }

  return Object.entries(compareValue).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    const baseEntry = baseValue?.[key];

    if (prefix === "meta" && key === "inherits") {
      return [];
    }

    if (baseEntry === undefined) {
      return [nextKey];
    }

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseEntry &&
      typeof baseEntry === "object" &&
      !Array.isArray(baseEntry)
    ) {
      return getExtraKeys(baseEntry, value, nextKey);
    }

    return [];
  });
}

async function reportDirectory(relativeDir, baseFileName) {
  const directoryPath = path.join(cwd, relativeDir);
  const files = (await readdir(directoryPath)).filter((name) => name.endsWith(".json"));
  const expectedFiles = supportedLanguageCodes.map((code) => `${code}.json`);

  assertSameSet(`${relativeDir} locale files`, expectedFiles, files);

  const baseDocument = await readJsonFile(path.join(directoryPath, baseFileName));
  assertLocaleMetadata(baseDocument, "en", path.join(relativeDir, baseFileName));

  if (baseDocument.meta.translated !== true) {
    fail(`${path.join(relativeDir, baseFileName)} must be marked translated.`);
  }

  let totalMissing = 0;
  let incompleteFiles = 0;
  const incompleteSummaries = [];

  console.log(`\n[${relativeDir}]`);

  for (const fileName of files) {
    const languageCode = path.basename(fileName, ".json");

    if (!isSupportedLanguageCode(languageCode)) {
      fail(`${relativeDir}/${fileName} is not a supported language file.`);
    }

    const document = await readJsonFile(path.join(directoryPath, fileName));
    assertLocaleMetadata(document, languageCode, path.join(relativeDir, fileName));

    const missing = getMissingKeys(baseDocument, document);
    const extra = getExtraKeys(baseDocument, document);

    if (extra.length > 0) {
      fail(`${path.join(relativeDir, fileName)} contains extra keys: ${extra.join(", ")}.`);
    }

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
