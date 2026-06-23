"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ConversationEntryId } from "../lib/chat-types";
import type { SupportedLanguageCode } from "../lib/languages";

export type TrackedUsageEventType =
  | "chat_submit_click"
  | "prompt_button_click";

export function trackUsageEvent({
  entryId,
  eventType,
  language,
}: {
  entryId: ConversationEntryId;
  eventType: TrackedUsageEventType;
  language: SupportedLanguageCode;
}) {
  const body = JSON.stringify({
    entryId,
    eventType,
    language,
  });

  try {
    const blob = new Blob([body], { type: "application/json" });

    if (navigator.sendBeacon?.("/api/usage/event", blob)) {
      return;
    }
  } catch {
    // Ignore local browser limitations; the navigation should continue.
  }

  void fetch("/api/usage/event", {
    body,
    headers: {
      "Content-Type": "application/json",
    },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

export function TrackedConversationLink({
  children,
  className,
  entryId,
  href,
  languageCode,
}: {
  children: ReactNode;
  className: string;
  entryId: ConversationEntryId;
  href: string;
  languageCode: SupportedLanguageCode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() =>
        trackUsageEvent({
          entryId,
          eventType: "prompt_button_click",
          language: languageCode,
        })
      }
    >
      {children}
    </Link>
  );
}
