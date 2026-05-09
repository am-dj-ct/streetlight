import { isSupportedLanguageCode, isWeakCategory } from "./taxonomy.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertCaseArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must contain an array of prompt cases.`);
  }
}

function assertBaseCase(testCase, label) {
  if (!testCase || typeof testCase !== "object") {
    throw new Error(`${label} must be an object.`);
  }

  if (!isNonEmptyString(testCase.name)) {
    throw new Error(`${label} must include a non-empty name.`);
  }

  if (!isNonEmptyString(testCase.text)) {
    throw new Error(`${label} must include non-empty text.`);
  }
}

export function validateSmokeCases(value, label) {
  assertCaseArray(value, label);

  for (const [index, testCase] of value.entries()) {
    const caseLabel = `${label}[${index}]`;
    assertBaseCase(testCase, caseLabel);

    if (!isNonEmptyString(testCase.entryId)) {
      throw new Error(`${caseLabel} must include a non-empty entryId.`);
    }

    if (!isSupportedLanguageCode(testCase.language)) {
      throw new Error(`${caseLabel} must include a supported language code.`);
    }
  }

  return value;
}

export function validateRegressionCases(value, label) {
  assertCaseArray(value, label);

  const seenNames = new Set();

  for (const [index, testCase] of value.entries()) {
    const caseLabel = `${label}[${index}]`;
    assertBaseCase(testCase, caseLabel);

    if (seenNames.has(testCase.name)) {
      throw new Error(`${caseLabel} duplicates case name "${testCase.name}".`);
    }

    seenNames.add(testCase.name);

    if (
      testCase.language !== undefined &&
      !isSupportedLanguageCode(testCase.language)
    ) {
      throw new Error(`${caseLabel} has an invalid language.`);
    }

    if (
      testCase.expectedClassifier !== undefined &&
      !isWeakCategory(testCase.expectedClassifier)
    ) {
      throw new Error(`${caseLabel} has an invalid expectedClassifier.`);
    }
  }

  return value;
}
