"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CrisisFooter } from "./crisis-footer";
import { copyTextToClipboard } from "../lib/browser-copy";
import { getConversationContentEntry } from "../lib/conversation-content";
import { getWeakCategoryLabel } from "../lib/referrals";
import {
  buildConversationHref,
  buildFindHumanHref,
  buildHomeHref,
  buildPrivacyHref,
} from "../lib/routes";
import { getUiCopy, hasTranslatedUiCopy } from "../lib/ui-copy";
import type {
  ChatErrorBody,
  ChatStreamEvent,
  ClientChatMessage,
  ConversationEntryId,
  WeakCategory,
} from "../lib/chat-types";
import {
  isChatErrorBody,
  isChatStreamEvent,
  maxClientMessageTextLength,
} from "../lib/chat-types";
import type { RegionScope } from "../lib/geo";
import {
  getSpeechLocaleForLanguageCode,
  languageOptions,
  type SupportedLanguageCode,
} from "../lib/languages";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      size: "invisible";
      theme: "light";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => string;
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

type ConversationClientProps = {
  currentLanguageCode: SupportedLanguageCode;
  currentLanguageLabel: string;
  entryId: ConversationEntryId;
  initialAssistantMessage: string;
  initialSuggestions: readonly string[];
  regionScope: RegionScope;
};

const languageSheetDialogId = "language-sheet-dialog";
const languageSheetTitleId = "language-sheet-title";
const languageSheetDescriptionId = "language-sheet-description";
const saveDialogId = "save-dialog";
const saveDialogTitleId = "save-dialog-title";
const saveDialogDescriptionId = "save-dialog-description";
const voiceSettingsDialogId = "voice-settings-dialog";
const voiceSettingsTitleId = "voice-settings-title";
const voiceSettingsDescriptionId = "voice-settings-description";
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

function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+—\s+/g, ". ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
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
      return `${speaker}:\n${message.text.trim()}`;
    })
    .join("\n\n");

  return `${copy.conversationExportTitle}
${copy.conversationExportSavedLabel}: ${exportedAt}
${copy.conversationExportStartedFromLabel}: ${entryLabel}
${copy.conversationExportLanguageLabel}: ${languageLabel}

${body}
`;
}

function makeExportFilename(entryId: ConversationEntryId) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");

  return `access-tool-${entryId}-${timestamp}.txt`;
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

export function ConversationClient({
  currentLanguageCode,
  currentLanguageLabel,
  entryId,
  initialAssistantMessage,
  initialSuggestions,
  regionScope,
}: ConversationClientProps) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const copy = getUiCopy(currentLanguageCode);
  const hasTranslatedCopy = hasTranslatedUiCopy(currentLanguageCode);
  const threadRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const languageSheetDoneRef = useRef<HTMLButtonElement | null>(null);
  const languageSheetRef = useRef<HTMLDivElement | null>(null);
  const languageSheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const saveCancelRef = useRef<HTMLButtonElement | null>(null);
  const saveDialogRef = useRef<HTMLDivElement | null>(null);
  const saveDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceSettingsDoneRef = useRef<HTMLButtonElement | null>(null);
  const voiceSettingsRef = useRef<HTMLDivElement | null>(null);
  const voiceSettingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const dictationBaseDraftRef = useRef("");
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
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [micSupported, setMicSupported] = useState<boolean | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState("");
  const [speechRate, setSpeechRate] = useState(0.92);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [showLanguageSheet, setShowLanguageSheet] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [hasSeenSaveWarning, setHasSeenSaveWarning] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [shareSupported, setShareSupported] = useState(false);
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const conversationHref = buildConversationHref({
    entryId,
    languageCode: currentLanguageCode,
  });
  const hasOpenSheet = showLanguageSheet || showSaveModal || showVoiceSettings;

  useEffect(() => {
    if (!showLanguageSheet && !showSaveModal && !showVoiceSettings) {
      return;
    }

    function getOpenDialog() {
      if (showSaveModal) {
        return saveDialogRef.current;
      }

      if (showVoiceSettings) {
        return voiceSettingsRef.current;
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

      setShowLanguageSheet(false);
    }

    window.addEventListener("keydown", handleSheetKeydown);

    return () => {
      window.removeEventListener("keydown", handleSheetKeydown);
    };
  }, [showLanguageSheet, showSaveModal, showVoiceSettings]);

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
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    if (messages.length === 1 && showSuggestions && !isStreaming && !errorMessage) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [messages, errorMessage, isStreaming, showSuggestions]);

  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }, [draft]);

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
      if (!("speechSynthesis" in window)) {
        return;
      }

      window.speechSynthesis.cancel();

      if (loadVoices) {
        window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      }

      utteranceRef.current = null;
      setSpeakingMessageId(null);
    };
  }, []);
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
      size: "invisible",
      theme: "light",
      callback: (token) => {
        setTurnstileToken(token);
      },
      "error-callback": () => {
        setTurnstileToken(null);
      },
      "expired-callback": () => {
        setTurnstileToken(null);
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
    };
  }, [turnstileScriptReady, turnstileSiteKey]);

  const voiceLanguage = getSpeechLocaleForLanguageCode(currentLanguageCode);
  const voiceOptions = getVoiceOptions(availableVoices, voiceLanguage);
  const effectiveVoiceUri =
    selectedVoiceUri ||
    chooseBestVoice(voiceOptions, voiceLanguage)?.voiceURI ||
    "";
  const selectedVoiceName =
    voiceOptions.find((voice) => voice.voiceURI === effectiveVoiceUri)?.name ??
    copy.voiceDefaultOption;
  const speechUnavailable = speechSupported === false;
  const micUnavailable = micSupported === false;
  const exportEntryLabel = getConversationContentEntry(entryId, currentLanguageCode).label;

  function resetTurnstileToken() {
    setTurnstileToken(null);

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

  function markSaveWarningSeen() {
    if (typeof window === "undefined") {
      return;
    }

    writeLocalStorage("access-tool-save-warning-seen", "true");
    setHasSeenSaveWarning(true);
  }

  function downloadConversation() {
    if (typeof window === "undefined") {
      return;
    }

    const fileContents = formatConversationForExport(messages, {
      copy,
      entryLabel: exportEntryLabel,
      languageLabel: currentLanguageLabel,
    });
    const blob = new Blob([fileContents], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = makeExportFilename(entryId);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function emailConversationToSelf() {
    if (typeof window === "undefined") {
      return;
    }

    const subject = encodeURIComponent(copy.conversationExportTitle);
    const body = encodeURIComponent(
      formatConversationForExport(messages, {
        copy,
        entryLabel: exportEntryLabel,
        languageLabel: currentLanguageLabel,
      }),
    );

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function handleSavePress() {
    setSaveStatusMessage(null);

    if (hasSeenSaveWarning) {
      downloadConversation();
      return;
    }

    setShowSaveModal(true);
  }

  function handleSaveHere() {
    markSaveWarningSeen();
    setSaveStatusMessage(null);
    setShowSaveModal(false);
    downloadConversation();
  }

  function handleEmailToSelf() {
    markSaveWarningSeen();
    setSaveStatusMessage(null);
    setShowSaveModal(false);
    emailConversationToSelf();
  }

  async function handleShareConversation() {
    if (typeof window === "undefined" || typeof navigator.share !== "function") {
      setSaveStatusMessage(copy.saveShareFailed);
      return;
    }

    try {
      await navigator.share({
        title: copy.conversationExportTitle,
        text: formatConversationForExport(messages, {
          copy,
          entryLabel: exportEntryLabel,
          languageLabel: currentLanguageLabel,
        }),
      });
      setSaveStatusMessage(null);
    } catch {
      setSaveStatusMessage(copy.saveShareFailed);
    }
  }

  async function handleCopyConversation() {
    const exportText = formatConversationForExport(messages, {
      copy,
      entryLabel: exportEntryLabel,
      languageLabel: currentLanguageLabel,
    });

    setSaveStatusMessage(
      await copyTextToClipboard(exportText) ? copy.saveCopied : copy.saveCopyFailed,
    );
  }

  function handlePlayAloud(messageId: string, text: string) {
    if (
      !speechSupported ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    if (speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const language = voiceLanguage;

    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
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

  function sendMessage(text: string) {
    const trimmed = text.trim();

    if (!trimmed || isStreaming) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    if (turnstileSiteKey && !turnstileToken) {
      setErrorMessage(copy.turnstileWait);
      return;
    }

    const nextUserMessage: ClientChatMessage = {
      id: makeMessageId("user"),
      role: "user",
      text: trimmed,
    };
    const pendingAssistantId = makeMessageId("assistant");
    const pendingAssistantMessage: ClientChatMessage = {
      id: pendingAssistantId,
      role: "assistant",
      text: "",
      weakCategory: "none",
    };
    const nextMessages = [...messages, nextUserMessage];

    setMessages([...nextMessages, pendingAssistantMessage]);
    setDraft("");
    setErrorMessage(null);
    setShowSuggestions(false);
    setIsStreaming(true);

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
            messages: nextMessages,
            turnstileToken: turnstileSiteKey ? turnstileToken : undefined,
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
            setMessages(nextMessages);
            setErrorMessage(
              errorBody?.error ?? copy.sendFailure,
            );
          }
          return;
        }

        const reader = response.body?.getReader();

        if (!reader) {
          setMessages(nextMessages);
          setErrorMessage(copy.sendFailure);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

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
              setIsStreaming(false);
              return;
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

              setErrorMessage(event.error);
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
            }
          }

          if (done) {
            break;
          }
        }
      } catch {
        setMessages((currentMessages) =>
          currentMessages.filter((message) => message.id !== pendingAssistantId || message.text.length > 0),
        );
        setErrorMessage(copy.sendFailure);
      } finally {
        resetTurnstileToken();
        setIsStreaming(false);
      }
    })();
  }

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
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
        className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-4 pt-3"
      >
        <header className="flex items-center justify-between pb-3">
          <Link
            href={buildHomeHref(currentLanguageCode)}
            aria-label={copy.backLabel}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
          >
            <span aria-hidden="true">{"<"}</span>
          </Link>

          <button
            type="button"
            aria-label={copy.chooseLanguageLabel}
            aria-controls={languageSheetDialogId}
            aria-expanded={showLanguageSheet}
            aria-haspopup="dialog"
            onClick={() => setShowLanguageSheet(true)}
            className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-3 text-[15px] font-medium text-[#314036]"
          >
            {currentLanguageLabel}
          </button>
        </header>

        <section
          ref={threadRef}
          aria-busy={isStreaming}
          aria-live="polite"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4"
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

              return (
                <div
                  key={message.id}
                  className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                >
                  <div className="min-w-0 max-w-[88%]">
                    <article
                      className={`break-words px-4 py-3 text-[18px] leading-7 shadow-[0_1px_0_rgba(29,42,34,0.08)] ${
                        isAssistant
                          ? "rounded-[18px] rounded-bl-[6px] bg-white text-[#1f2923]"
                          : "rounded-[18px] rounded-br-[6px] bg-[#1f5f43] text-white"
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
                        message.text
                      )}
                    </article>

                    {isAssistant && !isEmptyAssistant ? (
                      <div className="mt-3 space-y-3">
                        {weakCategory ? (
                          <Link
                            href={buildFindHumanHref({
                              category: weakCategory,
                              entryId,
                              languageCode: currentLanguageCode,
                            })}
                            className="block rounded-[16px] border border-[#ead8b7] bg-[#fff9ef] px-4 py-3 text-[14px] leading-6 text-[#6a4c12]"
                          >
                            <span className="font-semibold">{copy.weakCategoryLead}</span>{" "}
                            {copy.weakCategoryTail}{" "}
                            <span className="font-semibold">
                              {getWeakCategoryLabel(weakCategory)}
                            </span>
                            .
                          </Link>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handlePlayAloud(message.id, message.text)}
                          disabled={speechUnavailable}
                          className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22] disabled:opacity-50"
                        >
                          {speakingMessageId === message.id ? copy.stopReading : copy.playAloud}
                        </button>
                        <button
                          type="button"
                          aria-controls={voiceSettingsDialogId}
                          aria-expanded={showVoiceSettings}
                          aria-haspopup="dialog"
                          onClick={() => setShowVoiceSettings(true)}
                          disabled={speechUnavailable}
                          className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22] disabled:opacity-50"
                        >
                          {copy.voiceTitle}
                        </button>
                        <Link
                          href={buildFindHumanHref({
                            category: weakCategory ?? undefined,
                            entryId,
                            languageCode: currentLanguageCode,
                          })}
                          className="flex min-h-10 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                        >
                          {copy.findHumanForThis}
                        </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {showSuggestions ? (
              <div className="flex flex-wrap gap-2">
                {initialSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    className="min-h-12 rounded-[16px] border border-[#d4ddd6] bg-[#fdfefe] px-4 text-left text-[15px] leading-5 text-[#334139]"
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
                aria-hidden="true"
                className="min-h-0 overflow-hidden opacity-0"
              />
            ) : null}
          </div>
        </section>

        <section className="shrink-0 border-t border-[#d4ddd6] py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSavePress}
              className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
            >
              {copy.saveButton}
            </button>
            <button
              type="button"
              aria-label={copy.saveExplainLabel}
              aria-controls={saveDialogId}
              aria-expanded={showSaveModal}
              aria-haspopup="dialog"
              onClick={() => setShowSaveModal(true)}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#b7c7bd] bg-white px-3 text-[15px] font-semibold text-[#1d2a22]"
            >
              {copy.saveExplainButton}
            </button>
          </div>

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(draft);
            }}
          >
            <label className="flex-1" htmlFor="conversation-input">
              <span className="sr-only">{copy.composerAssistiveLabel}</span>
              <textarea
                ref={composerRef}
                id="conversation-input"
                autoFocus
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={maxClientMessageTextLength}
                placeholder={copy.composerPlaceholder}
                className="max-h-40 min-h-14 w-full resize-none overflow-y-auto rounded-[18px] border border-[#b7c7bd] bg-white px-4 py-[15px] text-[17px] leading-6 text-[#1f2923] outline-none placeholder:text-[#7c8a82]"
              />
            </label>
            <button
              type="button"
              aria-label={copy.micAssistiveLabel}
              onClick={handleMicInput}
              disabled={micUnavailable}
              className="flex min-h-14 min-w-14 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white text-[20px] text-[#1d2a22]"
            >
              {isListening ? copy.micStopLabel : copy.micLabel}
            </button>
            <button
              type="submit"
              aria-label={copy.sendAssistiveLabel}
              disabled={isStreaming || draft.trim().length === 0}
              className="flex min-h-14 min-w-14 items-center justify-center rounded-[18px] bg-[#1f5f43] text-[20px] font-semibold text-white disabled:opacity-60"
            >
              ^
            </button>
          </form>
        </section>
      </div>

      {showVoiceSettings ? (
        <div className="absolute inset-0 z-20 flex items-end bg-[rgba(18,24,20,0.24)]">
          <div
            id={voiceSettingsDialogId}
            ref={voiceSettingsRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={voiceSettingsTitleId}
            aria-describedby={voiceSettingsDescriptionId}
            tabIndex={-1}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 id={voiceSettingsTitleId} className="text-[18px] font-semibold text-[#1f2923]">{copy.voiceTitle}</h2>
                <p id={voiceSettingsDescriptionId} className="text-[14px] text-[#5f6d64]">{selectedVoiceName}</p>
              </div>
              <button
                ref={voiceSettingsDoneRef}
                type="button"
                onClick={() => setShowVoiceSettings(false)}
                className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                {copy.voiceDone}
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-[15px] font-medium text-[#1f2923]">{copy.voiceOptionLabel}</span>
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

              {voiceOptions.length <= 1 ? (
                <p className="text-[14px] leading-6 text-[#5f6d64]">
                  {copy.voiceOnlyOneOption}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showLanguageSheet ? (
        <div className="absolute inset-0 z-20 flex items-end bg-[rgba(18,24,20,0.24)]">
          <div
            id={languageSheetDialogId}
            ref={languageSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={languageSheetTitleId}
            aria-describedby={languageSheetDescriptionId}
            tabIndex={-1}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)]"
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
                className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
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

      {showSaveModal ? (
        <div className="absolute inset-0 z-20 flex items-end bg-[rgba(18,24,20,0.24)]">
          <div
            id={saveDialogId}
            ref={saveDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={saveDialogTitleId}
            aria-describedby={saveDialogDescriptionId}
            tabIndex={-1}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <h2 id={saveDialogTitleId} className="text-[20px] font-semibold text-[#1f2923]">
              {copy.saveTitle}
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
                onClick={handleSaveHere}
                className="min-h-12 rounded-[16px] bg-[#1f5f43] px-4 text-[16px] font-semibold text-white"
              >
                {copy.saveHere}
              </button>
              {shareSupported ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleShareConversation();
                  }}
                  className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
                >
                  {copy.saveShare}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void handleCopyConversation();
                }}
                className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
              >
                {copy.saveCopy}
              </button>
              <button
                type="button"
                onClick={handleEmailToSelf}
                className="min-h-12 rounded-[16px] border border-[#b7c7bd] bg-white px-4 text-[16px] font-semibold text-[#1d2a22]"
              >
                {copy.saveEmail}
              </button>
              {saveStatusMessage ? (
                <p role="status" className="px-1 text-[14px] leading-6 text-[#47564d]">
                  {saveStatusMessage}
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
          entryId={entryId}
          languageCode={currentLanguageCode}
          regionScope={regionScope}
          sourcePath={conversationHref}
        />
      </div>
    </main>
  );
}
