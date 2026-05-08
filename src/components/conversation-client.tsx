"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CrisisFooter } from "./crisis-footer";
import type {
  ChatErrorBody,
  ChatStreamEvent,
  ClientChatMessage,
  ConversationEntryId,
} from "../lib/chat-types";

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
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
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

export function ConversationClient({
  currentLanguageLabel,
  entryId,
  initialAssistantMessage,
  initialSuggestions,
}: ConversationClientProps) {
  const threadRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

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

    return () => {
      if (!("speechSynthesis" in window)) {
        return;
      }

      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setSpeakingMessageId(null);
    };
  }, []);

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

    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
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
          }),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as ChatErrorBody | null;

          setMessages(nextMessages);
          setErrorMessage(
            errorBody?.error ?? "The response did not come through. Please try again.",
          );
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
        setIsStreaming(false);
      }
    })();
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handlePlayAloud(message.id, message.text)}
                          disabled={!speechSupported}
                          className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22] disabled:opacity-50"
                        >
                          {speakingMessageId === message.id ? "Stop reading" : "Play aloud"}
                        </button>
                        <Link
                          href="#crisis-resources"
                          className="flex min-h-10 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                        >
                          Find a human for this
                        </Link>
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

      <CrisisFooter />
    </main>
  );
}
