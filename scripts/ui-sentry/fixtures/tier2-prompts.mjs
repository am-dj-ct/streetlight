// Synthetic fixture prompts for tier 2's live conversation. Written from
// scratch for this sentry — a generic benefits/shelter-style arc, never
// real user content (spec: "write new synthetic fixtures, never real user
// content"). Six turns, each short and conversational, in-budget for a
// production live-model call. Do not add anything specific, identifying,
// or drawn from an actual report — these exist only to exercise the real
// chat pipeline end to end.
export const TIER2_ENTRY_ID = "type-your-own";

export const TIER2_TURNS = [
  "Hi, I got a letter about my food benefits and I don't understand it. Can you help me figure out what it's asking me to do?",
  "It mentions something about a review appointment. What does that usually mean, in plain words?",
  "What kinds of documents do people usually need to bring to something like that?",
  "I might also need a place to stay for a few nights this week. What's a good first step?",
  "If someone shows up at a shelter with no ID, what usually happens?",
  "Thanks, that's helpful. Can you give me a short summary of everything we just covered?",
];
