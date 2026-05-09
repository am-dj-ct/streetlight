import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./lib/json-file.mjs";
import { parseStrictIsoDate } from "./lib/iso-date.mjs";
import {
  validateRegressionCases,
  validateSmokeCases,
} from "./lib/prompt-fixtures.mjs";

const cwd = process.cwd();

function fail(message) {
  throw new Error(message);
}

function extractArrayEntries(source, variableName) {
  const blockMatch = source.match(
    new RegExp(`export const ${variableName}: readonly [^=]+= \\[(.*?)\\];`, "s"),
  );

  if (!blockMatch) {
    fail(`Could not find ${variableName} in source.`);
  }

  return [...blockMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function extractObjectKeys(source, variableName) {
  const blockMatch = source.match(
    new RegExp(`const ${variableName}: Record<[^>]+> = \\{(.*?)\\n\\};`, "s"),
  );

  if (!blockMatch) {
    fail(`Could not find ${variableName} in source.`);
  }

  return [...blockMatch[1].matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]);
}

function extractIdsFromArrayBlock(source, variableName) {
  const blockMatch = source.match(
    new RegExp(`export const ${variableName}: readonly [^=]+= \\[(.*?)\\n\\];`, "s"),
  );

  if (!blockMatch) {
    fail(`Could not find ${variableName} block in source.`);
  }

  return [...blockMatch[1].matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
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

function assertNoDuplicates(label, values) {
  const seen = new Set();
  const duplicates = [];

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.push(value);
    }

    seen.add(value);
  }

  if (duplicates.length > 0) {
    fail(`${label} contains duplicate entries: ${[...new Set(duplicates)].join(", ")}.`);
  }
}

const [
  chatTypesSource,
  buttonsSource,
  promptsSource,
  englishConversationContent,
  englishStaticPages,
  promptEntries,
] = await Promise.all([
  readFile(path.join(cwd, "src/lib/chat-types.ts"), "utf8"),
  readFile(path.join(cwd, "src/lib/buttons.ts"), "utf8"),
  readFile(path.join(cwd, "src/lib/system-prompts.ts"), "utf8"),
  readJsonFile(path.join(cwd, "src/data/conversation-content/en.json")),
  readJsonFile(path.join(cwd, "src/data/static-pages/en.json")),
  readdir(path.join(cwd, "tests/prompts"), { withFileTypes: true }),
]);

const conversationEntryIds = extractArrayEntries(
  chatTypesSource,
  "conversationEntryIds",
);
const promptButtonIds = extractIdsFromArrayBlock(buttonsSource, "promptButtons");
const alternateActionIds = extractIdsFromArrayBlock(buttonsSource, "alternateActions");
const promptIds = extractObjectKeys(promptsSource, "entryPrompts");
const contentIds = Object.keys(englishConversationContent.buttons ?? {});
const promptFixtureIds = promptEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const staticPageKeys = Object.keys(englishStaticPages.pages ?? {});
const expectedStaticPageKeys = ["about", "privacy"];

assertNoDuplicates("conversationEntryIds", conversationEntryIds);
assertNoDuplicates("promptButtons", promptButtonIds);
assertNoDuplicates("alternateActions", alternateActionIds);
assertNoDuplicates("entryPrompts", promptIds);
assertNoDuplicates("conversation-content buttons", contentIds);
assertNoDuplicates("prompt fixture directories", promptFixtureIds);

assertSameSet(
  "button ids vs conversationEntryIds",
  conversationEntryIds,
  [...promptButtonIds, ...alternateActionIds],
);
assertSameSet("entryPrompts vs conversationEntryIds", conversationEntryIds, promptIds);
assertSameSet(
  "conversation-content buttons vs conversationEntryIds",
  conversationEntryIds,
  contentIds,
);
assertSameSet(
  "prompt fixture directories vs conversationEntryIds",
  conversationEntryIds,
  promptFixtureIds,
);
assertSameSet("static page keys", expectedStaticPageKeys, staticPageKeys);

for (const entryId of conversationEntryIds) {
  const content = englishConversationContent.buttons?.[entryId];

  if (!content || typeof content !== "object") {
    fail(`conversation-content is missing entry "${entryId}".`);
  }

  if (typeof content.label !== "string" || content.label.trim().length === 0) {
    fail(`conversation-content "${entryId}" is missing a non-empty label.`);
  }

  if (
    typeof content.assistantMessage !== "string" ||
    content.assistantMessage.trim().length === 0
  ) {
    fail(`conversation-content "${entryId}" is missing a non-empty assistantMessage.`);
  }

  if (!Array.isArray(content.suggestions) || content.suggestions.length === 0) {
    fail(`conversation-content "${entryId}" must include at least one suggestion.`);
  }

  const invalidSuggestion = content.suggestions.find(
    (suggestion) => typeof suggestion !== "string" || suggestion.trim().length === 0,
  );

  if (invalidSuggestion !== undefined) {
    fail(`conversation-content "${entryId}" contains a blank suggestion.`);
  }
}

for (const pageKey of expectedStaticPageKeys) {
  const page = englishStaticPages.pages?.[pageKey];

  if (!page || typeof page !== "object") {
    fail(`static-pages is missing page "${pageKey}".`);
  }

  if (typeof page.title !== "string" || page.title.trim().length === 0) {
    fail(`static-pages "${pageKey}" is missing a non-empty title.`);
  }

  if (
    typeof page.lastUpdated !== "string" ||
    parseStrictIsoDate(page.lastUpdated) === null
  ) {
    fail(`static-pages "${pageKey}" must include a valid YYYY-MM-DD lastUpdated value.`);
  }

  if (!Array.isArray(page.sections) || page.sections.length === 0) {
    fail(`static-pages "${pageKey}" must include at least one section.`);
  }

  for (const [index, section] of page.sections.entries()) {
    const sectionLabel = `static-pages "${pageKey}" section ${index + 1}`;

    if (!section || typeof section !== "object") {
      fail(`${sectionLabel} must be an object.`);
    }

    if (typeof section.heading !== "string" || section.heading.trim().length === 0) {
      fail(`${sectionLabel} is missing a non-empty heading.`);
    }

    const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
    const bullets = Array.isArray(section.bullets) ? section.bullets : [];

    if (paragraphs.length === 0 && bullets.length === 0) {
      fail(`${sectionLabel} must include paragraphs or bullets.`);
    }

    const invalidParagraph = paragraphs.find(
      (paragraph) => typeof paragraph !== "string" || paragraph.trim().length === 0,
    );

    if (invalidParagraph !== undefined) {
      fail(`${sectionLabel} contains a blank paragraph.`);
    }

    const invalidBullet = bullets.find(
      (bullet) => typeof bullet !== "string" || bullet.trim().length === 0,
    );

    if (invalidBullet !== undefined) {
      fail(`${sectionLabel} contains a blank bullet.`);
    }
  }
}

for (const entryId of conversationEntryIds) {
  const fixturePath = path.join(cwd, "tests/prompts", entryId, "cases.json");
  const fixtures = await readJsonFile(fixturePath);

  validateRegressionCases(fixtures, `tests/prompts/${entryId}/cases.json`);
}

const smokeCases = await readJsonFile(path.join(cwd, "tests/prompts/smoke-cases.json"));
validateSmokeCases(smokeCases, "tests/prompts/smoke-cases.json");

console.log(
  `Content contracts ok (${conversationEntryIds.length} conversation entries, ${promptButtonIds.length} prompt buttons, ${alternateActionIds.length} alternate actions, ${promptFixtureIds.length} prompt fixture sets, ${staticPageKeys.length} static pages).`,
);
