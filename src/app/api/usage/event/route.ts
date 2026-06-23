import { NextResponse } from "next/server";
import {
  isConversationEntryId,
  type ConversationEntryId,
} from "../../../../lib/chat-types";
import {
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from "../../../../lib/languages";
import { getHashedIp } from "../../../../lib/rate-limit";
import {
  recordFunnelClickUsage,
  type FunnelClickEventType,
} from "../../../../lib/usage-metrics";

type UsageEventBody = {
  entryId: ConversationEntryId;
  eventType: FunnelClickEventType;
  language: SupportedLanguageCode;
};

function isFunnelClickEventType(
  value: null | string | undefined,
): value is FunnelClickEventType {
  return value === "chat_submit_click" || value === "prompt_button_click";
}

function isUsageEventBody(value: unknown): value is UsageEventBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UsageEventBody>;

  return (
    isFunnelClickEventType(candidate.eventType) &&
    isConversationEntryId(candidate.entryId) &&
    isSupportedLanguageCode(candidate.language)
  );
}

function noStoreResponse(status: number) {
  return new NextResponse(null, {
    headers: {
      "Cache-Control": "no-store",
    },
    status,
  });
}

function methodNotAllowed() {
  return new NextResponse(null, {
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
    status: 405,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isUsageEventBody(body)) {
    return noStoreResponse(400);
  }

  await recordFunnelClickUsage({
    entryId: body.entryId,
    eventType: body.eventType,
    hashedIp: getHashedIp(request),
    language: body.language,
  });

  return noStoreResponse(204);
}

export const DELETE = methodNotAllowed;
export const GET = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const PUT = methodNotAllowed;
