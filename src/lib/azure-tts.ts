import type { SupportedLanguageCode } from "./languages";
import { getSpeechLocaleForLanguageCode } from "./languages";

const azureVoiceByLanguage: Record<SupportedLanguageCode, string> = {
  am: "am-ET-MekdesNeural",
  en: "en-US-JennyNeural",
  es: "es-US-PalomaNeural",
  ru: "ru-RU-SvetlanaNeural",
  so: "so-SO-UbaxNeural",
  vi: "vi-VN-HoaiMyNeural",
  zh: "zh-CN-XiaoxiaoNeural",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getAzureVoiceName(languageCode: SupportedLanguageCode): string {
  return azureVoiceByLanguage[languageCode];
}

export function getAzureTtsEndpoint(region: string): string {
  const normalizedRegion = region.trim().toLowerCase();

  return `https://${normalizedRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export function buildAzureSsml({
  languageCode,
  text,
}: {
  languageCode: SupportedLanguageCode;
  text: string;
}): string {
  const locale = getSpeechLocaleForLanguageCode(languageCode);
  const voiceName = getAzureVoiceName(languageCode);

  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`,
    `<voice name="${voiceName}">`,
    escapeXml(text),
    "</voice>",
    "</speak>",
  ].join("");
}
