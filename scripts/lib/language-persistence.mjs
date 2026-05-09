import { extractHtmlLang, fetchHtmlPage } from "./access-tool-http.mjs";

export async function getLanguageRoutingSnapshot({
  baseUrl,
  fail,
  requestedLanguageCode = "es",
}) {
  const { html: homeHtml, response: languageResponse } = await fetchHtmlPage({
    baseUrl,
    fail,
    path: `/?lang=${requestedLanguageCode}`,
  });
  const languageCookie = languageResponse.headers.get("set-cookie");
  const homeContentLanguage = languageResponse.headers.get("content-language");
  const { html: privacyHtml, response: explicitPrivacyResponse } = await fetchHtmlPage({
    baseUrl,
    fail,
    path: `/privacy?lang=${requestedLanguageCode}`,
  });
  const privacyContentLanguage = explicitPrivacyResponse.headers.get("content-language");
  const {
    html: acceptLanguageHtml,
    response: acceptLanguageResponse,
  } = await fetchHtmlPage({
    baseUrl,
    fail,
    headers: {
      "Accept-Language": `${requestedLanguageCode},en;q=0.8`,
    },
    path: "/privacy",
  });

  return {
    acceptLanguageContentLanguage: acceptLanguageResponse.headers.get("content-language"),
    acceptLanguageHtml,
    acceptLanguageLang: extractHtmlLang(acceptLanguageHtml),
    homeContentLanguage,
    homeHtml,
    homeLang: extractHtmlLang(homeHtml),
    languageCookie,
    privacyContentLanguage,
    privacyHtml,
    privacyLang: extractHtmlLang(privacyHtml),
  };
}
