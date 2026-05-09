import { isSupportedLanguageCode, type SupportedLanguageCode } from "./languages";

export const maxTtsTextLength = 4000;
export const maxTtsRequestBodyBytes = 12000;

export type TtsRequestBody = {
  language: SupportedLanguageCode;
  text: string;
};

export type TtsErrorBody = {
  error: string;
};

export function isTtsRequestBody(value: unknown): value is TtsRequestBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TtsRequestBody>;

  return (
    isSupportedLanguageCode(candidate.language) &&
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    candidate.text.length <= maxTtsTextLength
  );
}

export function isTtsErrorBody(value: unknown): value is TtsErrorBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TtsErrorBody>;

  return typeof candidate.error === "string";
}
