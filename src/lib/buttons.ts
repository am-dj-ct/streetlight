export type PromptButtonId =
  | "understand-letter-or-form"
  | "write-something"
  | "think-it-through"
  | "figure-out-next"
  | "explain-like-new"
  | "prepare-for-hard"
  | "am-i-being-unreasonable"
  | "embarrassed-to-ask";

export type PromptButton = {
  id: PromptButtonId;
  label: string;
  systemPrompt: string;
};

export type AlternateAction = {
  id: "type-your-own" | "talk-instead";
  label: string;
};

export const promptButtons: readonly PromptButton[] = [
  {
    id: "understand-letter-or-form",
    label: "Understand a letter or form",
    systemPrompt: "",
  },
  {
    id: "write-something",
    label: "Write something",
    systemPrompt: "",
  },
  {
    id: "think-it-through",
    label: "Think it through (listen and ask questions)",
    systemPrompt: "",
  },
  {
    id: "figure-out-next",
    label: "Figure out what to do next",
    systemPrompt: "",
  },
  {
    id: "explain-like-new",
    label: "Explain something like I'm new to it",
    systemPrompt: "",
  },
  {
    id: "prepare-for-hard",
    label: "Prepare for something hard",
    systemPrompt: "",
  },
  {
    id: "am-i-being-unreasonable",
    label: "Am I being unreasonable",
    systemPrompt: "",
  },
  {
    id: "embarrassed-to-ask",
    label: "Something I'm embarrassed to ask",
    systemPrompt: "",
  },
];

export const alternateActions: readonly AlternateAction[] = [
  { id: "type-your-own", label: "Type your own" },
  { id: "talk-instead", label: "Talk instead" },
];
