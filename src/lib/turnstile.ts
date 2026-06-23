import { getTurnstileSecretKey, hasTurnstileSecret } from "./env";
import { getClientIp } from "./rate-limit";

type TurnstileValidationResult =
  | {
      allowed: true;
      reason: "allowed" | "disabled";
    }
  | {
      allowed: false;
      reason: "invalid" | "unavailable";
    };

type TurnstileSiteverifyResponse = {
  success: boolean;
};

function isTurnstileSiteverifyResponse(
  value: unknown,
): value is TurnstileSiteverifyResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TurnstileSiteverifyResponse>;
  return typeof candidate.success === "boolean";
}

export async function validateTurnstileToken({
  request,
  token,
}: {
  request: Request;
  token: null | string | undefined;
}): Promise<TurnstileValidationResult> {
  if (!hasTurnstileSecret()) {
    return {
      allowed: true,
      reason: "disabled",
    };
  }

  if (!token) {
    return {
      allowed: false,
      reason: "invalid",
    };
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: getTurnstileSecretKey(),
        response: token,
        remoteip: getClientIp(request) ?? undefined,
      }),
    },
  ).catch(() => null);

  if (!response?.ok) {
    return {
      allowed: false,
      reason: "unavailable",
    };
  }

  const rawData = await response.json().catch(() => null);
  const data = isTurnstileSiteverifyResponse(rawData) ? rawData : null;

  if (data?.success) {
    return {
      allowed: true,
      reason: "allowed",
    };
  }

  if (!data) {
    return {
      allowed: false,
      reason: "unavailable",
    };
  }

  return {
    allowed: false,
    reason: "invalid",
  };
}
