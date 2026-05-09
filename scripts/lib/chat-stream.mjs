import { isWeakCategory } from "./taxonomy.mjs";

export function isChatStreamEvent(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (value.type === "delta") {
    return typeof value.text === "string";
  }

  if (value.type === "classifier") {
    return typeof value.category === "string" && isWeakCategory(value.category);
  }

  if (value.type === "suggestions") {
    return (
      Array.isArray(value.suggestions) &&
      value.suggestions.every((suggestion) => typeof suggestion === "string")
    );
  }

  if (value.type === "error") {
    return typeof value.error === "string";
  }

  return false;
}
