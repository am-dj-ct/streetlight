import { createHmac, timingSafeEqual } from "node:crypto";
import { getOpsReadToken, hasOpsReadToken } from "./env";

const opsSessionCookieName = "streetlight_ops_session";
const opsSessionMaxAgeSeconds = 7 * 24 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getExpectedSessionValue(): string {
  return createHmac("sha256", getOpsReadToken())
    .update("streetlight-ops-session-v1")
    .digest("hex");
}

function getCookieValue(request: Request, name: string): null | string {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function getBearerToken(authorization: null | string): null | string {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

function getBasicPassword(authorization: null | string): null | string {
  const match = authorization?.match(/^Basic\s+(.+)$/i);

  if (!match?.[1]) {
    return null;
  }

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      return null;
    }

    return decoded.slice(separatorIndex + 1);
  } catch {
    return null;
  }
}

export function isOpsPasswordValid(password: null | string): boolean {
  if (!hasOpsReadToken() || !password) {
    return false;
  }

  return safeEqual(password.trim(), getOpsReadToken());
}

function isOpsCookieAuthorized(request: Request): boolean {
  if (!hasOpsReadToken()) {
    return false;
  }

  const cookieValue = getCookieValue(request, opsSessionCookieName);

  return Boolean(cookieValue && safeEqual(cookieValue, getExpectedSessionValue()));
}

export function isOpsRequestAuthorized(request: Request): boolean {
  if (!hasOpsReadToken()) {
    return false;
  }

  const expectedToken = getOpsReadToken();
  const authorization = request.headers.get("authorization");
  const candidate =
    getBearerToken(authorization) ?? getBasicPassword(authorization);

  return Boolean(
    (candidate && safeEqual(candidate, expectedToken)) ||
      isOpsCookieAuthorized(request),
  );
}

export function isAuthenticatedSyntheticUiSentryRequest(
  request: Request,
): boolean {
  return (
    request.headers.get("x-streetlight-synthetic") === "ui-sentry" &&
    isOpsRequestAuthorized(request)
  );
}

export function makeOpsSessionCookie({ secure }: { secure: boolean }): string {
  return [
    `${opsSessionCookieName}=${encodeURIComponent(getExpectedSessionValue())}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opsSessionMaxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearOpsSessionCookie(): string {
  return [
    `${opsSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function opsUnauthorizedResponse() {
  return new Response("Unauthorized", {
    headers: {
      "Cache-Control": "no-store",
    },
    status: 401,
  });
}
