import {
  defaultBaseUrl,
  getHealth,
} from "./lib/access-tool-http.mjs";
import { getLanguagePersistenceSnapshot } from "./lib/language-persistence.mjs";
import {
  getReferralsSnapshot,
  getReportProblemSnapshot,
} from "./lib/page-snapshots.mjs";

const baseUrl = defaultBaseUrl;
const sampleSourcePath = "/conversation/understand-letter-or-form?lang=en";
function fail(message) {
  throw new Error(message);
}

const health = await getHealth({ baseUrl, fail });
const languageSnapshot = await getLanguagePersistenceSnapshot({ baseUrl, fail });
const reportSnapshot = await getReportProblemSnapshot({
  baseUrl,
  fail,
  path: `/report-problem?lang=en&area=conversation&entryId=understand-letter-or-form&source=${encodeURIComponent(sampleSourcePath)}`,
});
const referralsSnapshot = await getReferralsSnapshot({
  baseUrl,
  fail,
  path: "/find-human?entryId=understand-letter-or-form&lang=en",
});
const spanishHomeHtmlLang = languageSnapshot.homeLang;
const persistedLanguageCookie = languageSnapshot.languageCookie;
const persistedPrivacyHtmlLang = languageSnapshot.privacyLang;

console.log("Access Tool local diagnostics");
console.log("");
console.log(`Base URL: ${baseUrl}`);
console.log(`Health chatMode: ${health.chatMode}`);
console.log(`Health deployEnv: ${health.deployEnv}`);
console.log(`Health commitSha: ${health.commitSha ?? "local-dev"}`);
console.log(`Health deployConfigOk: ${health.deployConfigOk === true ? "true" : "false"}`);
console.log("");
console.log("Language snapshot");
console.log(`- /?lang=es html lang: ${spanishHomeHtmlLang ?? "(missing)"}`);
console.log(`- language cookie set: ${persistedLanguageCookie ?? "(missing)"}`);
console.log(`- /privacy with cookie html lang: ${persistedPrivacyHtmlLang ?? "(missing)"}`);
console.log("");
console.log("Report page snapshot");
console.log(`- chat mode: ${reportSnapshot.chatMode ?? "(missing)"}`);
console.log(`- deploy environment: ${reportSnapshot.deployEnv ?? "(missing)"}`);
console.log(`- commit: ${reportSnapshot.commit ?? "(missing)"}`);
console.log(`- resource scope: ${reportSnapshot.resourceScope ?? "(missing)"}`);
console.log(`- source route: ${reportSnapshot.sourceRoute ?? "(missing)"}`);
console.log(`- entry button: ${reportSnapshot.entryButton ?? "(missing)"}`);
console.log("");
console.log("Referrals page snapshot");
console.log(`- checked through: ${referralsSnapshot.checkedThrough ?? "(missing)"}`);
console.log(`- top source: ${referralsSnapshot.topSource ?? "(missing)"}`);
console.log(`- top verified: ${referralsSnapshot.topVerified ?? "(missing)"}`);
