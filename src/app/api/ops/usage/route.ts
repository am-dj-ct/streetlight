import { NextResponse } from "next/server";
import {
  isOpsRequestAuthorized,
  opsUnauthorizedResponse,
} from "../../../../lib/ops-auth";
import { getUsageSummary } from "../../../../lib/usage-metrics";

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

function getDays(request: Request): number {
  const url = new URL(request.url);
  const parsed = Number(url.searchParams.get("days") ?? 1);

  return Number.isFinite(parsed) ? parsed : 1;
}

export async function GET(request: Request) {
  if (!isOpsRequestAuthorized(request)) {
    return opsUnauthorizedResponse();
  }

  return NextResponse.json(await getUsageSummary({ days: getDays(request) }), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
