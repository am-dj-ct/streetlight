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
export const languageCookieName = "access_tool_lang";
export const languageHeaderName = "x-access-tool-lang";

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
  storedLanguageCode,
}: {
  acceptLanguageHeader?: null | string;
  requestedLanguageCode?: null | string;
  storedLanguageCode?: null | string;
}): SupportedLanguageCode {
  if (isSupportedLanguageCode(requestedLanguageCode)) {
    return requestedLanguageCode;
  }

  if (isSupportedLanguageCode(storedLanguageCode)) {
    return storedLanguageCode;
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

export function getRequestLanguageCode({
  requestHeaders,
  requestedLanguageCode,
}: {
  requestHeaders: {
    get(name: string): null | string;
  };
  requestedLanguageCode?: null | string;
}): SupportedLanguageCode {
  return getPreferredLanguageCode({
    acceptLanguageHeader: requestHeaders.get("accept-language"),
    requestedLanguageCode,
    storedLanguageCode: requestHeaders.get(languageHeaderName),
  });
}
