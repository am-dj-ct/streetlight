import { NextResponse } from "next/server";
import { getRuntimeState } from "../../lib/runtime-state";

export function GET() {
  return NextResponse.json(
    getRuntimeState(),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
