"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CrisisFooter } from "./crisis-footer";
import { getWeakCategoryLabel } from "../lib/referrals";
import type {
  ChatErrorBody,
  ChatStreamEvent,
  ClientChatMessage,
  ConversationEntryId,
  WeakCategory,
} from "../lib/chat-types";

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
    turnstile?: TurnstileApi;
  }
}

type ConversationClientProps = {
  currentLanguageLabel: string;
  entryId: ConversationEntryId;
  initialAssistantMessage: string;
  initialSuggestions: readonly string[];
};

function makeMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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

function getSpeechLanguage(label: string): string {
  switch (label) {
    case "Español":
      return "es-US";
    case "Tiếng Việt":
      return "vi-VN";
    case "Soomaali":
      return "so-SO";
    case "Русский":
      return "ru-RU";
    case "አማርኛ":
      return "am-ET";
    case "中文":
      return "zh-CN";
    case "English":
    default:
      return "en-US";
  }
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

export function ConversationClient({
  currentLanguageLabel,
  entryId,
  initialAssistantMessage,
  initialSuggestions,
}: ConversationClientProps) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const threadRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
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
  const [speechSupported] = useState(
    () =>
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window,
  );
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState(
    () =>
      (typeof window !== "undefined" &&
        window.localStorage.getItem("access-tool-voice-uri")) ||
      "",
  );
  const [speechRate, setSpeechRate] = useState(() => {
    if (typeof window === "undefined") {
      return 0.92;
    }

    const savedSpeechRate = Number(
      window.localStorage.getItem("access-tool-speech-rate") ?? "0.92",
    );

    return !Number.isNaN(savedSpeechRate) &&
      savedSpeechRate >= 0.7 &&
      savedSpeechRate <= 1.1
      ? savedSpeechRate
      : 0.92;
  });
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [messages, errorMessage, isStreaming]);

  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedVoiceUri) {
      window.localStorage.setItem("access-tool-voice-uri", selectedVoiceUri);
    }

    window.localStorage.setItem("access-tool-speech-rate", String(speechRate));
  }, [selectedVoiceUri, speechRate]);

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

  const voiceLanguage = getSpeechLanguage(currentLanguageLabel);
  const voiceOptions = getVoiceOptions(availableVoices, voiceLanguage);
  const effectiveVoiceUri =
    selectedVoiceUri ||
    chooseBestVoice(voiceOptions, voiceLanguage)?.voiceURI ||
    "";
  const selectedVoiceName =
    voiceOptions.find((voice) => voice.voiceURI === effectiveVoiceUri)?.name ?? "Default";

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

  function sendMessage(text: string) {
    const trimmed = text.trim();

    if (!trimmed || isStreaming) {
      return;
    }

    if (turnstileSiteKey && !turnstileToken) {
      setErrorMessage("Still checking that you're human. Please try again in a moment.");
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
            language: "en",
            messages: nextMessages,
            turnstileToken: turnstileSiteKey ? turnstileToken : undefined,
          }),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as ChatErrorBody | null;

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
              errorBody?.error ?? "The response did not come through. Please try again.",
            );
          }
          return;
        }

        const reader = response.body?.getReader();

        if (!reader) {
          setMessages(nextMessages);
          setErrorMessage("The response did not come through. Please try again.");
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

            const event = JSON.parse(payload) as ChatStreamEvent;

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
        setErrorMessage("The response did not come through. Please try again.");
      } finally {
        resetTurnstileToken();
        setIsStreaming(false);
      }
    })();
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileScriptReady(true)}
        />
      ) : null}

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-4 pt-3">
        <header className="flex items-center justify-between pb-3">
          <Link
            href="/"
            aria-label="Go back"
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
          >
            <span aria-hidden="true">{"<"}</span>
          </Link>

          <button
            type="button"
            className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-3 text-[15px] font-medium text-[#314036]"
          >
            {currentLanguageLabel}
          </button>
        </header>

        <section ref={threadRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="flex flex-col gap-5">
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
                  <div className="max-w-[88%]">
                    <article
                      className={`px-4 py-3 text-[18px] leading-7 shadow-[0_1px_0_rgba(29,42,34,0.08)] ${
                        isAssistant
                          ? "rounded-[18px] rounded-bl-[6px] bg-white text-[#1f2923]"
                          : "rounded-[18px] rounded-br-[6px] bg-[#1f5f43] text-white"
                      }`}
                    >
                      {isEmptyAssistant ? (
                        <p className="text-[#65736b]">Thinking...</p>
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
                            href={`/find-human?category=${weakCategory}&entryId=${entryId}`}
                            className="block rounded-[16px] border border-[#ead8b7] bg-[#fff9ef] px-4 py-3 text-[14px] leading-6 text-[#6a4c12]"
                          >
                            <span className="font-semibold">AI sometimes gets this wrong.</span>{" "}
                            Worth verifying with a person who does{" "}
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
                          disabled={!speechSupported}
                          className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22] disabled:opacity-50"
                        >
                          {speakingMessageId === message.id ? "Stop reading" : "Play aloud"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowVoiceSettings(true)}
                          disabled={!speechSupported}
                          className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22] disabled:opacity-50"
                        >
                          Voice
                        </button>
                        <Link
                          href={
                            weakCategory
                              ? `/find-human?category=${weakCategory}&entryId=${entryId}`
                              : `/find-human?entryId=${entryId}`
                          }
                          className="flex min-h-10 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                        >
                          Find a human for this
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
              <p className="text-[15px] leading-6 text-[#9a3f2f]">{errorMessage}</p>
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
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(draft);
            }}
          >
            <label className="flex-1" htmlFor="conversation-input">
              <span className="sr-only">Type a message</span>
              <textarea
                ref={composerRef}
                id="conversation-input"
                autoFocus
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type here"
                className="max-h-40 min-h-14 w-full resize-none overflow-y-auto rounded-[18px] border border-[#b7c7bd] bg-white px-4 py-[15px] text-[17px] leading-6 text-[#1f2923] outline-none placeholder:text-[#7c8a82]"
              />
            </label>
            <button
              type="button"
              aria-label="Use microphone"
              className="flex min-h-14 min-w-14 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white text-[20px] text-[#1d2a22]"
            >
              Mic
            </button>
            <button
              type="submit"
              aria-label="Send message"
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
          <div className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 shadow-[0_-12px_32px_rgba(18,24,20,0.18)]">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-[18px] font-semibold text-[#1f2923]">Voice</h2>
                <p className="text-[14px] text-[#5f6d64]">{selectedVoiceName}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowVoiceSettings(false)}
                className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                Done
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-[15px] font-medium text-[#1f2923]">Voice option</span>
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
                  <span>Speed</span>
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
                  This browser is only exposing one voice for this language.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <CrisisFooter entryId={entryId} />
    </main>
  );
}
