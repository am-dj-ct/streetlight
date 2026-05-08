"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CrisisFooter } from "./crisis-footer";
import type { ClientChatMessage, ConversationEntryId, ChatResponseBody } from "../lib/chat-types";

type ConversationClientProps = {
  currentLanguageLabel: string;
  entryId: ConversationEntryId;
  initialAssistantMessage: string;
  initialSuggestions: readonly string[];
};

function makeMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function ConversationClient({
  currentLanguageLabel,
  entryId,
  initialAssistantMessage,
  initialSuggestions,
}: ConversationClientProps) {
  const threadRef = useRef<HTMLElement | null>(null);
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
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [messages, errorMessage, isPending]);

  function sendMessage(text: string) {
    const trimmed = text.trim();

    if (!trimmed || isPending) {
      return;
    }

    const nextUserMessage: ClientChatMessage = {
      id: makeMessageId("user"),
      role: "user",
      text: trimmed,
    };
    const nextMessages = [...messages, nextUserMessage];

    setMessages(nextMessages);
    setDraft("");
    setErrorMessage(null);
    setShowSuggestions(false);

    startTransition(async () => {
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
          const errorBody = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;

          setErrorMessage(
            errorBody?.error ?? "The response did not come through. Please try again.",
          );
          return;
        }

        const data = (await response.json()) as ChatResponseBody;

        setMessages((currentMessages) => [...currentMessages, data.message]);
      } catch {
        setErrorMessage("The response did not come through. Please try again.");
      }
    });
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

              return (
                <div
                  key={message.id}
                  className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                >
                  <article
                    className={`max-w-[88%] px-4 py-3 text-[18px] leading-7 shadow-[0_1px_0_rgba(29,42,34,0.08)] ${
                      isAssistant
                        ? "rounded-[18px] rounded-bl-[6px] bg-white text-[#1f2923]"
                        : "rounded-[18px] rounded-br-[6px] bg-[#1f5f43] text-white"
                    }`}
                  >
                    {isAssistant ? (
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
                </div>
              );
            })}

            {isPending ? (
              <div className="flex justify-start">
                <article className="max-w-[88%] rounded-[18px] rounded-bl-[6px] bg-white px-4 py-3 text-[18px] leading-7 text-[#65736b] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
                  Thinking...
                </article>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                Play aloud
              </button>
              <Link
                href="#crisis-resources"
                className="flex min-h-10 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                Find a human for this
              </Link>
            </div>

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
              <input
                id="conversation-input"
                type="text"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type here"
                className="min-h-14 w-full rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] text-[#1f2923] outline-none placeholder:text-[#7c8a82]"
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
              disabled={isPending || draft.trim().length === 0}
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
