import { extractHtmlLang, fetchHtmlPage } from "./access-tool-http.mjs";

export async function getLanguagePersistenceSnapshot({
  baseUrl,
  fail,
  requestedLanguageCode = "es",
}) {
  const { html: homeHtml, response: languageResponse } = await fetchHtmlPage({
    baseUrl,
    fail,
    path: `/?lang=${requestedLanguageCode}`,
  });
  const languageCookie = languageResponse.headers
    .get("set-cookie")
    ?.split(";")[0]
    ?.trim();
  const homeContentLanguage = languageResponse.headers.get("content-language");
  const { html: privacyHtml, response: persistedResponse } = await fetchHtmlPage({
    baseUrl,
    fail,
    headers: languageCookie ? { Cookie: languageCookie } : {},
    path: "/privacy",
  });
  const privacyContentLanguage = persistedResponse.headers.get("content-language");

  return {
    homeContentLanguage,
    homeHtml,
    homeLang: extractHtmlLang(homeHtml),
    languageCookie,
    privacyContentLanguage,
    privacyHtml,
    privacyLang: extractHtmlLang(privacyHtml),
  };
}
