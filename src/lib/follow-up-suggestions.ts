export const followUpSuggestionsPrompt = `You write short follow-up buttons for Streetlight.

Read the assistant response and return a JSON array of 1 to 3 strings.

Rules:
- Each string should be something the user might naturally tap next.
- Keep each string under 80 characters.
- Use plain language.
- Match the language of the assistant response.
- Do not ask for private identifying information.
- Do not include explanations, markdown, or object keys.
- Return only valid JSON.

Example:
["Help me write the reply","What should I do first?","What should I ask for?"]`;

const maxSuggestionCount = 3;
const maxSuggestionLength = 80;

export function parseFollowUpSuggestions(value: string): string[] {
  let parsed: unknown;
  const trimmedValue = value.trim();
  const unfencedValue = trimmedValue
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const arrayStart = unfencedValue.indexOf("[");
  const arrayEnd = unfencedValue.lastIndexOf("]");
  const jsonCandidate =
    arrayStart >= 0 && arrayEnd > arrayStart
      ? unfencedValue.slice(arrayStart, arrayEnd + 1)
      : unfencedValue;

  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    parsed = unfencedValue
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")
          .replace(/^["']|["'],?$/g, "")
          .trim(),
      )
      .filter(Boolean);
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const suggestions: string[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== "string") {
      continue;
    }

    const suggestion = item.replace(/\s+/g, " ").trim();
    const key = suggestion.toLowerCase();

    if (
      !suggestion ||
      suggestion.length > maxSuggestionLength ||
      seen.has(key)
    ) {
      continue;
    }

    suggestions.push(suggestion);
    seen.add(key);

    if (suggestions.length === maxSuggestionCount) {
      break;
    }
  }

  return suggestions;
}
