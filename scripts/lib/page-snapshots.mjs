function stripScriptTags(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

export function extractLabeledValue(html, label) {
  const visibleHtml = stripScriptTags(html);
  const normalizedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${normalizedLabel}:\\s*(?:<!-- -->\\s*)*([^<]+)`, "i");
  const match = visibleHtml.match(pattern);
  return match?.[1]?.trim() ?? null;
}

export async function getReportProblemSnapshot({
  baseUrl,
  fail,
  path,
}) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    fail(`HTTP ${response.status} from ${path}.`);
  }

  const html = await response.text();

  return {
    commit: extractLabeledValue(html, "Current commit"),
    deployEnv: extractLabeledValue(html, "Current deploy environment"),
    entryButton: extractLabeledValue(html, "Entry button"),
    html,
    resourceScope: extractLabeledValue(html, "Current resource scope"),
    sourceRoute: extractLabeledValue(html, "Source route"),
    chatMode: extractLabeledValue(html, "Current chat mode"),
  };
}

export async function getReferralsSnapshot({
  baseUrl,
  fail,
  path,
}) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    fail(`HTTP ${response.status} from ${path}.`);
  }

  const html = await response.text();

  return {
    checkedThrough: extractLabeledValue(html, "Resource list checked through"),
    html,
    topSource: extractLabeledValue(html, "Source"),
    topVerified: extractLabeledValue(html, "Verified"),
  };
}
