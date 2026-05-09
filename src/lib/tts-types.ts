import { isSupportedLanguageCode, type SupportedLanguageCode } from "./languages";
import { isAzureVoiceNameForLanguage } from "./azure-tts";

export const maxTtsTextLength = 4000;
export const maxTtsRequestBodyBytes = 12000;

export type TtsRequestBody = {
  language: SupportedLanguageCode;
  text: string;
  voiceName?: string;
};

export type TtsErrorBody = {
  error: string;
};

export function isTtsRequestBody(value: unknown): value is TtsRequestBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TtsRequestBody>;
  const hasValidVoiceName =
    candidate.voiceName === undefined ||
    (typeof candidate.voiceName === "string" &&
      isSupportedLanguageCode(candidate.language) &&
      isAzureVoiceNameForLanguage(candidate.language, candidate.voiceName));

  return (
    isSupportedLanguageCode(candidate.language) &&
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    candidate.text.length <= maxTtsTextLength &&
    hasValidVoiceName
  );
}

export function isTtsErrorBody(value: unknown): value is TtsErrorBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TtsErrorBody>;

  return typeof candidate.error === "string";
}
