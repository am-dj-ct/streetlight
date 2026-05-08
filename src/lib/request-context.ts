import { getRequestRegionScope, type RegionScope } from "./geo";
import {
  getLanguageOption,
  getRequestLanguageCode,
  type LanguageOption,
  type SupportedLanguageCode,
} from "./languages";
import { getUiCopy, hasTranslatedUiCopy, type UiCopy } from "./ui-copy";

type RequestHeadersLike = {
  get(name: string): null | string;
};

export type LanguageRequestContext = {
  copy: UiCopy;
  currentLanguage: LanguageOption;
  hasTranslatedCopy: boolean;
  languageCode: SupportedLanguageCode;
};

export type PageRequestContext = LanguageRequestContext & {
  regionScope: RegionScope;
};

export function getLanguageRequestContext({
  requestHeaders,
  requestedLanguageCode,
}: {
  requestHeaders: RequestHeadersLike;
  requestedLanguageCode?: null | string;
}): LanguageRequestContext {
  const languageCode = getRequestLanguageCode({
    requestHeaders,
    requestedLanguageCode,
  });

  return {
    copy: getUiCopy(languageCode),
    currentLanguage: getLanguageOption(languageCode),
    hasTranslatedCopy: hasTranslatedUiCopy(languageCode),
    languageCode,
  };
}

export function getPageRequestContext({
  requestHeaders,
  requestedLanguageCode,
}: {
  requestHeaders: RequestHeadersLike;
  requestedLanguageCode?: null | string;
}): PageRequestContext {
  const languageContext = getLanguageRequestContext({
    requestHeaders,
    requestedLanguageCode,
  });

  return {
    ...languageContext,
    regionScope: getRequestRegionScope({ requestHeaders }),
  };
}
