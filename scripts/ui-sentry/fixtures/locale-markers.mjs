// Fixed, non-user, shipped UI copy strings (src/data/ui-copy/<code>.json ->
// landingHeadingLineOne) used only to confirm each locale actually renders
// its own translation rather than falling back to English. Not user
// content — this is the app's own static translated copy, same class of
// fixed string the tier 2 chat-status classifier already matches against
// (lib/chat-status.mjs). Keep in sync with src/data/ui-copy/ if that
// heading copy ever changes.
export const LOCALE_HEADING_MARKERS = {
  es: "¿Qué necesitas?",
  zh: "你需要什么？",
  so: "Maxaad u baahan tahay?",
  am: "ምን ያስፈልግዎታል?",
  vi: "Bạn cần gì?",
  ru: "Что вам нужно?",
};
