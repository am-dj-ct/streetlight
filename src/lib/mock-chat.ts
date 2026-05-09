import type {
  ChatRequestBody,
  ClientChatMessage,
  ConversationEntryId,
  WeakCategory,
} from "./chat-types";

function getLatestUserText(messages: ClientChatMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.text.trim() ?? ""
  );
}

function asParagraphs(lines: string[]) {
  return lines.join("\n\n").trim();
}

function classifyMockResponse({
  entryId,
  latestUserText,
}: {
  entryId: ConversationEntryId;
  latestUserText: string;
}): WeakCategory {
  const normalized = latestUserText.toLowerCase();

  if (
    normalized.includes("benefit") ||
    normalized.includes("food stamps") ||
    normalized.includes("ebt") ||
    normalized.includes("dshs") ||
    normalized.includes("proof of income")
  ) {
    return "benefits_eligibility";
  }

  if (
    normalized.includes("boss") ||
    normalized.includes("employer") ||
    normalized.includes("manager") ||
    normalized.includes("paycheck") ||
    normalized.includes("wages") ||
    normalized.includes("fired") ||
    normalized.includes("schedule") ||
    normalized.includes("sick leave") ||
    normalized.includes("accommodation")
  ) {
    return "employment_rights";
  }

  if (
    normalized.includes("landlord") ||
    normalized.includes("eviction") ||
    normalized.includes("lease") ||
    normalized.includes("hearing")
  ) {
    return "legal_procedure";
  }

  if (
    normalized.includes("uscis") ||
    normalized.includes("work permit") ||
    normalized.includes("green card") ||
    normalized.includes("asylum") ||
    normalized.includes("visa")
  ) {
    return "immigration";
  }

  if (
    normalized.includes("dose") ||
    normalized.includes("medication") ||
    normalized.includes("pill")
  ) {
    return "medical_dosing";
  }

  if (
    normalized.includes("urgent care") ||
    normalized.includes("poison control") ||
    normalized.includes("hard to wake") ||
    normalized.includes("withdrawal") ||
    normalized.includes("stop taking") ||
    normalized.includes("stop my antidepressant") ||
    normalized.includes("dangerous symptom")
  ) {
    return "medical_decisionmaking";
  }

  if (
    normalized.includes("photo id") ||
    normalized.includes("proof of address") ||
    normalized.includes("birth certificate") ||
    normalized.includes("social security card") ||
    normalized.includes("replace my id") ||
    normalized.includes("lost my id")
  ) {
    return "identity_documentation";
  }

  switch (entryId) {
    case "understand-letter-or-form":
    case "figure-out-next":
      return "benefits_eligibility";
    case "prepare-for-hard":
    case "am-i-being-unreasonable":
      return "legal_procedure";
    default:
      return "none";
  }
}

function buildMockResponse({
  entryId,
  language,
  latestUserText,
}: {
  entryId: ConversationEntryId;
  language: ChatRequestBody["language"];
  latestUserText: string;
}) {
  if (language === "es") {
    return asParagraphs([
      "Este es el modo de prueba, asi que esta respuesta solo sirve para revisar la app localmente.",
      "Una buena respuesta real usaria lenguaje claro, diria que parte importa mas, y nombraria el siguiente paso pequeno.",
      `Para tu texto, empezaria identificando la frase mas importante de: \"${latestUserText || "lo que pegaste"}\".`,
    ]);
  }

  switch (entryId) {
    case "understand-letter-or-form":
      return asParagraphs([
        "This is mock mode, so this answer is only for local testing.",
        "A good real answer here would usually say what the letter is about, pull out the deadline or request, and name the smallest useful next step.",
        `If I were responding to your text, I would start by pulling out the exact sentence that matters most from: \"${latestUserText || "the letter you pasted"}\".`,
      ]);
    case "write-something":
      return asParagraphs([
        "This is mock mode, so this draft is only for local testing.",
        "Here is a short version you could send:",
        "\"Hi, I am running about 10 minutes late, but I am still coming. Sorry about that.\"",
      ]);
    case "think-it-through":
      return asParagraphs([
        "This is mock mode, so this is a local testing answer.",
        "Let’s sort the problem by urgency, what you can do right now, and what can wait until later today.",
        "First question: what feels most likely to get worse if you do nothing for the next hour?",
      ]);
    case "figure-out-next":
      return asParagraphs([
        "This is mock mode, so this is only a local testing answer.",
        "A good next-step answer here would usually name one concrete action for today, not a whole life plan.",
        "If this is a benefits or paperwork problem, the first move is usually to confirm exactly what proof or response is being asked for.",
      ]);
    case "explain-like-new":
      return asParagraphs([
        "This is mock mode, so this explanation is only for local testing.",
        "A strong real answer here would use plain language, a short example, and one sentence about why it matters.",
      ]);
    case "prepare-for-hard":
      return asParagraphs([
        "This is mock mode, so this prep answer is only for local testing.",
        "A good real answer here would help you decide what to say first, what to bring, and what question to ask if the conversation goes sideways.",
      ]);
    case "am-i-being-unreasonable":
      return asParagraphs([
        "This is mock mode, so this is only for local testing.",
        "A good real answer here would be direct about what seems fair, what seems risky, and what information is still missing.",
      ]);
    case "embarrassed-to-ask":
      return asParagraphs([
        "This is mock mode, so this is only for local testing.",
        "A good real answer here would stay calm, not act surprised, and answer the actual question without making the person feel smaller.",
      ]);
    case "talk-instead":
      return asParagraphs([
        "This is mock mode, so this is only for local testing.",
        "A real answer in this lane should sound easy to say out loud and easy to follow one step at a time.",
        "First: tell me the one part you want help with most.",
      ]);
    case "type-your-own":
    default:
      return asParagraphs([
        "This is mock mode, so this answer is only for local testing.",
        "The app is working without calling Anthropic right now.",
        "Use this mode for layout, save-flow, language, referrals, and interaction checks when you do not need a live model reply.",
      ]);
  }
}

function buildMockSuggestions(entryId: ConversationEntryId): string[] {
  switch (entryId) {
    case "write-something":
      return ["Make it shorter", "Make it more direct", "Help me send it"];
    case "talk-instead":
      return ["Ask me one question", "Make it easier to say", "Start with one sentence"];
    default:
      return ["What should I do first?", "Help me make a plan", "Find a human for this"];
  }
}

export function buildMockChatTurn(body: ChatRequestBody) {
  const latestUserText = getLatestUserText(body.messages);

  return {
    classifierCategory: classifyMockResponse({
      entryId: body.entryId,
      latestUserText,
    }),
    responseText: buildMockResponse({
      entryId: body.entryId,
      language: body.language,
      latestUserText,
    }),
    suggestions: buildMockSuggestions(body.entryId),
  };
}
