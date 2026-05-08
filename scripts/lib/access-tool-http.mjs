export const defaultBaseUrl =
  process.env.ACCESS_TOOL_BASE_URL ?? "http://localhost:3000";

export function extractHtmlLang(html) {
  const match = html.match(/<html lang="([^"]+)"/i);
  return match?.[1] ?? null;
}

export async function fetchHtmlPage({
  baseUrl = defaultBaseUrl,
  expectedStatus = 200,
  fail,
  headers = {},
  path,
}) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      Accept: "text/html",
      ...headers,
    },
  });

  if (response.status !== expectedStatus) {
    fail(`HTTP ${response.status} from ${path}.`);
  }

  return {
    html: await response.text(),
    response,
  };
}

export async function getHealth({
  baseUrl = defaultBaseUrl,
  fail,
  requireDeployConfigOk = false,
}) {
  const response = await fetch(new URL("/healthz", baseUrl), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    fail(`HTTP ${response.status} from /healthz.`);
  }

  const body = await response.json().catch(() => null);

  if (
    !body ||
    body.ok !== true ||
    body.service !== "access-tool" ||
    (body.chatMode !== "live-model" && body.chatMode !== "mock-local") ||
    (requireDeployConfigOk && body.deployConfigOk !== true)
  ) {
    fail("Unexpected /healthz response body.");
  }

  return body;
}
