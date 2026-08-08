"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CrisisFooter } from "./crisis-footer";
import { PhoneAction } from "./phone-action";
import { trackUsageEvent } from "./tracked-conversation-link";
import { copyTextToClipboard } from "../lib/browser-copy";
import { getConversationContentEntry } from "../lib/conversation-content";
import {
  getCheckedThroughDate,
  getReferralsForCategory,
  isReferralSpecificToCategory,
} from "../lib/referrals";
import {
  buildConversationHref,
  buildHomeHref,
  buildPrivacyHref,
} from "../lib/routes";
import { appTitle } from "../lib/site-metadata";
import { buildMailtoHref, isMailtoHrefWithinLimit } from "../lib/support";
import { formatMarkdownForPlainText } from "../lib/markdown-plain-text";
import { stripMarkdownForSpeech } from "../lib/speech-text";
import { getAzureVoiceOption, getAzureVoiceOptions } from "../lib/azure-tts";
import { getUiCopy, hasTranslatedUiCopy } from "../lib/ui-copy";
import type {
  ChatAttachment,
  ChatErrorBody,
  ChatStreamEvent,
  ClientChatMessage,
  ConversationEntryId,
  WeakCategory,
} from "../lib/chat-types";
import {
  isChatErrorBody,
  isChatStreamEvent,
  maxAttachmentsPerMessage,
  maxChatMessages,
  maxClientMessageTextLength,
} from "../lib/chat-types";
import {
  AttachmentError,
  makeAttachmentPreviewUrl,
  processSelectedAttachment,
} from "../lib/attachments";
import { isTtsErrorBody } from "../lib/tts-types";
import type { RegionScope } from "../lib/geo";
import {
  getSpeechLocaleForLanguageCode,
  isSupportedLanguageCode,
  languageOptions,
  type SupportedLanguageCode,
} from "../lib/languages";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      size: "normal" | "flexible" | "compact";
      appearance?: "always" | "execute" | "interaction-only";
      execution?: "execute" | "render";
      theme: "light";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => string;
  execute: (widgetId?: string) => void;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognitionInstance;
    };
    webkitSpeechRecognition?: {
      new (): SpeechRecognitionInstance;
    };
  }

  interface Window {
    turnstile?: TurnstileApi;
  }
}

type SpeechRecognitionResultItem = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionResultItem;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: null | (() => void);
  onerror: null | (() => void);
  onresult: null | ((event: SpeechRecognitionEventLike) => void);
  start: () => void;
  stop: () => void;
};

const turnstileSendTimeoutMs = 30000;

type ConversationClientProps = {
  currentLanguageCode: SupportedLanguageCode;
  currentLanguageLabel: string;
  entryId: ConversationEntryId;
  initialAssistantMessage: string;
  initialSuggestions: readonly string[];
  regionScope: RegionScope;
};

type SaveTarget =
  | { kind: "conversation" }
  | { kind: "answer"; messageId: string; text: string };

const languageSheetDialogId = "language-sheet-dialog";
const languageSheetTitleId = "language-sheet-title";
const languageSheetDescriptionId = "language-sheet-description";
const saveDialogId = "save-dialog";
const saveDialogTitleId = "save-dialog-title";
const saveDialogDescriptionId = "save-dialog-description";
const voiceSettingsDialogId = "voice-settings-dialog";
const voiceSettingsTitleId = "voice-settings-title";
const voiceSettingsDescriptionId = "voice-settings-description";
const referralSheetDialogId = "referral-sheet-dialog";
const referralSheetTitleId = "referral-sheet-title";
const azureVoiceStorageKey = "access-tool-azure-voice-names";
const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function makeMessageId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function chooseBestVoice(voices: SpeechSynthesisVoice[], language: string) {
  const matchingVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()),
  );
  const pool = matchingVoices.length > 0 ? matchingVoices : voices;

  const preferredNamesByLanguage: Record<string, string[]> = {
    en: [
      "Samantha",
      "Ava",
      "Allison",
      "Susan",
      "Karen",
      "Moira",
      "Fiona",
      "Tessa",
      "Google US English",
      "Microsoft Aria",
      "Microsoft Jenny",
      "Alex",
      "Daniel",
    ],
    es: ["Paulina", "Monica", "Jorge", "Google español", "Microsoft Dalia", "Microsoft Alvaro"],
    vi: ["Linh", "Google tiếng Việt"],
    ru: ["Milena", "Yuri", "Google русский"],
    zh: ["Ting-Ting", "Sin-ji", "Mei-Jia", "Google 普通话（中国大陆）"],
  };

  const preferredNames = preferredNamesByLanguage[language.slice(0, 2).toLowerCase()] ?? [];

  for (const preferredName of preferredNames) {
    const match = pool.find((voice) => voice.name.includes(preferredName));

    if (match) {
      return match;
    }
  }

  return (
    pool.find((voice) => voice.localService) ??
    pool.find((voice) => !/compact|classic|old/i.test(voice.name)) ??
    pool[0]
  );
}

function getVoiceOptions(voices: SpeechSynthesisVoice[], language: string) {
  const matchingVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()),
  );

  return matchingVoices.length > 0 ? matchingVoices : voices;
}

function appendToMessage(
  messages: ClientChatMessage[],
  messageId: string,
  chunk: string,
  replace: boolean,
): ClientChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return {
      ...message,
      text: replace ? chunk : `${message.text}${chunk}`,
    };
  });
}

function formatConversationForExport(
  messages: ClientChatMessage[],
  {
    copy,
    entryLabel,
    languageLabel,
  }: {
    copy: ReturnType<typeof getUiCopy>;
    entryLabel: string;
    languageLabel: string;
  },
) {
  const exportedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  const body = messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => {
      const speaker =
        message.role === "assistant"
          ? copy.conversationExportAssistantLabel
          : copy.conversationExportUserLabel;
      const messageText =
        message.role === "assistant"
          ? formatMarkdownForPlainText(message.text)
          : message.text.trim();
      return `${speaker}:\n${messageText}`;
    })
    .join("\n\n");

  return `${copy.conversationExportTitle}
${copy.conversationExportSavedLabel}: ${exportedAt}
${copy.conversationExportStartedFromLabel}: ${entryLabel}
${copy.conversationExportLanguageLabel}: ${languageLabel}

${body}
`;
}

function formatAnswerForExport(
  text: string,
  {
    copy,
    entryLabel,
    languageLabel,
  }: {
    copy: ReturnType<typeof getUiCopy>;
    entryLabel: string;
    languageLabel: string;
  },
) {
  const exportedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return `${copy.answerExportTitle}
${copy.conversationExportSavedLabel}: ${exportedAt}
${copy.conversationExportStartedFromLabel}: ${entryLabel}
${copy.conversationExportLanguageLabel}: ${languageLabel}

${formatMarkdownForPlainText(text)}
`;
}

function makeExportTimestamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
}

function makeConversationExportFilename(entryId: ConversationEntryId) {
  return `streetlight-conversation-${entryId}-${makeExportTimestamp()}.txt`;
}

function makeAnswerExportFilename(entryId: ConversationEntryId) {
  return `streetlight-answer-${entryId}-${makeExportTimestamp()}.txt`;
}

function makeConversationDocxFilename(entryId: ConversationEntryId) {
  return `streetlight-conversation-${entryId}-${makeExportTimestamp()}.docx`;
}

function makeAnswerDocxFilename(entryId: ConversationEntryId) {
  return `streetlight-answer-${entryId}-${makeExportTimestamp()}.docx`;
}

function makeConversationPdfFilename(entryId: ConversationEntryId) {
  return `streetlight-conversation-${entryId}-${makeExportTimestamp()}.pdf`;
}

function makeAnswerPdfFilename(entryId: ConversationEntryId) {
  return `streetlight-answer-${entryId}-${makeExportTimestamp()}.pdf`;
}

// Bound the history sent to the server to maxChatMessages so long
// conversations never dead-end at the request cap. Keeps the seeded greeting
// as the first message and trims the oldest middle turns, preserving the
// leading-assistant-then-alternating shape (ending on the latest user message)
// that the live Anthropic call relies on. See
// docs/decisions/2026-06-12-client-history-window.md.
function windowMessagesForRequest(
  messages: ClientChatMessage[],
): ClientChatMessage[] {
  if (messages.length <= maxChatMessages) {
    return messages;
  }

  const [seed, ...rest] = messages;
  let tail = rest.slice(-(maxChatMessages - 1));
  // The window after the assistant seed must begin with a user message so the
  // server (latest-must-be-user) and Anthropic (user-first, strict
  // alternation) both accept it.
  if (tail.length > 0 && tail[0].role !== "user") {
    tail = tail.slice(1);
  }
  return [seed, ...tail];
}

// Attachment bytes are sent for the newest message only. Older turns resend
// text; an image-only older turn gets this fixed placeholder so the request
// stays valid and role alternation is preserved. The placeholder is model
// input, not UI copy, so it stays English.
const attachmentHistoryPlaceholder =
  "[The user attached a photo or document earlier in the conversation. It is not included again.]";

function prepareMessagesForRequest(
  messages: ClientChatMessage[],
): ClientChatMessage[] {
  return messages.map((message, index) => {
    if (
      !message.attachments ||
      message.attachments.length === 0 ||
      index === messages.length - 1
    ) {
      return message;
    }

    return {
      id: message.id,
      role: message.role,
      suggestions: message.suggestions,
      text:
        message.text.trim().length > 0
          ? message.text
          : attachmentHistoryPlaceholder,
      weakCategory: message.weakCategory,
    };
  });
}

function setMessageWeakCategory(
  messages: ClientChatMessage[],
  messageId: string,
  weakCategory: WeakCategory,
): ClientChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return {
      ...message,
      weakCategory,
    };
  });
}

function setMessageSuggestions(
  messages: ClientChatMessage[],
  messageId: string,
  suggestions: string[],
): ClientChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return {
      ...message,
      suggestions,
    };
  });
}

function filterGeneratedSuggestions(
  suggestions: string[],
  existingActionLabel: string,
) {
  const normalizedExistingAction = existingActionLabel.trim().toLocaleLowerCase();
  const seen = new Set<string>();

  return suggestions.filter((suggestion) => {
    const trimmedSuggestion = suggestion.trim();
    const normalizedSuggestion = trimmedSuggestion.toLocaleLowerCase();

    if (
      !trimmedSuggestion ||
      normalizedSuggestion === normalizedExistingAction ||
      seen.has(normalizedSuggestion)
    ) {
      return false;
    }

    seen.add(normalizedSuggestion);
    return true;
  }).slice(0, 3);
}

function getFocusableDialogElements(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector),
  ).filter((element) => element.tabIndex >= 0);
}

function readLocalStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readAzureVoicePreferences(): Partial<Record<SupportedLanguageCode, string>> {
  try {
    const rawValue = readLocalStorage(azureVoiceStorageKey);
    const parsedValue = rawValue ? JSON.parse(rawValue) : null;

    if (!parsedValue || typeof parsedValue !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedValue).filter(
        (entry): entry is [SupportedLanguageCode, string] =>
          isSupportedLanguageCode(entry[0]) && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeAzureVoicePreference(
  languageCode: SupportedLanguageCode,
  voiceName: string,
) {
  const preferences = readAzureVoicePreferences();
  preferences[languageCode] = voiceName;
  writeLocalStorage(azureVoiceStorageKey, JSON.stringify(preferences));
}

type IconProps = {
  className?: string;
};

function SendIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M4 12 20 5l-6.5 14-2.7-5.8L4 12Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="m10.8 13.2 3.4-3.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function PaperclipIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M8 12.5 14.2 6.3a3.2 3.2 0 0 1 4.5 4.5l-7.4 7.4a5.2 5.2 0 0 1-7.3-7.3L10.9 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CameraIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M4 8.5h3l1.5-2.5h7L17 8.5h3V18H4V8.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="13"
        r="3"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function SpeakerIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M4 10v4h3l5 4V6l-5 4H4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M16 9.5a4 4 0 0 1 0 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function VoiceIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M7 5v14M17 5v14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M4.5 9h5M14.5 15h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M9.5 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM18.5 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function HumanHelpIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M9.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 19a5 5 0 0 1 10 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M16 8.5h4M18 6.5v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CopyIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M8 8h9v11H8V8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function SaveIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 4v10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="m8 10 4 4 4-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M5 20h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function DocumentIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M7 3h7l5 5v13H7V3Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M14 3v5h5M10 13h6M10 17h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

const toolButtonClassName =
  "inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d3ddd6] bg-[#fbfcfa] px-3.5 text-[14px] font-medium text-[#405047] transition-colors hover:border-[#b7c7bd] hover:bg-white disabled:opacity-50";
const humanHelpButtonClassName =
  "inline-flex min-h-10 items-center gap-2 rounded-full border border-[#ead8b7] bg-[#fff8e8] px-3.5 text-[14px] font-semibold text-[#694d12] transition-colors hover:bg-[#fff2d6]";
const suggestionButtonClassName =
  "min-h-11 rounded-[16px] border border-[#a9c3b6] bg-[#eef7f1] px-4 text-left text-[15px] font-medium leading-5 text-[#20382d] shadow-[0_1px_0_rgba(29,42,34,0.08)] transition-colors hover:bg-[#e4f1e8] disabled:opacity-60";
const utilityButtonClassName =
  "min-h-10 rounded-full border border-[#d3ddd6] bg-transparent px-4 text-[15px] font-medium text-[#4f6258] transition-colors hover:border-[#b7c7bd] hover:bg-white";
const utilityIconButtonClassName =
  "flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#d3ddd6] bg-transparent px-3 text-[15px] font-semibold text-[#4f6258] transition-colors hover:border-[#b7c7bd] hover:bg-white";

export function ConversationClient({
  currentLanguageCode,
  currentLanguageLabel,
  entryId,
  initialAssistantMessage,
  initialSuggestions,
  regionScope,
}: ConversationClientProps) {
  const turnstileEnabled = process.env.NEXT_PUBLIC_TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = turnstileEnabled
    ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""
    : "";
  const copy = getUiCopy(currentLanguageCode);
  const hasTranslatedCopy = hasTranslatedUiCopy(currentLanguageCode);
  const threadRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentPickerRef = useRef<HTMLInputElement | null>(null);
  const cameraPickerRef = useRef<HTMLInputElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([]);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const assistantMessageRefs = useRef(new Map<string, HTMLElement>());
  const languageSheetDoneRef = useRef<HTMLButtonElement | null>(null);
  const languageSheetRef = useRef<HTMLDivElement | null>(null);
  const languageSheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const referralSheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const referralSheetRef = useRef<HTMLDivElement | null>(null);
  const referralSheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const saveCancelRef = useRef<HTMLButtonElement | null>(null);
  const saveDialogRef = useRef<HTMLDivElement | null>(null);
  const saveDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const voiceSettingsDoneRef = useRef<HTMLButtonElement | null>(null);
  const voiceSettingsRef = useRef<HTMLDivElement | null>(null);
  const voiceSettingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const dictationBaseDraftRef = useRef("");
  const maxVisualViewportHeightRef = useRef(0);
  const [messages, setMessages] = useState<ClientChatMessage[]>([
    {
      id: "assistant-seed",
      role: "assistant",
      text: initialAssistantMessage,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPreparingTurnstile, setIsPreparingTurnstile] = useState(false);
  // A send attempted while the previous turn's stream is still closing
  // (classifier + suggestions finish after the visible text) waits here and
  // fires as soon as the stream ends, instead of being silently dropped.
  const queuedDraftRef = useRef<string | null>(null);
  const isPreparingTurnstileRef = useRef(false);
  const lastSendFailureMessageRef = useRef<string | null>(null);
  const [pendingClassifierMessageId, setPendingClassifierMessageId] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [micSupported, setMicSupported] = useState<boolean | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedAzureVoiceName, setSelectedAzureVoiceName] = useState("");
  const [selectedVoiceUri, setSelectedVoiceUri] = useState("");
  const [speechRate, setSpeechRate] = useState(0.92);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [speechLoadingMessageId, setSpeechLoadingMessageId] = useState<string | null>(null);
  const [showLanguageSheet, setShowLanguageSheet] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [referralSheet, setReferralSheet] = useState<{
    category: WeakCategory | null;
    showAll: boolean;
  } | null>(null);
  const [hasSeenSaveWarning, setHasSeenSaveWarning] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTarget, setSaveTarget] = useState<SaveTarget>({ kind: "conversation" });
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [answerStatusMessages, setAnswerStatusMessages] = useState<Record<string, string>>({});
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isKeyboardViewportCompressed, setIsKeyboardViewportCompressed] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileTokenResolverRef = useRef<
    ((token: string | null) => void) | null
  >(null);
  const [isListening, setIsListening] = useState(false);
  const conversationHref = buildConversationHref({
    entryId,
    languageCode: currentLanguageCode,
  });
  const isReferralSheetOpen = referralSheet !== null;
  const hasOpenSheet =
    showLanguageSheet || showSaveModal || showVoiceSettings || isReferralSheetOpen;

  useEffect(() => {
    trackUsageEvent({
      entryId,
      eventType: "conversation_page_view",
      language: currentLanguageCode,
    });
  }, [currentLanguageCode, entryId]);

  function scrollThreadElementToTop(element: HTMLElement) {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    const threadRect = thread.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    thread.scrollTop += elementRect.top - threadRect.top;
  }

  useEffect(() => {
    if (
      !showLanguageSheet &&
      !showSaveModal &&
      !showVoiceSettings &&
      !isReferralSheetOpen
    ) {
      return;
    }

    function getOpenDialog() {
      if (showSaveModal) {
        return saveDialogRef.current;
      }

      if (showVoiceSettings) {
        return voiceSettingsRef.current;
      }

      if (isReferralSheetOpen) {
        return referralSheetRef.current;
      }

      return languageSheetRef.current;
    }

    function handleSheetKeydown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const dialog = getOpenDialog();

        if (!dialog) {
          return;
        }

        const focusableElements = getFocusableDialogElements(dialog);
        const firstElement = focusableElements[0];
        const lastElement = focusableElements.at(-1);

        if (!firstElement || !lastElement) {
          event.preventDefault();
          dialog.focus();
          return;
        }

        if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          firstElement.focus();
          return;
        }

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
          return;
        }

        if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }

        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();

      if (showSaveModal) {
        setSaveStatusMessage(null);
        setShowSaveModal(false);
        return;
      }

      if (showVoiceSettings) {
        setShowVoiceSettings(false);
        return;
      }

      if (isReferralSheetOpen) {
        setReferralSheet(null);
        return;
      }

      setShowLanguageSheet(false);
    }

    window.addEventListener("keydown", handleSheetKeydown);

    return () => {
      window.removeEventListener("keydown", handleSheetKeydown);
    };
  }, [showLanguageSheet, showSaveModal, showVoiceSettings, isReferralSheetOpen]);

  useEffect(() => {
    if (showLanguageSheet) {
      languageSheetReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      languageSheetDoneRef.current?.focus();
      return;
    }

    languageSheetReturnFocusRef.current?.focus();
    languageSheetReturnFocusRef.current = null;
  }, [showLanguageSheet]);

  useEffect(() => {
    if (showSaveModal) {
      saveDialogReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      saveCancelRef.current?.focus();
      return;
    }

    saveDialogReturnFocusRef.current?.focus();
    saveDialogReturnFocusRef.current = null;
  }, [showSaveModal]);

  useEffect(() => {
    if (showVoiceSettings) {
      voiceSettingsReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      voiceSettingsDoneRef.current?.focus();
      return;
    }

    voiceSettingsReturnFocusRef.current?.focus();
    voiceSettingsReturnFocusRef.current = null;
  }, [showVoiceSettings]);

  useEffect(() => {
    if (isReferralSheetOpen) {
      referralSheetReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      referralSheetCloseRef.current?.focus();
      return;
    }

    referralSheetReturnFocusRef.current?.focus();
    referralSheetReturnFocusRef.current = null;
  }, [isReferralSheetOpen]);

  useEffect(() => {
    composerRef.current?.blur();

    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    thread.scrollTop = 0;

    const resetInitialViewport = window.setTimeout(() => {
      composerRef.current?.blur();
      thread.scrollTop = 0;
    }, 150);

    return () => {
      window.clearTimeout(resetInitialViewport);
    };
  }, [entryId]);

  useEffect(() => {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    if (messages.length === 1 && showSuggestions && !isStreaming && !errorMessage) {
      return;
    }

    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.text.length > 0);

    if (!isStreaming && latestAssistantMessage) {
      const latestAssistantElement = assistantMessageRefs.current.get(
        latestAssistantMessage.id,
      );

      if (latestAssistantElement) {
        scrollThreadElementToTop(latestAssistantElement);

        window.requestAnimationFrame(() => {
          scrollThreadElementToTop(latestAssistantElement);
        });
      }

      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [messages, errorMessage, isStreaming, showSuggestions]);

  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    const borderHeight = composer.offsetHeight - composer.clientHeight;

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight + borderHeight, 224)}px`;
  }, [draft]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const visualViewport = window.visualViewport;

    function updateKeyboardViewportState() {
      if (!mediaQuery.matches) {
        maxVisualViewportHeightRef.current = Math.max(
          maxVisualViewportHeightRef.current,
          visualViewport.height,
        );
        setIsKeyboardViewportCompressed(false);
        return;
      }

      if (!isComposerFocused) {
        maxVisualViewportHeightRef.current = Math.max(
          maxVisualViewportHeightRef.current,
          visualViewport.height,
        );
      }

      const baselineHeight =
        maxVisualViewportHeightRef.current || visualViewport.height;
      const isCompressed = baselineHeight - visualViewport.height > 120;

      setIsKeyboardViewportCompressed(isCompressed);
    }

    updateKeyboardViewportState();

    visualViewport.addEventListener("resize", updateKeyboardViewportState);
    visualViewport.addEventListener("scroll", updateKeyboardViewportState);
    window.addEventListener("resize", updateKeyboardViewportState);

    return () => {
      visualViewport.removeEventListener("resize", updateKeyboardViewportState);
      visualViewport.removeEventListener("scroll", updateKeyboardViewportState);
      window.removeEventListener("resize", updateKeyboardViewportState);
    };
  }, [isComposerFocused]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setSpeechSupported(
      "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    );
    setMicSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    setSelectedVoiceUri(readLocalStorage("access-tool-voice-uri") || "");
    setHasSeenSaveWarning(
      readLocalStorage("access-tool-save-warning-seen") === "true",
    );
    setShareSupported(typeof navigator.share === "function");

    const savedSpeechRate = Number(
      readLocalStorage("access-tool-speech-rate") ?? "0.92",
    );
    if (
      !Number.isNaN(savedSpeechRate) &&
      savedSpeechRate >= 0.7 &&
      savedSpeechRate <= 1.1
    ) {
      setSpeechRate(savedSpeechRate);
    }

    const savedAzureVoiceName = readAzureVoicePreferences()[currentLanguageCode];

    if (
      savedAzureVoiceName &&
      getAzureVoiceOptions(currentLanguageCode).some(
        (voiceOption) => voiceOption.name === savedAzureVoiceName,
      )
    ) {
      setSelectedAzureVoiceName(savedAzureVoiceName);
    }

    let loadVoices: (() => void) | null = null;

    if ("speechSynthesis" in window) {
      loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();

        if (voices.length > 0) {
          setAvailableVoices(voices);
        }
      };

      loadVoices();
      window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    }

    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      if (loadVoices) {
        window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      }

      ttsAbortControllerRef.current?.abort();
      audioRef.current?.pause();
      audioRef.current = null;

      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }

      utteranceRef.current = null;
      setSpeakingMessageId(null);
      setSpeechLoadingMessageId(null);
    };
  }, [currentLanguageCode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedVoiceUri) {
      writeLocalStorage("access-tool-voice-uri", selectedVoiceUri);
    }

    writeLocalStorage("access-tool-speech-rate", String(speechRate));
  }, [selectedVoiceUri, speechRate]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !turnstileSiteKey ||
      !turnstileScriptReady ||
      !turnstileContainerRef.current ||
      turnstileWidgetIdRef.current ||
      typeof window === "undefined" ||
      !window.turnstile
    ) {
      return;
    }

    turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      size: "normal",
      appearance: "interaction-only",
      execution: "execute",
      theme: "light",
      callback: (token) => {
        setTurnstileToken(token);
        turnstileTokenResolverRef.current?.(token);
        turnstileTokenResolverRef.current = null;
      },
      "error-callback": () => {
        setTurnstileToken(null);
        turnstileTokenResolverRef.current?.(null);
        turnstileTokenResolverRef.current = null;
      },
      "expired-callback": () => {
        setTurnstileToken(null);
        turnstileTokenResolverRef.current?.(null);
        turnstileTokenResolverRef.current = null;
      },
    });

    return () => {
      if (typeof window === "undefined" || !window.turnstile) {
        return;
      }

      const widgetId = turnstileWidgetIdRef.current;

      if (!widgetId) {
        return;
      }

      window.turnstile.remove(widgetId);
      turnstileWidgetIdRef.current = null;
      setTurnstileToken(null);
      turnstileTokenResolverRef.current?.(null);
      turnstileTokenResolverRef.current = null;
    };
  }, [turnstileScriptReady, turnstileSiteKey]);

  const voiceLanguage = getSpeechLocaleForLanguageCode(currentLanguageCode);
  const azureVoiceOptions = getAzureVoiceOptions(currentLanguageCode);
  const effectiveAzureVoice = getAzureVoiceOption(
    currentLanguageCode,
    selectedAzureVoiceName,
  );
  const voiceOptions = getVoiceOptions(availableVoices, voiceLanguage);
  const effectiveVoiceUri =
    selectedVoiceUri ||
    chooseBestVoice(voiceOptions, voiceLanguage)?.voiceURI ||
    "";
  const selectedReadAloudVoiceLabel = effectiveAzureVoice.label;
  const isCompactComposer = isComposerFocused || isKeyboardViewportCompressed;
  const micUnavailable = micSupported === false;
  const exportEntryLabel = getConversationContentEntry(entryId, currentLanguageCode).label;
  const shouldReserveAnswerScrollRoom =
    !isStreaming && messages.some((message) => message.role === "user");
  // Below the sm breakpoint the controls stay at 48px even when the
  // composer is not focused: four controls at 80px plus gaps leave a
  // 390px viewport with a ~36px textarea.
  const composerControlSizeClassName =
    "min-h-12 min-w-12 sm:min-h-20 sm:min-w-20";

  // Saved/exported copies are text: attachments are represented by a fixed
  // label line so an image-only turn does not silently vanish from the export.
  function getExportMessages(): ClientChatMessage[] {
    return messages.map((message) =>
      message.attachments && message.attachments.length > 0
        ? {
            ...message,
            text: [copy.attachmentExportLabel, message.text.trim()]
              .filter((part) => part.length > 0)
              .join("\n"),
          }
        : message,
    );
  }

  function getConversationExportText() {
    return formatConversationForExport(getExportMessages(), {
      copy,
      entryLabel: exportEntryLabel,
      languageLabel: currentLanguageLabel,
    });
  }

  function getAnswerExportText(text: string) {
    return formatAnswerForExport(text, {
      copy,
      entryLabel: exportEntryLabel,
      languageLabel: currentLanguageLabel,
    });
  }

  function getDocxLabels() {
    return {
      assistantLabel: copy.conversationExportAssistantLabel,
      entryLabel: exportEntryLabel,
      languageExportLabel: copy.conversationExportLanguageLabel,
      languageLabel: currentLanguageLabel,
      savedLabel: copy.conversationExportSavedLabel,
      startedFromLabel: copy.conversationExportStartedFromLabel,
      userLabel: copy.conversationExportUserLabel,
    };
  }

  function getSavePayload(target: SaveTarget) {
    if (target.kind === "answer") {
      const text = target.text.trim();

      return {
        actionText: formatMarkdownForPlainText(text),
        fileText: getAnswerExportText(text),
        filename: makeAnswerExportFilename(entryId),
        title: copy.answerExportTitle,
      };
    }

    const text = getConversationExportText();

    return {
      actionText: text,
      fileText: text,
      filename: makeConversationExportFilename(entryId),
      title: copy.conversationExportTitle,
    };
  }

  function setSaveFeedback(target: SaveTarget, message: string | null) {
    if (target.kind === "answer") {
      setAnswerStatusMessages((current) => {
        const next = { ...current };

        if (message) {
          next[target.messageId] = message;
        } else {
          delete next[target.messageId];
        }

        return next;
      });
      return;
    }

    setSaveStatusMessage(message);
  }

  function resetTurnstileToken() {
    setTurnstileToken(null);
    turnstileTokenResolverRef.current?.(null);
    turnstileTokenResolverRef.current = null;

    if (
      !turnstileSiteKey ||
      typeof window === "undefined" ||
      !window.turnstile ||
      !turnstileWidgetIdRef.current
    ) {
      return;
    }

    window.turnstile.reset(turnstileWidgetIdRef.current);
  }

  function setTurnstilePreparation(isPreparing: boolean) {
    isPreparingTurnstileRef.current = isPreparing;
    setIsPreparingTurnstile(isPreparing);
  }

  function getTurnstileTokenForSend(): Promise<string | null> {
    if (!turnstileSiteKey) {
      return Promise.resolve(null);
    }

    if (turnstileToken) {
      return Promise.resolve(turnstileToken);
    }

    if (typeof window === "undefined") {
      return Promise.resolve(null);
    }

    const turnstile = window.turnstile;
    const widgetId = turnstileWidgetIdRef.current;

    if (!turnstile || !widgetId) {
      return Promise.resolve(null);
    }

    setTurnstilePreparation(true);

    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: number | null = null;
      const finish = (token: string | null) => {
        if (settled) {
          return;
        }

        settled = true;

        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }

        turnstileTokenResolverRef.current = null;
        setTurnstilePreparation(false);
        resolve(token);
      };

      turnstileTokenResolverRef.current = finish;
      timeoutId = window.setTimeout(() => finish(null), turnstileSendTimeoutMs);

      try {
        turnstile.execute(widgetId);
      } catch {
        finish(null);
      }
    });
  }

  function markSaveWarningSeen() {
    if (typeof window === "undefined") {
      return;
    }

    writeLocalStorage("access-tool-save-warning-seen", "true");
    setHasSeenSaveWarning(true);
  }

  function downloadBlobFile(blob: Blob, filename: string) {
    if (typeof window === "undefined") {
      return false;
    }

    let objectUrl: string | null = null;
    let anchor: HTMLAnchorElement | null = null;

    try {
      const file = new File([blob], filename, { type: blob.type });
      objectUrl = URL.createObjectURL(file);
      anchor = document.createElement("a");

      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      return true;
    } catch {
      return false;
    } finally {
      anchor?.remove();

      if (objectUrl) {
        const urlToRevoke = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1000);
      }
    }
  }

  function downloadTextFile(fileContents: string, filename: string) {
    return downloadBlobFile(
      new Blob([fileContents], { type: "text/plain;charset=utf-8" }),
      filename,
    );
  }

  async function saveTargetLocally(target: SaveTarget) {
    const payload = getSavePayload(target);

    if (downloadTextFile(payload.fileText, payload.filename)) {
      setSaveFeedback(target, target.kind === "answer" ? copy.answerSaved : null);
      return;
    }

    setSaveFeedback(
      target,
      await copyTextToClipboard(payload.actionText) ? copy.saveCopied : copy.saveCopyFailed,
    );
  }

  async function saveTargetDocxLocally(target: SaveTarget) {
    try {
      const docx = await import("../lib/docx-export");
      const blob =
        target.kind === "answer"
          ? await docx.buildAnswerDocxBlob({
              labels: getDocxLabels(),
              text: target.text,
              title: copy.answerExportTitle,
            })
          : await docx.buildConversationDocxBlob({
              labels: getDocxLabels(),
              messages: getExportMessages(),
              title: copy.conversationExportTitle,
            });
      const filename =
        target.kind === "answer"
          ? makeAnswerDocxFilename(entryId)
          : makeConversationDocxFilename(entryId);

      if (downloadBlobFile(blob, filename)) {
        setSaveFeedback(target, copy.docxSaved);
        return;
      }
    } catch {
      // Fall through to visible UI feedback.
    }

    setSaveFeedback(target, copy.docxFailed);
  }

  async function saveTargetPdfLocally(target: SaveTarget) {
    try {
      const pdf = await import("../lib/pdf-export");
      const blob =
        target.kind === "answer"
          ? await pdf.buildAnswerPdfBlob({
              labels: getDocxLabels(),
              text: target.text,
              title: copy.answerExportTitle,
            })
          : await pdf.buildConversationPdfBlob({
              labels: getDocxLabels(),
              messages: getExportMessages(),
              title: copy.conversationExportTitle,
            });
      const filename =
        target.kind === "answer"
          ? makeAnswerPdfFilename(entryId)
          : makeConversationPdfFilename(entryId);

      if (downloadBlobFile(blob, filename)) {
        setSaveFeedback(target, copy.pdfSaved);
        return;
      }
    } catch {
      // Fall through to visible UI feedback.
    }

    setSaveFeedback(target, copy.pdfFailed);
  }

  async function emailTargetToSelf(target: SaveTarget) {
    if (typeof window === "undefined") {
      return;
    }

    const payload = getSavePayload(target);
    const href = buildMailtoHref({
      subject: payload.title,
      body: payload.actionText,
      to: "",
    });

    if (!isMailtoHrefWithinLimit(href)) {
      setSaveFeedback(
        target,
        await copyTextToClipboard(payload.actionText) ? copy.saveCopied : copy.saveCopyFailed,
      );
      return;
    }

    setSaveFeedback(target, null);
    setShowSaveModal(false);
    window.location.assign(href);
  }

  async function handleSavePress() {
    if (isStreaming) {
      return;
    }

    const target: SaveTarget = { kind: "conversation" };
    setSaveTarget(target);
    setSaveFeedback(target, null);

    if (hasSeenSaveWarning) {
      await saveTargetLocally(target);
      return;
    }

    setShowSaveModal(true);
  }

  async function handleSaveAnswerPress(messageId: string, text: string) {
    if (isStreaming) {
      return;
    }

    const target: SaveTarget = { kind: "answer", messageId, text };
    setSaveTarget(target);
    setSaveFeedback(target, null);

    if (hasSeenSaveWarning) {
      await saveTargetLocally(target);
      return;
    }

    setShowSaveModal(true);
  }

  async function handleSaveAnswerDocxPress(messageId: string, text: string) {
    if (isStreaming) {
      return;
    }

    const target: SaveTarget = { kind: "answer", messageId, text };
    setSaveTarget(target);
    setSaveFeedback(target, null);

    if (hasSeenSaveWarning) {
      await saveTargetDocxLocally(target);
      return;
    }

    setShowSaveModal(true);
  }

  async function handleSaveAnswerPdfPress(messageId: string, text: string) {
    if (isStreaming) {
      return;
    }

    const target: SaveTarget = { kind: "answer", messageId, text };
    setSaveTarget(target);
    setSaveFeedback(target, null);

    if (hasSeenSaveWarning) {
      await saveTargetPdfLocally(target);
      return;
    }

    setShowSaveModal(true);
  }

  async function handleSaveHere() {
    if (isStreaming) {
      return;
    }

    const target = saveTarget;
    markSaveWarningSeen();
    setSaveFeedback(target, null);
    setShowSaveModal(false);
    await saveTargetLocally(target);
  }

  async function handleSaveDocxHere() {
    if (isStreaming) {
      return;
    }

    const target = saveTarget;
    markSaveWarningSeen();
    setSaveFeedback(target, null);
    setShowSaveModal(false);
    await saveTargetDocxLocally(target);
  }

  async function handleSavePdfHere() {
    if (isStreaming) {
      return;
    }

    const target = saveTarget;
    markSaveWarningSeen();
    setSaveFeedback(target, null);
    setShowSaveModal(false);
    await saveTargetPdfLocally(target);
  }

  function handleEmailToSelf() {
    if (isStreaming) {
      return;
    }

    const target = saveTarget;
    markSaveWarningSeen();
    setSaveFeedback(target, null);
    void emailTargetToSelf(target);
  }

  async function handleShareTarget(target: SaveTarget) {
    if (isStreaming) {
      return;
    }

    if (typeof window === "undefined" || typeof navigator.share !== "function") {
      setSaveFeedback(target, copy.saveShareFailed);
      return;
    }

    const payload = getSavePayload(target);

    try {
      await navigator.share({
        title: payload.title,
        text: payload.actionText,
      });
      setSaveFeedback(target, null);
    } catch {
      setSaveFeedback(target, copy.saveShareFailed);
    }
  }

  async function handleCopyTarget(target: SaveTarget) {
    if (isStreaming) {
      return;
    }

    const payload = getSavePayload(target);

    setSaveFeedback(
      target,
      await copyTextToClipboard(payload.actionText) ? copy.saveCopied : copy.saveCopyFailed,
    );
  }

  function clearProviderAudio() {
    audioRef.current?.pause();
    audioRef.current = null;

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }

  function stopReadingAloud() {
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    utteranceRef.current = null;
    clearProviderAudio();
    setSpeakingMessageId(null);
    setSpeechLoadingMessageId(null);
  }

  function playWithDeviceVoice(messageId: string, text: string) {
    if (
      !speechSupported ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      return false;
    }

    window.speechSynthesis.cancel();
    const language = voiceLanguage;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = speechRate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const preferredVoice =
      voiceOptions.find((voice) => voice.voiceURI === effectiveVoiceUri) ??
      chooseBestVoice(voiceOptions, language);

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utteranceRef.current = utterance;
    utterance.onend = () => {
      utteranceRef.current = null;
      setSpeakingMessageId(null);
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setSpeakingMessageId(null);
    };

    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
    return true;
  }

  async function handlePlayAloud(messageId: string, text: string) {
    if (speakingMessageId === messageId || speechLoadingMessageId === messageId) {
      stopReadingAloud();
      return;
    }

    const speechText = stripMarkdownForSpeech(text);

    if (!speechText) {
      return;
    }

    stopReadingAloud();
    setErrorMessage(null);

    if (typeof window === "undefined") {
      return;
    }

    const abortController = new AbortController();
    ttsAbortControllerRef.current = abortController;
    setSpeechLoadingMessageId(messageId);

    try {
      const response = await fetch("/api/tts", {
        body: JSON.stringify({
          language: currentLanguageCode,
          text: speechText,
          voiceName: effectiveAzureVoice.name,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abortController.signal,
      });

      if (!response.ok) {
        const rawErrorBody = await response.json().catch(() => null);
        const errorBody = isTtsErrorBody(rawErrorBody) ? rawErrorBody : null;

        throw new Error(errorBody?.error ?? "TTS unavailable");
      }

      const audioBlob = await response.blob();

      if (abortController.signal.aborted) {
        return;
      }

      if (audioBlob.size === 0) {
        throw new Error("Empty audio response");
      }

      const objectUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(objectUrl);

      audioRef.current = audio;
      audioObjectUrlRef.current = objectUrl;
      audio.onended = () => {
        clearProviderAudio();
        setSpeakingMessageId(null);
      };
      audio.onerror = () => {
        clearProviderAudio();
        setSpeakingMessageId(null);
        setErrorMessage(copy.voiceUnavailable);
      };

      await audio.play();

      if (!abortController.signal.aborted) {
        setSpeakingMessageId(messageId);
      }
    } catch {
      if (abortController.signal.aborted) {
        return;
      }

      clearProviderAudio();

      if (!playWithDeviceVoice(messageId, speechText)) {
        setErrorMessage(copy.voiceUnavailable);
      }
    } finally {
      if (ttsAbortControllerRef.current === abortController) {
        ttsAbortControllerRef.current = null;
      }

      setSpeechLoadingMessageId((currentId) =>
        currentId === messageId ? null : currentId,
      );
    }
  }

  function handleMicInput() {
    if (
      typeof window === "undefined" ||
      (!window.SpeechRecognition && !window.webkitSpeechRecognition)
    ) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      return;
    }

    recognitionRef.current?.stop();
    dictationBaseDraftRef.current = draft.trimEnd();

    const recognition = new Recognition();
    recognition.lang = getSpeechLocaleForLanguageCode(currentLanguageCode);
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }

      setDraft((currentDraft) => {
        const trimmedTranscript = transcript.trim();

        if (!trimmedTranscript) {
          return currentDraft;
        }

        const base = dictationBaseDraftRef.current;

        return base ? `${base} ${trimmedTranscript}` : trimmedTranscript;
      });
    };
    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
      dictationBaseDraftRef.current = "";
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      dictationBaseDraftRef.current = "";
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  async function handleAttachmentPick(fileList: FileList | null) {
    const picked = Array.from(fileList ?? []);

    if (picked.length === 0) {
      return;
    }

    if (pendingAttachments.length + picked.length > maxAttachmentsPerMessage) {
      setErrorMessage(copy.attachmentLimitReached);
      return;
    }

    setErrorMessage(null);
    setIsPreparingAttachments(true);

    try {
      for (const pickedFile of picked) {
        const attachment = await processSelectedAttachment(pickedFile);

        setPendingAttachments((current) =>
          current.length >= maxAttachmentsPerMessage
            ? current
            : [...current, attachment],
        );
      }
    } catch (error: unknown) {
      const code =
        error instanceof AttachmentError ? error.code : "processing-failed";

      setErrorMessage(
        code === "too-large"
          ? copy.attachmentTooLarge
          : code === "unsupported-type"
            ? copy.attachmentUnsupported
            : copy.attachmentFailed,
      );
    } finally {
      setIsPreparingAttachments(false);
      // The native file dialog moves focus off the composer; return it so
      // the user can keep typing without tapping the message box again.
      composerRef.current?.focus();
    }
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    composerRef.current?.focus();
  }

  async function sendMessage(text: string, trackSubmit = false) {
    const trimmed = text.trim();

    if (!trimmed && pendingAttachments.length === 0) {
      return;
    }

    if (trackSubmit) {
      trackUsageEvent({
        entryId,
        eventType: "chat_submit_click",
        language: currentLanguageCode,
      });
    }

    if (isStreaming || isPreparingTurnstileRef.current) {
      // Attachments stay pending and ride the next successful send.
      if (trimmed) {
        queuedDraftRef.current = trimmed;
      }
      setDraft("");
      return;
    }

    composerRef.current?.blur();

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    const verifiedTurnstileToken = await getTurnstileTokenForSend();

    if (turnstileSiteKey && !verifiedTurnstileToken) {
      setErrorMessage(lastSendFailureMessageRef.current ?? copy.sendFailure);
      return;
    }

    const nextUserMessage: ClientChatMessage = {
      id: makeMessageId("user"),
      role: "user",
      text: trimmed,
      ...(pendingAttachments.length > 0
        ? { attachments: pendingAttachments }
        : {}),
    };
    const pendingAssistantId = makeMessageId("assistant");
    const pendingAssistantMessage: ClientChatMessage = {
      id: pendingAssistantId,
      role: "assistant",
      text: "",
      weakCategory: "none",
    };
    const nextMessages = [...messages, nextUserMessage];
    const sentMessages = windowMessagesForRequest(nextMessages);

    setMessages([...nextMessages, pendingAssistantMessage]);
    setDraft("");
    setPendingAttachments([]);
    setErrorMessage(null);
    setSaveStatusMessage(null);
    setShowSuggestions(false);
    setIsStreaming(true);
    setPendingClassifierMessageId(pendingAssistantId);

    void (async () => {
      let receivedAnyText = false;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entryId,
            language: currentLanguageCode,
            messages: prepareMessagesForRequest(sentMessages),
            turnstileToken: turnstileSiteKey ? verifiedTurnstileToken : undefined,
          }),
        });

        if (!response.ok) {
          const rawErrorBody = await response.json().catch(() => null);
          const errorBody: ChatErrorBody | null = isChatErrorBody(rawErrorBody)
            ? rawErrorBody
            : null;

          if (errorBody?.assistantNotice) {
            setMessages([
              ...nextMessages,
              {
                id: pendingAssistantId,
                role: "assistant",
                text: errorBody.assistantNotice,
                weakCategory: "none",
              },
            ]);
            setErrorMessage(null);
          } else {
            const visibleError = errorBody?.error ?? copy.sendFailure;

            lastSendFailureMessageRef.current = visibleError;
            setMessages(nextMessages);
            setErrorMessage(visibleError);
          }
          setPendingClassifierMessageId((currentId) =>
            currentId === pendingAssistantId ? null : currentId,
          );
          return;
        }

        const reader = response.body?.getReader();

        if (!reader) {
          lastSendFailureMessageRef.current = copy.sendFailure;
          setMessages(nextMessages);
          setErrorMessage(copy.sendFailure);
          setPendingClassifierMessageId((currentId) =>
            currentId === pendingAssistantId ? null : currentId,
          );
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let sawDoneEvent = false;

        while (true) {
          const { done, value } = await reader.read();

          buffer += decoder.decode(value, { stream: !done });

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const eventBlock of events) {
            const dataLine = eventBlock
              .split("\n")
              .find((line) => line.startsWith("data: "));

            if (!dataLine) {
              continue;
            }

            const payload = dataLine.slice(6);

            if (payload === "[DONE]") {
              sawDoneEvent = true;
              lastSendFailureMessageRef.current = null;
              setPendingClassifierMessageId((currentId) =>
                currentId === pendingAssistantId ? null : currentId,
              );
              setIsStreaming(false);
              continue;
            }

            if (sawDoneEvent) {
              continue;
            }

            const rawEvent = JSON.parse(payload) as unknown;

            if (!isChatStreamEvent(rawEvent)) {
              continue;
            }

            const event: ChatStreamEvent = rawEvent;

            if (event.type === "error") {
              if (!receivedAnyText) {
                setMessages(nextMessages);
              }

              lastSendFailureMessageRef.current = event.error;
              setErrorMessage(event.error);
              setPendingClassifierMessageId((currentId) =>
                currentId === pendingAssistantId ? null : currentId,
              );
              setIsStreaming(false);
              return;
            }

            if (event.type === "delta") {
              const replace = !receivedAnyText;
              receivedAnyText = true;
              setMessages((currentMessages) =>
                appendToMessage(currentMessages, pendingAssistantId, event.text, replace),
              );
              continue;
            }

            if (event.type === "classifier") {
              setMessages((currentMessages) =>
                setMessageWeakCategory(currentMessages, pendingAssistantId, event.category),
              );
              setPendingClassifierMessageId((currentId) =>
                currentId === pendingAssistantId ? null : currentId,
              );
              continue;
            }

            if (event.type === "suggestions") {
              const suggestions = filterGeneratedSuggestions(
                event.suggestions,
                copy.findHumanForThis,
              );
              setMessages((currentMessages) =>
                setMessageSuggestions(currentMessages, pendingAssistantId, suggestions),
              );
            }
          }

          if (done) {
            break;
          }
        }
      } catch {
        lastSendFailureMessageRef.current = copy.sendFailure;
        setMessages((currentMessages) =>
          currentMessages.filter((message) => message.id !== pendingAssistantId || message.text.length > 0),
        );
        setErrorMessage(copy.sendFailure);
        setPendingClassifierMessageId((currentId) =>
          currentId === pendingAssistantId ? null : currentId,
        );
      } finally {
        resetTurnstileToken();
        setPendingClassifierMessageId((currentId) =>
          currentId === pendingAssistantId ? null : currentId,
        );
        setIsStreaming(false);

        // Return focus to the composer so the next turn can be typed without a
        // click. Only on pointer-fine (desktop) devices, so the mobile keyboard
        // is not re-summoned over the answer the user is reading.
        if (
          typeof window !== "undefined" &&
          window.matchMedia("(pointer: fine)").matches
        ) {
          composerRef.current?.focus();
        }
      }
    })();
  }

  useEffect(() => {
    if (isStreaming || !queuedDraftRef.current) {
      return;
    }

    const queued = queuedDraftRef.current;
    queuedDraftRef.current = null;
    void sendMessage(queued);
    // sendMessage is recreated every render; this effect only needs to fire on
    // the streaming -> idle transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  function handleSuggestionSelect(suggestion: string) {
    // If the user has already started typing, don't silently throw their draft
    // away. Fold the suggestion into the draft so they can edit and send it.
    if (draft.trim().length > 0) {
      setDraft((current) => `${current.trim()} ${suggestion}`);
      composerRef.current?.focus();
      return;
    }

    void sendMessage(suggestion);
  }

  const referralActiveCategory =
    referralSheet && !referralSheet.showAll ? referralSheet.category : null;
  const referralResources = referralSheet
    ? getReferralsForCategory({
        category: referralActiveCategory,
        regionScope,
      })
    : [];
  const referralCheckedThroughDate = getCheckedThroughDate(referralResources);
  const formatReferralDate = (value: string) =>
    new Intl.DateTimeFormat(currentLanguageCode, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124] print:h-auto print:overflow-visible">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileScriptReady(true)}
        />
      ) : null}

      <div
        aria-hidden={hasOpenSheet ? true : undefined}
        inert={hasOpenSheet ? true : undefined}
        className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-4 pt-3 sm:max-w-2xl sm:px-6 lg:max-w-3xl lg:px-8 lg:pt-5 print:overflow-visible"
      >
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 pb-3">
          <Link
            href={buildHomeHref(currentLanguageCode)}
            aria-label={copy.backLabel}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22] print:invisible"
          >
            <span aria-hidden="true">{"<"}</span>
          </Link>

          <Link
            href={buildHomeHref(currentLanguageCode)}
            aria-label={copy.homeLabel}
            className="truncate text-center text-[18px] font-semibold text-[#171a18]"
          >
            {appTitle}
          </Link>

          <button
            type="button"
            aria-label={copy.chooseLanguageLabel}
            aria-controls={languageSheetDialogId}
            aria-expanded={showLanguageSheet}
            aria-haspopup="dialog"
            onClick={() => setShowLanguageSheet(true)}
            className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-3 text-[15px] font-medium text-[#314036] print:invisible"
          >
            {currentLanguageLabel}
          </button>
        </header>

        <section
          ref={threadRef}
          aria-busy={isStreaming}
          aria-live="polite"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4 lg:max-h-[calc(100dvh-22rem)] lg:flex-none print:max-h-none print:overflow-visible"
        >
          <div className="flex flex-col gap-5">
            {!hasTranslatedCopy && currentLanguageCode !== "en" ? (
              <div className="rounded-[16px] border border-[#d8e1db] bg-[#fdfefe] px-4 py-3 text-[14px] leading-6 text-[#5f6d64]">
                {copy.translationNotice}
              </div>
            ) : null}

            {messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const isEmptyAssistant = isAssistant && message.text.length === 0;
              const weakCategory =
                isAssistant && message.weakCategory && message.weakCategory !== "none"
                  ? message.weakCategory
                  : null;
              const isClassifierPending =
                isAssistant &&
                pendingClassifierMessageId === message.id &&
                !isEmptyAssistant;
              const isSpeechLoading = speechLoadingMessageId === message.id;

              return (
                <div
                  key={message.id}
                  className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                >
                  <div className="min-w-0 max-w-[88%] sm:max-w-[78%] lg:max-w-[72%]">
                    <article
                      data-message-role={message.role}
                      ref={(element) => {
                        if (!isAssistant) {
                          return;
                        }

                        if (element) {
                          assistantMessageRefs.current.set(message.id, element);
                        } else {
                          assistantMessageRefs.current.delete(message.id);
                        }
                      }}
                      className={`break-words px-4 py-3 text-[18px] leading-7 shadow-[0_1px_0_rgba(29,42,34,0.08)] ${
                        isAssistant
                          ? "rounded-[18px] rounded-bl-[6px] bg-white text-[#1f2923]"
                          : "whitespace-pre-wrap rounded-[18px] rounded-br-[6px] bg-[#1f5f43] text-white print:border print:border-[#cfd7cf] print:text-[#1f2923]"
                      }`}
                    >
                      {isEmptyAssistant ? (
                        <p className="text-[#65736b]">{copy.thinking}</p>
                      ) : isAssistant ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                            ol: ({ children }) => (
                              <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
                            ),
                            ul: ({ children }) => (
                              <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
                            ),
                            li: ({ children }) => <li>{children}</li>,
                            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          }}
                        >
                          {message.text}
                        </ReactMarkdown>
                      ) : (
                        <>
                          {message.attachments && message.attachments.length > 0 ? (
                            <span
                              className={`flex flex-wrap gap-2 ${
                                message.text.length > 0 ? "mb-2" : ""
                              }`}
                            >
                              {message.attachments.map(
                                (attachment, attachmentIndex) =>
                                  attachment.mediaType === "application/pdf" ? (
                                    <span
                                      key={attachmentIndex}
                                      className="flex h-16 w-16 items-center justify-center rounded-[12px] border border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.12)] text-[13px] font-semibold"
                                    >
                                      PDF
                                    </span>
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      key={attachmentIndex}
                                      src={makeAttachmentPreviewUrl(attachment)}
                                      alt={copy.attachmentImageAlt}
                                      className="max-h-40 max-w-full rounded-[12px] border border-[rgba(255,255,255,0.4)] object-contain"
                                    />
                                  ),
                              )}
                            </span>
                          ) : null}
                          {message.text}
                        </>
                      )}
                    </article>

                    {isAssistant && !isEmptyAssistant ? (
                      <div className="mt-3 space-y-3">
                        {isClassifierPending ? (
                          <p className="rounded-[16px] border border-[#d4ddd6] bg-[#fdfefe] px-4 py-3 text-[14px] leading-6 text-[#5f6d64]">
                            {copy.weakCategoryPending}
                          </p>
                        ) : weakCategory ? (
                          <button
                            type="button"
                            aria-controls={referralSheetDialogId}
                            aria-expanded={isReferralSheetOpen}
                            aria-haspopup="dialog"
                            onClick={() =>
                              setReferralSheet({ category: weakCategory, showAll: false })
                            }
                            className="block w-full rounded-[16px] border border-[#ead8b7] bg-[#fff9ef] px-4 py-3 text-left text-[14px] leading-6 text-[#6a4c12]"
                          >
                            <span className="font-semibold">{copy.weakCategoryLead}</span>{" "}
                            {copy.weakCategoryTail}{" "}
                            <span className="font-semibold">
                              {copy.weakCategoryLabels[weakCategory]}
                            </span>
                            .
                          </button>
                        ) : null}

                        <div className="flex flex-wrap items-start gap-2 print:hidden">
                          <details
                            className="group min-w-0"
                            onToggle={(event) => {
                              if (event.currentTarget.open) {
                                event.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
                              }
                            }}
                          >
                            <summary
                              className={`${toolButtonClassName} cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden`}
                            >
                              {copy.answerToolsLabel}
                              <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={() => void handlePlayAloud(message.id, message.text)}
                            className={toolButtonClassName}
                          >
                            <SpeakerIcon className="h-4 w-4 shrink-0" />
                            {isSpeechLoading
                              ? copy.voiceLoading
                              : speakingMessageId === message.id
                                ? copy.stopReading
                                : copy.playAloud}
                          </button>
                          <button
                            type="button"
                            aria-controls={voiceSettingsDialogId}
                            aria-expanded={showVoiceSettings}
                            aria-haspopup="dialog"
                            disabled={isStreaming}
                            onClick={() => setShowVoiceSettings(true)}
                            className={toolButtonClassName}
                          >
                            <VoiceIcon className="h-4 w-4 shrink-0" />
                              {copy.voiceTitle}
                          </button>
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={() => void handleCopyTarget({
                              kind: "answer",
                              messageId: message.id,
                              text: message.text,
                            })}
                            className={toolButtonClassName}
                          >
                            <CopyIcon className="h-4 w-4 shrink-0" />
                            {copy.answerCopy}
                          </button>
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={() => void handleSaveAnswerPress(message.id, message.text)}
                            className={toolButtonClassName}
                          >
                            <SaveIcon className="h-4 w-4 shrink-0" />
                            {copy.answerSave}
                          </button>
                          <button
                            type="button"
                            aria-label={copy.answerDocxLabel}
                            disabled={isStreaming}
                            onClick={() => void handleSaveAnswerDocxPress(message.id, message.text)}
                            className={toolButtonClassName}
                          >
                            <DocumentIcon className="h-4 w-4 shrink-0" />
                            {copy.answerDocx}
                          </button>
                          <button
                            type="button"
                            aria-label={copy.answerPdfLabel}
                            disabled={isStreaming}
                            onClick={() => void handleSaveAnswerPdfPress(message.id, message.text)}
                            className={toolButtonClassName}
                          >
                            <DocumentIcon className="h-4 w-4 shrink-0" />
                            {copy.answerPdf}
                          </button>
                            </div>
                          </details>
                          <button
                            type="button"
                            aria-controls={referralSheetDialogId}
                            aria-expanded={isReferralSheetOpen}
                            aria-haspopup="dialog"
                            onClick={() =>
                              setReferralSheet({ category: weakCategory, showAll: false })
                            }
                            className={humanHelpButtonClassName}
                          >
                            <HumanHelpIcon className="h-4 w-4 shrink-0" />
                            {copy.findHumanForThis}
                          </button>
                        </div>
                        {answerStatusMessages[message.id] ? (
                          <p role="status" className="text-[14px] leading-6 text-[#47564d]">
                            {answerStatusMessages[message.id]}
                          </p>
                        ) : null}
                        {message.suggestions?.length ? (
                          <details
                            className="group print:hidden"
                            onToggle={(event) => {
                              if (event.currentTarget.open) {
                                event.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
                              }
                            }}
                          >
                            <summary className="inline-flex cursor-pointer items-center gap-2 rounded-[16px] border border-[#a9c3b6] bg-[#eef7f1] px-4 py-3 text-[15px] font-semibold leading-5 text-[#20382d] list-none [&::-webkit-details-marker]:hidden">
                              {copy.suggestedReplies}
                              <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {message.suggestions.map((suggestion) => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  onClick={() => handleSuggestionSelect(suggestion)}
                                  disabled={isStreaming}
                                  className={suggestionButtonClassName}
                                >
                                  {suggestion}
                                </button>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {showSuggestions ? (
              <div className="flex flex-wrap gap-2 print:hidden">
                {initialSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionSelect(suggestion)}
                    className={suggestionButtonClassName}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}

            {errorMessage ? (
              <p role="status" className="text-[15px] leading-6 text-[#9a3f2f]">
                {errorMessage}
              </p>
            ) : null}

            {turnstileSiteKey ? (
              <div
                ref={turnstileContainerRef}
                className="flex justify-center"
              />
            ) : null}

            {shouldReserveAnswerScrollRoom ? (
              <div aria-hidden="true" className="h-[45dvh] shrink-0 sm:hidden print:hidden" />
            ) : null}
          </div>
        </section>

        <section
          className={`shrink-0 border-t border-[#d4ddd6] print:hidden ${isCompactComposer ? "py-2 sm:py-3" : "py-3"}`}
        >
          <div
            className={`flex flex-wrap items-center gap-2 ${isCompactComposer ? "mb-0 hidden sm:mb-3 sm:flex" : "mb-3"}`}
          >
            <button
              type="button"
              disabled={isStreaming}
              onClick={handleSavePress}
              className={utilityButtonClassName}
            >
              {copy.saveButton}
            </button>
            <button
              type="button"
              aria-label={copy.saveExplainLabel}
              aria-controls={saveDialogId}
              aria-expanded={showSaveModal}
              aria-haspopup="dialog"
              disabled={isStreaming}
              onClick={() => {
                setSaveTarget({ kind: "conversation" });
                setShowSaveModal(true);
              }}
              className={utilityIconButtonClassName}
            >
              {copy.saveExplainButton}
            </button>
          </div>
          {saveStatusMessage && !showSaveModal ? (
            <p
              role="status"
              className={`text-[14px] leading-6 text-[#47564d] ${isCompactComposer ? "mb-0 hidden sm:block sm:mb-3" : "mb-3"}`}
            >
              {saveStatusMessage}
            </p>
          ) : null}

          {pendingAttachments.length > 0 || isPreparingAttachments ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {pendingAttachments.map((attachment, index) => (
                <div
                  key={`${attachment.mediaType}-${index}`}
                  className="relative"
                >
                  {attachment.mediaType === "application/pdf" ? (
                    <span className="flex h-14 w-14 items-center justify-center rounded-[12px] border border-[#d3ddd6] bg-white text-[12px] font-semibold text-[#405047]">
                      PDF
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={makeAttachmentPreviewUrl(attachment)}
                      alt={copy.attachmentImageAlt}
                      className="h-14 w-14 rounded-[12px] border border-[#d3ddd6] object-cover"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={copy.attachmentRemoveLabel}
                    // Keep composer focus: blurring collapses the composer
                    // and reflows this row mid-tap, so the tap misses (or
                    // hits the wrong file's remove button).
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => removePendingAttachment(index)}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[13px] font-semibold text-[#405047] shadow-[0_1px_4px_rgba(29,42,34,0.18)]"
                  >
                    ×
                  </button>
                </div>
              ))}
              {isPreparingAttachments ? (
                <p className="text-[14px] leading-6 text-[#5f6d64]">
                  {copy.attachmentPreparing}
                </p>
              ) : null}
            </div>
          ) : null}

          <form
            // Phones get two rows (full-width message box above the
            // controls); from sm up everything shares one row.
            className="flex flex-wrap items-end gap-2 sm:flex-nowrap"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(draft, true);
            }}
          >
            <input
              ref={attachmentPickerRef}
              type="file"
              // HEIC is deliberately absent: iOS transcodes HEIC to JPEG at
              // selection time when the accept list excludes it, so the app
              // never has to decode HEIC. See docs/decisions/
              // 2026-07-26-inline-file-upload-v1.md.
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              hidden
              onChange={(event) => {
                void handleAttachmentPick(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={cameraPickerRef}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              hidden
              onChange={(event) => {
                void handleAttachmentPick(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label={copy.attachmentAddLabel}
              disabled={isPreparingAttachments}
              onClick={() => attachmentPickerRef.current?.click()}
              className={`order-2 flex items-center justify-center rounded-[18px] border border-[#d3ddd6] bg-white text-[#405047] transition-colors hover:border-[#b7c7bd] disabled:opacity-50 sm:order-1 ${composerControlSizeClassName}`}
            >
              <PaperclipIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={copy.attachmentCameraLabel}
              disabled={isPreparingAttachments}
              onClick={() => cameraPickerRef.current?.click()}
              className={`order-3 flex items-center justify-center rounded-[18px] border border-[#d3ddd6] bg-white text-[#405047] transition-colors hover:border-[#b7c7bd] disabled:opacity-50 sm:order-2 ${composerControlSizeClassName}`}
            >
              <CameraIcon className="h-5 w-5" />
            </button>
            <label
              className="order-1 min-w-0 grow basis-full sm:order-3 sm:basis-0"
              htmlFor="conversation-input"
            >
              <span className="sr-only">{copy.composerAssistiveLabel}</span>
              <textarea
                ref={composerRef}
                id="conversation-input"
                autoComplete="off"
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={() => setIsComposerFocused(true)}
                onBlur={() => setIsComposerFocused(false)}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return;
                  }

                  event.preventDefault();
                  void sendMessage(draft, true);
                }}
                maxLength={maxClientMessageTextLength}
                placeholder={copy.composerPlaceholder}
                className={`w-full resize-none overflow-y-auto rounded-[18px] border-2 border-[#35695a] bg-white px-4 text-[18px] leading-7 text-[#1f2923] shadow-[0_2px_12px_rgba(31,95,67,0.15)] placeholder:text-[#7c8a82] ${
                  isCompactComposer
                    ? "max-h-32 min-h-12 py-3 sm:max-h-56 sm:min-h-20 sm:py-6"
                    : "max-h-56 min-h-20 py-6"
                }`}
              />
            </label>
            <button
              type="button"
              aria-label={copy.micAssistiveLabel}
              onClick={handleMicInput}
              disabled={micUnavailable}
              className={`order-4 ml-auto flex items-center justify-center rounded-[18px] border text-[16px] font-medium transition-colors disabled:opacity-50 sm:ml-0 ${
                isListening
                  ? "border-[#9a6a16] bg-[#fff2d6] text-[#684b10]"
                  : "border-[#d3ddd6] bg-white text-[#405047] hover:border-[#b7c7bd]"
              } ${composerControlSizeClassName}`}
            >
              {isListening ? copy.micStopLabel : copy.micLabel}
            </button>
            <button
              type="submit"
              aria-label={copy.sendAssistiveLabel}
              disabled={
                (draft.trim().length === 0 && pendingAttachments.length === 0) ||
                isPreparingTurnstile ||
                isPreparingAttachments
              }
              className={`order-5 flex items-center justify-center rounded-[18px] bg-[#24594d] text-white shadow-[0_2px_8px_rgba(31,95,67,0.2)] transition-colors hover:bg-[#1d4a40] disabled:bg-[#9fb7ad] disabled:opacity-80 ${composerControlSizeClassName}`}
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </form>
        </section>
      </div>

      {showVoiceSettings ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-[rgba(18,24,20,0.24)] sm:items-center sm:p-6">
          <div
            id={voiceSettingsDialogId}
            ref={voiceSettingsRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={voiceSettingsTitleId}
            aria-describedby={voiceSettingsDescriptionId}
            tabIndex={-1}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)] sm:max-w-xl sm:rounded-[24px] sm:px-6 sm:shadow-[0_16px_48px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 id={voiceSettingsTitleId} className="text-[18px] font-semibold text-[#1f2923]">{copy.voiceTitle}</h2>
                <p id={voiceSettingsDescriptionId} className="text-[14px] text-[#5f6d64]">{selectedReadAloudVoiceLabel}</p>
              </div>
              <button
                ref={voiceSettingsDoneRef}
                type="button"
                onClick={() => setShowVoiceSettings(false)}
                className="min-h-10 shrink-0 whitespace-nowrap rounded-full border border-[#cfd7cf] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                {copy.voiceDone}
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-[15px] font-medium text-[#1f2923]">{copy.naturalVoiceOptionLabel}</span>
                <select
                  value={effectiveAzureVoice.name}
                  onChange={(event) => {
                    setSelectedAzureVoiceName(event.target.value);
                    writeAzureVoicePreference(currentLanguageCode, event.target.value);
                  }}
                  className="min-h-12 w-full rounded-[16px] border border-[#cfd7cf] bg-white px-4 text-[16px] text-[#1f2923]"
                >
                  {azureVoiceOptions.map((voiceOption) => (
                    <option key={voiceOption.name} value={voiceOption.name}>
                      {voiceOption.label}
                    </option>
                  ))}
                </select>
              </label>

              {voiceOptions.length > 0 ? (
                <label className="block">
                  <span className="mb-2 block text-[15px] font-medium text-[#1f2923]">{copy.deviceVoiceOptionLabel}</span>
                  <select
                    value={effectiveVoiceUri}
                    onChange={(event) => setSelectedVoiceUri(event.target.value)}
                    className="min-h-12 w-full rounded-[16px] border border-[#cfd7cf] bg-white px-4 text-[16px] text-[#1f2923]"
                  >
                    {voiceOptions.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="block">
                <div className="mb-2 flex items-center justify-between text-[15px] font-medium text-[#1f2923]">
                  <span>{copy.voiceSpeedLabel}</span>
                  <span>{speechRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.1"
                  step="0.02"
                  value={speechRate}
                  onChange={(event) => setSpeechRate(Number(event.target.value))}
                  className="w-full accent-[#1f5f43]"
                />
              </label>

              {voiceOptions.length === 0 ? (
                <p className="text-[14px] leading-6 text-[#5f6d64]">
                  {copy.voiceNoDeviceVoices}
                </p>
              ) : voiceOptions.length === 1 ? (
                <p className="text-[14px] leading-6 text-[#5f6d64]">
                  {copy.voiceOnlyOneOption}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showLanguageSheet ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-[rgba(18,24,20,0.24)] sm:items-center sm:p-6">
          <div
            id={languageSheetDialogId}
            ref={languageSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={languageSheetTitleId}
            aria-describedby={languageSheetDescriptionId}
            tabIndex={-1}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)] sm:max-w-xl sm:rounded-[24px] sm:px-6 sm:shadow-[0_16px_48px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 id={languageSheetTitleId} className="text-[18px] font-semibold text-[#1f2923]">
                  {copy.languageSheetTitle}
                </h2>
                <p id={languageSheetDescriptionId} className="text-[14px] text-[#5f6d64]">
                  {copy.languageSheetFreshStart}
                </p>
              </div>
              <button
                ref={languageSheetDoneRef}
                type="button"
                onClick={() => setShowLanguageSheet(false)}
                className="min-h-10 shrink-0 whitespace-nowrap rounded-full border border-[#cfd7cf] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                {copy.languageSheetDone}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {languageOptions.map((language) => (
                <Link
                  key={language.code}
                  href={buildConversationHref({
                    entryId,
                    languageCode: language.code,
                  })}
                  className={`flex min-h-12 items-center justify-between rounded-[16px] border px-4 text-[16px] font-medium ${
                    language.code === currentLanguageCode
                      ? "border-[#1f5f43] bg-[#edf3ef] text-[#1f5f43]"
                      : "border-[#cfd7cf] bg-white text-[#1d2a22]"
                  }`}
                >
                  <span>{language.label}</span>
                  {language.code === currentLanguageCode ? <span>{copy.languageSheetCurrent}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {referralSheet ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-[rgba(18,24,20,0.24)] sm:items-center sm:p-6">
          <div
            id={referralSheetDialogId}
            ref={referralSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={referralSheetTitleId}
            tabIndex={-1}
            className="flex max-h-[85dvh] w-full flex-col rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)] sm:max-h-[80dvh] sm:max-w-xl sm:rounded-[24px] sm:px-6 sm:shadow-[0_16px_48px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2
                id={referralSheetTitleId}
                className="text-[20px] font-semibold leading-7 text-[#1f2923]"
              >
                {copy.referralsHeadingLineOne} {copy.referralsHeadingLineTwo}
              </h2>
              <button
                ref={referralSheetCloseRef}
                type="button"
                onClick={() => setReferralSheet(null)}
                className="shrink-0 whitespace-nowrap rounded-full border border-[#cfd7cf] bg-white px-4 py-2 text-[15px] font-medium text-[#1d2a22]"
              >
                {copy.phoneActionClose}
              </button>
            </div>
            <p className="text-[14px] leading-6 text-[#47564d]">
              {regionScope === "king"
                ? copy.referralsIntroKing
                : copy.referralsIntroFallback}
            </p>
            {referralCheckedThroughDate ? (
              <p className="pt-1 text-[13px] leading-5 text-[#5f6d64]">
                {copy.referralsCheckedThroughLabel}{" "}
                {formatReferralDate(referralCheckedThroughDate)}
              </p>
            ) : null}
            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pb-1">
              {referralActiveCategory && referralActiveCategory !== "none" ? (
                <section className="rounded-[18px] border border-[#ead8b7] bg-[#fff9ef] px-4 py-3 text-[15px] leading-6 text-[#6a4c12]">
                  {copy.referralsFilteredPrefix}{" "}
                  <span className="font-semibold">
                    {copy.weakCategoryLabels[referralActiveCategory]}
                  </span>
                  .
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() =>
                        setReferralSheet((current) =>
                          current ? { ...current, showAll: true } : current,
                        )
                      }
                      className="font-semibold underline"
                    >
                      {copy.referralsShowAll}
                    </button>
                  </div>
                </section>
              ) : null}
              {referralResources.map((resource) => (
                <article
                  key={resource.id}
                  className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 shadow-[0_1px_0_rgba(29,42,34,0.08)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[18px] font-semibold leading-6 text-[#1f2923]">
                      {resource.name}
                    </h3>
                    {isReferralSpecificToCategory(resource, referralActiveCategory) ? (
                      <span className="shrink-0 rounded-full bg-[#edf3ef] px-3 py-1 text-[12px] font-semibold text-[#2d5c45]">
                        {copy.referralsBestFit}
                      </span>
                    ) : null}
                  </div>
                  <p className="pt-2 text-[15px] leading-6 text-[#47564d]">
                    {resource.description}
                  </p>

                  <div className="flex flex-wrap gap-2 pt-4">
                    {resource.phone ? (
                      <PhoneAction
                        copy={copy}
                        label={`${copy.referralsCallLabel} ${resource.phone}`}
                        phone={resource.phone}
                        websiteUrl={resource.website}
                        ariaLabel={`${copy.referralsCallLabel} ${resource.name} ${resource.phone}`}
                        buttonClassName="flex min-h-11 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                      />
                    ) : null}

                    {resource.secondaryPhone ? (
                      <PhoneAction
                        actionType={resource.secondaryPhoneType ?? "call"}
                        copy={copy}
                        label={`${resource.secondaryPhoneType === "text" ? copy.referralsTextLabel : copy.referralsAltLabel} ${resource.secondaryPhone}`}
                        phone={resource.secondaryPhone}
                        websiteUrl={resource.website}
                        ariaLabel={`${resource.secondaryPhoneType === "text" ? copy.referralsTextLabel : copy.referralsAltLabel} ${resource.name} ${resource.secondaryPhone}`}
                        buttonClassName="flex min-h-11 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                      />
                    ) : null}

                    <a
                      href={resource.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${copy.referralsWebsiteLabel} ${resource.name}`}
                      className="flex min-h-11 items-center rounded-full bg-[#1f5f43] px-4 text-[15px] font-semibold text-white"
                    >
                      {copy.referralsWebsiteLabel}
                    </a>
                  </div>

                  <div className="mt-4 border-t border-[#e7ece8] pt-4 text-[13px] leading-5 text-[#5f6d64]">
                    <p>
                      {copy.referralsSourceLabel} {resource.sourceName}
                    </p>
                    <p className="pt-1">
                      {copy.referralsVerifiedLabel}{" "}
                      {formatReferralDate(resource.lastVerified)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showSaveModal ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-[rgba(18,24,20,0.24)] sm:items-center sm:p-6">
          <div
            id={saveDialogId}
            ref={saveDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={saveDialogTitleId}
            aria-describedby={saveDialogDescriptionId}
            tabIndex={-1}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)] sm:max-w-xl sm:rounded-[24px] sm:px-6 sm:shadow-[0_16px_48px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <h2 id={saveDialogTitleId} className="text-[20px] font-semibold text-[#1f2923]">
              {saveTarget.kind === "answer" ? copy.saveAnswerTitle : copy.saveTitle}
            </h2>
            <div id={saveDialogDescriptionId} className="pt-4 space-y-4 text-[16px] leading-7 text-[#3c4b42]">
              <p>{copy.saveBodyOne}</p>
              <p>{copy.saveBodyTwo}</p>
              <p>{copy.saveBodyThree}</p>
              <p>
                <Link
                  href={buildPrivacyHref(currentLanguageCode)}
                  className="font-semibold underline"
                >
                  {copy.savePrivacyLink}
                </Link>
              </p>
            </div>

            <div className="pt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={isStreaming}
                onClick={handleSaveHere}
                className="min-h-12 rounded-[16px] bg-[#1f5f43] px-4 text-[16px] font-semibold text-white"
              >
                {copy.saveHere}
              </button>
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => void handleSaveDocxHere()}
                className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
              >
                {copy.saveDocx}
              </button>
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => void handleSavePdfHere()}
                className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
              >
                {copy.savePdf}
              </button>
              {shareSupported ? (
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => {
                    void handleShareTarget(saveTarget);
                  }}
                  className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
                >
                  {copy.saveShare}
                </button>
              ) : null}
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => {
                  void handleCopyTarget(saveTarget);
                }}
                className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
              >
                {copy.saveCopy}
              </button>
              <button
                type="button"
                disabled={isStreaming}
                onClick={handleEmailToSelf}
                className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
              >
                {copy.saveEmail}
              </button>
              {(saveTarget.kind === "answer"
                ? answerStatusMessages[saveTarget.messageId]
                : saveStatusMessage) ? (
                <p role="status" className="px-1 text-[14px] leading-6 text-[#47564d]">
                  {saveTarget.kind === "answer"
                    ? answerStatusMessages[saveTarget.messageId]
                    : saveStatusMessage}
                </p>
              ) : null}
              <button
                ref={saveCancelRef}
                type="button"
                onClick={() => {
                  setSaveStatusMessage(null);
                  setShowSaveModal(false);
                }}
                className="min-h-12 rounded-[16px] border border-[#e1e8e2] bg-[#f7f8f4] px-4 text-[16px] font-medium text-[#47564d]"
              >
                {copy.saveCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        aria-hidden={hasOpenSheet ? true : undefined}
        inert={hasOpenSheet ? true : undefined}
        className="shrink-0"
      >
        <CrisisFooter
          area="conversation"
          compact
          entryId={entryId}
          languageCode={currentLanguageCode}
          regionScope={regionScope}
          sourcePath={conversationHref}
        />
      </div>
    </main>
  );
}
