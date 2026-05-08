import { extractHtmlLang } from "./access-tool-http.mjs";

export async function getLanguagePersistenceSnapshot({
  baseUrl,
  fail,
  requestedLanguageCode = "es",
}) {
  const languageResponse = await fetch(
    new URL(`/?lang=${requestedLanguageCode}`, baseUrl),
    {
      headers: {
        Accept: "text/html",
      },
    },
  );

  if (!languageResponse.ok) {
    fail(`HTTP ${languageResponse.status} from /?lang=${requestedLanguageCode}.`);
  }

  const languageCookie = languageResponse.headers
    .get("set-cookie")
    ?.split(";")[0]
    ?.trim();
  const homeContentLanguage = languageResponse.headers.get("content-language");
  const homeHtml = await languageResponse.text();

  const persistedResponse = await fetch(new URL("/privacy", baseUrl), {
    headers: {
      Accept: "text/html",
      ...(languageCookie ? { Cookie: languageCookie } : {}),
    },
  });

  if (!persistedResponse.ok) {
    fail(`HTTP ${persistedResponse.status} from /privacy with persisted language cookie.`);
  }

  const privacyContentLanguage = persistedResponse.headers.get("content-language");
  const privacyHtml = await persistedResponse.text();

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
