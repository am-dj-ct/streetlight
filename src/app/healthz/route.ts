import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
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
