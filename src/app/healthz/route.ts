import { NextResponse } from "next/server";
import {
  isDevMockChatEnabled,
  isProductionMockMisconfigured,
} from "../../lib/env";

export function GET() {
  return NextResponse.json(
    {
      chatMode: isDevMockChatEnabled() ? "mock-local" : "live-model",
      deployConfigOk: !isProductionMockMisconfigured(),
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
