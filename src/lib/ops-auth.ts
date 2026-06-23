import { timingSafeEqual } from "node:crypto";
import { getOpsReadToken, hasOpsReadToken } from "./env";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
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

export function isOpsRequestAuthorized(request: Request): boolean {
  if (!hasOpsReadToken()) {
    return false;
  }

  const expectedToken = getOpsReadToken();
  const authorization = request.headers.get("authorization");
  const candidate =
    getBearerToken(authorization) ?? getBasicPassword(authorization);

  return Boolean(candidate && safeEqual(candidate, expectedToken));
}

export function opsUnauthorizedResponse() {
  return new Response("Unauthorized", {
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Streetlight usage", charset="UTF-8"',
    },
    status: 401,
  });
}
