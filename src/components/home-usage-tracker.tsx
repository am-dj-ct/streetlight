"use client";

import { useEffect } from "react";
import type { SupportedLanguageCode } from "../lib/languages";
import { trackUsageEvent } from "./tracked-conversation-link";

export function HomeUsageTracker({
  languageCode,
}: {
  languageCode: SupportedLanguageCode;
}) {
  useEffect(() => {
    trackUsageEvent({
      eventType: "homepage_view",
      language: languageCode,
    });
  }, [languageCode]);

  return null;
}
