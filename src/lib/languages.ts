export type SupportedLanguageCode =
  | "en"
  | "es"
  | "vi"
  | "so"
  | "ru"
  | "am"
  | "zh";

export type LanguageOption = {
  code: SupportedLanguageCode;
  label: string;
};

export const defaultLanguageCode: SupportedLanguageCode = "en";

export const languageOptions: readonly LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "so", label: "Soomaali" },
  { code: "ru", label: "Русский" },
  { code: "am", label: "አማርኛ" },
  { code: "zh", label: "中文" },
];

export function isSupportedLanguageCode(
  value: null | string | undefined,
): value is SupportedLanguageCode {
  return languageOptions.some((language) => language.code === value);
}

export function getLanguageOption(code: SupportedLanguageCode): LanguageOption {
  return (
    languageOptions.find((language) => language.code === code) ?? languageOptions[0]
  );
}

export function getPreferredLanguageCode({
  acceptLanguageHeader,
  requestedLanguageCode,
}: {
  acceptLanguageHeader?: null | string;
  requestedLanguageCode?: null | string;
}): SupportedLanguageCode {
  if (isSupportedLanguageCode(requestedLanguageCode)) {
    return requestedLanguageCode;
  }

  const headerValues = (acceptLanguageHeader ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);

  for (const value of headerValues) {
    const baseCode = value.split("-")[0];

    if (isSupportedLanguageCode(baseCode)) {
      return baseCode;
    }
  }

  return defaultLanguageCode;
}
