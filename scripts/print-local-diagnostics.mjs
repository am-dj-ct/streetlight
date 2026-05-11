import {
  defaultBaseUrl,
  getHealth,
} from "./lib/access-tool-http.mjs";
import { getLanguageRoutingSnapshot } from "./lib/language-persistence.mjs";
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
const languageSnapshot = await getLanguageRoutingSnapshot({ baseUrl, fail });
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
const languageCookieStatus = languageSnapshot.languageCookie ? "unexpected" : "none";
const spanishPrivacyHtmlLang = languageSnapshot.privacyLang;
const acceptLanguagePrivacyHtmlLang = languageSnapshot.acceptLanguageLang;

console.log("Streetlight local diagnostics");
console.log("");
console.log(`Base URL: ${baseUrl}`);
console.log(`Health chatMode: ${health.chatMode}`);
console.log(`Health deployEnv: ${health.deployEnv}`);
console.log(`Health commitSha: ${health.commitSha ?? "local-dev"}`);
console.log(`Health deployConfigOk: ${health.deployConfigOk === true ? "true" : "false"}`);
if (health.abuseControls) {
  console.log(
    `Health abuseControls: turnstileSecret=${health.abuseControls.turnstileSecretConfigured === true ? "true" : "false"}, turnstileSiteKey=${health.abuseControls.turnstileSiteKeyConfigured === true ? "true" : "false"}, kv=${health.abuseControls.kvConfigured === true ? "true" : "false"}, hashedIpSalt=${health.abuseControls.hashedIpSaltConfigured === true ? "true" : "false"}`,
  );
}
console.log("");
console.log("Language snapshot");
console.log(`- /?lang=es html lang: ${spanishHomeHtmlLang ?? "(missing)"}`);
console.log(`- language cookie set: ${languageCookieStatus}`);
console.log(`- /privacy?lang=es html lang: ${spanishPrivacyHtmlLang ?? "(missing)"}`);
console.log(`- /privacy with Accept-Language es html lang: ${acceptLanguagePrivacyHtmlLang ?? "(missing)"}`);
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
