import { readFile } from "node:fs/promises";
import path from "node:path";

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
  englishConversationContentRaw,
] = await Promise.all([
  readFile(path.join(cwd, "src/lib/chat-types.ts"), "utf8"),
  readFile(path.join(cwd, "src/lib/buttons.ts"), "utf8"),
  readFile(path.join(cwd, "src/lib/system-prompts.ts"), "utf8"),
  readFile(path.join(cwd, "src/data/conversation-content/en.json"), "utf8"),
]);

const conversationEntryIds = extractArrayEntries(
  chatTypesSource,
  "conversationEntryIds",
);
const promptButtonIds = extractIdsFromArrayBlock(buttonsSource, "promptButtons");
const alternateActionIds = extractIdsFromArrayBlock(buttonsSource, "alternateActions");
const promptIds = extractObjectKeys(promptsSource, "entryPrompts");
const englishConversationContent = JSON.parse(englishConversationContentRaw);
const contentIds = Object.keys(englishConversationContent.buttons ?? {});

assertNoDuplicates("conversationEntryIds", conversationEntryIds);
assertNoDuplicates("promptButtons", promptButtonIds);
assertNoDuplicates("alternateActions", alternateActionIds);
assertNoDuplicates("entryPrompts", promptIds);
assertNoDuplicates("conversation-content buttons", contentIds);

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

console.log(
  `Content contracts ok (${conversationEntryIds.length} conversation entries, ${promptButtonIds.length} prompt buttons, ${alternateActionIds.length} alternate actions).`,
);
