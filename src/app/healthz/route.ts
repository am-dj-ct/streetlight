import { NextResponse } from "next/server";
import { getRuntimeState } from "../../lib/runtime-state";

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed." },
    {
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
      status: 405,
    },
  );
}

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

export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
