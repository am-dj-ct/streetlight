import { promptButtons, type AlternateAction, alternateActions } from "./buttons";
import type { PromptButtonId } from "./buttons";
import type { ConversationEntryId } from "./chat-types";

export type ConversationSeed = {
  id: ConversationEntryId;
  label: string;
  assistantMessage: string;
  suggestions: readonly string[];
};

const promptConversationSeeds: Record<PromptButtonId, ConversationSeed> = {
  "understand-letter-or-form": {
    id: "understand-letter-or-form",
    label: "Understand a letter or form",
    assistantMessage:
      "I can help with that. You can paste the letter or form here, or tell me what it says and what part feels confusing.",
    suggestions: [
      "I want to understand the whole thing",
      "Show me the deadline or next step",
      "Help me answer it",
    ],
  },
  "write-something": {
    id: "write-something",
    label: "Write something",
    assistantMessage:
      "I can help you write it. Tell me who it's for, what you want to say, and how direct or polite you want it to sound.",
    suggestions: [
      "Write a text message",
      "Write an email",
      "Help me say this clearly",
    ],
  },
  "think-it-through": {
    id: "think-it-through",
    label: "Think it through (listen and ask questions)",
    assistantMessage:
      "Tell me what's going on. I can listen, ask a few questions, and help you sort out what matters most first.",
    suggestions: [
      "I need help sorting this out",
      "Ask me questions one at a time",
      "Help me make a plan",
    ],
  },
  "figure-out-next": {
    id: "figure-out-next",
    label: "Figure out what to do next",
    assistantMessage:
      "Tell me the situation and where you're stuck. I can help you narrow it down to the next step instead of everything at once.",
    suggestions: [
      "I have too many problems at once",
      "Help me choose what to do first",
      "Give me the smallest next step",
    ],
  },
  "explain-like-new": {
    id: "explain-like-new",
    label: "Explain something like I'm new to it",
    assistantMessage:
      "I can explain it in plain language. Tell me what you want explained, and I will keep it simple without talking down to you.",
    suggestions: [
      "Explain this in simple words",
      "Explain the main idea first",
      "Tell me what this means for me",
    ],
  },
  "prepare-for-hard": {
    id: "prepare-for-hard",
    label: "Prepare for something hard",
    assistantMessage:
      "I can help you get ready. Tell me what the hard thing is, and we can work on what to say, what to bring, or what to expect.",
    suggestions: [
      "Help me prepare what to say",
      "Make a short plan with me",
      "What should I bring or ask",
    ],
  },
  "am-i-being-unreasonable": {
    id: "am-i-being-unreasonable",
    label: "Am I being unreasonable",
    assistantMessage:
      "Tell me what happened and what you're asking for. I'll be direct with you and help you see it clearly, even if the answer is uncomfortable.",
    suggestions: [
      "Tell me straight",
      "What am I missing here",
      "How would this sound to someone else",
    ],
  },
  "embarrassed-to-ask": {
    id: "embarrassed-to-ask",
    label: "Something I'm embarrassed to ask",
    assistantMessage:
      "You can ask it plainly. I won't make it weird. Say the question the way it comes to you, and we can go from there.",
    suggestions: [
      "I don't know how to ask this",
      "I feel dumb asking this",
      "Please explain without judging me",
    ],
  },
};

const alternateConversationSeeds: Record<AlternateAction["id"], ConversationSeed> = {
  "type-your-own": {
    id: "type-your-own",
    label: "Type your own",
    assistantMessage:
      "Type whatever you want help with. A question, a letter, a situation, or just a few words is enough to start.",
    suggestions: [
      "Help me explain my situation",
      "Help me write something",
      "Help me figure out what to do next",
    ],
  },
  "talk-instead": {
    id: "talk-instead",
    label: "Talk instead",
    assistantMessage:
      "You can use the mic when it's ready. For now, you can type a few words and I can still help you get started.",
    suggestions: [
      "I want to say this out loud",
      "Help me start with one sentence",
      "Ask me one question first",
    ],
  },
};

export const conversationSeeds: readonly ConversationSeed[] = [
  ...promptButtons.map((button) => promptConversationSeeds[button.id]),
  ...alternateActions.map((action) => alternateConversationSeeds[action.id]),
];

export function getConversationSeed(
  entryId: string,
): ConversationSeed | undefined {
  return conversationSeeds.find((entry) => entry.id === entryId);
}
