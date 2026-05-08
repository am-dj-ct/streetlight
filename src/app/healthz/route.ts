import { NextResponse } from "next/server";
import { isDevMockChatEnabled } from "../../lib/env";

export function GET() {
  return NextResponse.json(
    {
      chatMode: isDevMockChatEnabled() ? "mock-local" : "live-model",
      ok: true,
      service: "access-tool",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
