import type { SupportedLanguageCode } from "./languages";
import { getSpeechLocaleForLanguageCode } from "./languages";

export type AzureVoiceOption = {
  label: string;
  locale: string;
  name: string;
};

const azureVoiceOptionsByLanguage: Record<SupportedLanguageCode, AzureVoiceOption[]> = {
  am: [
    { label: "Mekdes", locale: "am-ET", name: "am-ET-MekdesNeural" },
    { label: "Ameha", locale: "am-ET", name: "am-ET-AmehaNeural" },
  ],
  en: [
    { label: "Bella (British woman)", locale: "en-GB", name: "en-GB-BellaNeural" },
    { label: "Hollie (British woman)", locale: "en-GB", name: "en-GB-HollieNeural" },
    { label: "Abbi (British woman)", locale: "en-GB", name: "en-GB-AbbiNeural" },
    { label: "Libby (British woman)", locale: "en-GB", name: "en-GB-LibbyNeural" },
    { label: "Olivia (British woman)", locale: "en-GB", name: "en-GB-OliviaNeural" },
    { label: "Sonia (British woman)", locale: "en-GB", name: "en-GB-SoniaNeural" },
    { label: "Ryan (British man)", locale: "en-GB", name: "en-GB-RyanNeural" },
    { label: "Jenny (US woman)", locale: "en-US", name: "en-US-JennyNeural" },
  ],
  es: [
    { label: "Paloma", locale: "es-US", name: "es-US-PalomaNeural" },
    { label: "Alonso", locale: "es-US", name: "es-US-AlonsoNeural" },
  ],
  ru: [
    { label: "Svetlana", locale: "ru-RU", name: "ru-RU-SvetlanaNeural" },
    { label: "Dariya", locale: "ru-RU", name: "ru-RU-DariyaNeural" },
    { label: "Dmitry", locale: "ru-RU", name: "ru-RU-DmitryNeural" },
  ],
  so: [
    { label: "Ubax", locale: "so-SO", name: "so-SO-UbaxNeural" },
    { label: "Muuse", locale: "so-SO", name: "so-SO-MuuseNeural" },
  ],
  vi: [
    { label: "Hoai My", locale: "vi-VN", name: "vi-VN-HoaiMyNeural" },
    { label: "Nam Minh", locale: "vi-VN", name: "vi-VN-NamMinhNeural" },
  ],
  zh: [
    { label: "Xiaoxiao", locale: "zh-CN", name: "zh-CN-XiaoxiaoNeural" },
    { label: "Yunxi", locale: "zh-CN", name: "zh-CN-YunxiNeural" },
    { label: "Xiaoyi", locale: "zh-CN", name: "zh-CN-XiaoyiNeural" },
  ],
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getAzureVoiceOptions(
  languageCode: SupportedLanguageCode,
): AzureVoiceOption[] {
  return azureVoiceOptionsByLanguage[languageCode];
}

export function getAzureVoiceOption(
  languageCode: SupportedLanguageCode,
  voiceName?: null | string,
): AzureVoiceOption {
  const voiceOptions = getAzureVoiceOptions(languageCode);

  return (
    voiceOptions.find((voiceOption) => voiceOption.name === voiceName) ??
    voiceOptions[0]
  );
}

export function getAzureVoiceName(
  languageCode: SupportedLanguageCode,
  voiceName?: null | string,
): string {
  return getAzureVoiceOption(languageCode, voiceName).name;
}

export function isAzureVoiceNameForLanguage(
  languageCode: SupportedLanguageCode,
  voiceName: string,
): boolean {
  return getAzureVoiceOptions(languageCode).some(
    (voiceOption) => voiceOption.name === voiceName,
  );
}

export function getAzureTtsEndpoint(region: string): string {
  const normalizedRegion = region.trim().toLowerCase();

  return `https://${normalizedRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export function buildAzureSsml({
  languageCode,
  text,
  voiceName,
}: {
  languageCode: SupportedLanguageCode;
  text: string;
  voiceName?: null | string;
}): string {
  const voiceOption = getAzureVoiceOption(languageCode, voiceName);
  const locale = voiceOption.locale || getSpeechLocaleForLanguageCode(languageCode);

  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`,
    `<voice name="${voiceOption.name}">`,
    escapeXml(text),
    "</voice>",
    "</speak>",
  ].join("");
}
