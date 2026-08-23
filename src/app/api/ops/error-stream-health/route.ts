import { NextResponse } from "next/server";
import {
  isOpsRequestAuthorized,
  opsUnauthorizedResponse,
} from "../../../../lib/ops-auth";
import { getErrorStreamHealthSummary } from "../../../../lib/usage-metrics";

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

export async function GET(request: Request) {
  if (!isOpsRequestAuthorized(request)) {
    return opsUnauthorizedResponse();
  }

  try {
    return NextResponse.json(await getErrorStreamHealthSummary(), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Health signal unavailable." },
      {
        headers: { "Cache-Control": "no-store" },
        status: 503,
      },
    );
  }
}

export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
