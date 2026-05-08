const baseUrl = process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";
const healthEndpoint = new URL("/healthz", baseUrl).toString();
const reportEndpoint = new URL("/report-problem?lang=en", baseUrl).toString();

function fail(message) {
  throw new Error(message);
}

function extractValue(html, label) {
  const normalizedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${normalizedLabel}:\\s*<!-- -->\\s*([^<]+)`, "i");
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

const healthResponse = await fetch(healthEndpoint, {
  headers: {
    Accept: "application/json",
  },
});

if (!healthResponse.ok) {
  fail(`HTTP ${healthResponse.status} from /healthz.`);
}

const health = await healthResponse.json().catch(() => null);

if (!health || health.ok !== true || health.service !== "access-tool") {
  fail("Unexpected /healthz response body.");
}

const reportResponse = await fetch(reportEndpoint, {
  headers: {
    Accept: "text/html",
  },
});

if (!reportResponse.ok) {
  fail(`HTTP ${reportResponse.status} from /report-problem.`);
}

const reportHtml = await reportResponse.text();
const reportChatMode = extractValue(reportHtml, "Current chat mode");
const reportDeployEnv = extractValue(reportHtml, "Current deploy environment");
const reportCommit = extractValue(reportHtml, "Current commit");
const reportResourceScope = extractValue(reportHtml, "Current resource scope");

console.log("Access Tool local diagnostics");
console.log("");
console.log(`Base URL: ${baseUrl}`);
console.log(`Health chatMode: ${health.chatMode}`);
console.log(`Health deployEnv: ${health.deployEnv}`);
console.log(`Health commitSha: ${health.commitSha ?? "local-dev"}`);
console.log(`Health deployConfigOk: ${health.deployConfigOk === true ? "true" : "false"}`);
console.log("");
console.log("Report page snapshot");
console.log(`- chat mode: ${reportChatMode ?? "(missing)"}`);
console.log(`- deploy environment: ${reportDeployEnv ?? "(missing)"}`);
console.log(`- commit: ${reportCommit ?? "(missing)"}`);
console.log(`- resource scope: ${reportResourceScope ?? "(missing)"}`);
