import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonFile } from "./lib/json-file.mjs";

const cwd = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const defaultOutputPath = path.join(cwd, "tmp", `resource-review-${today}.md`);
const outputPath = getOutputPath(process.argv) ?? defaultOutputPath;
const fetchTimeoutMs = 15000;
const maxDisplayedPhones = 12;
const curlMetadataMarker = "\n__STREETLIGHT_CURL_METADATA__\n";
const execFile = promisify(execFileCallback);

const resourceFiles = [
  {
    label: "Referral resources",
    path: path.join(cwd, "src/data/referrals.json"),
    primaryUrlField: "website",
    displayName(resource) {
      return resource.name;
    },
  },
  {
    label: "Crisis resources",
    path: path.join(cwd, "src/data/crisis-resources.json"),
    primaryUrlField: "url",
    displayName(resource) {
      return resource.label;
    },
  },
];

function getOutputPath(args) {
  const outputIndex = args.indexOf("--output");

  if (outputIndex === -1) {
    return null;
  }

  const value = args[outputIndex + 1];

  if (!value || value.startsWith("--")) {
    throw new Error("--output requires a path.");
  }

  return path.resolve(cwd, value);
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripHtml(value) {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) {
    return "";
  }

  return stripHtml(match[1]);
}

function normalizePhone(value) {
  const digits = String(value)
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => {
      if ("ABC".includes(letter)) {
        return "2";
      }

      if ("DEF".includes(letter)) {
        return "3";
      }

      if ("GHI".includes(letter)) {
        return "4";
      }

      if ("JKL".includes(letter)) {
        return "5";
      }

      if ("MNO".includes(letter)) {
        return "6";
      }

      if ("PQRS".includes(letter)) {
        return "7";
      }

      if ("TUV".includes(letter)) {
        return "8";
      }

      return "9";
    })
    .replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits;
}

function formatPhone(value) {
  const normalized = normalizePhone(value);

  if (normalized.length === 10) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }

  return value;
}

function extractPhones(text) {
  const phonePattern =
    /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?(?:\d{4}|[A-Z]{4})\b|\b(?:211|911|988)\b/gi;
  const matches = text.match(phonePattern) ?? [];
  const phones = new Map();

  for (const match of matches) {
    const normalized = normalizePhone(match);

    if (normalized.length < 3) {
      continue;
    }

    if (!phones.has(normalized)) {
      phones.set(normalized, formatPhone(match.trim()));
    }
  }

  return [...phones.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([normalized, display]) => ({ display, normalized }));
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);

    url.hash = "";

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return String(value);
  }
}

function extractLinks(html, baseUrl) {
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  const links = new Set();

  for (const match of html.matchAll(hrefPattern)) {
    const rawHref = match[1] ?? match[2] ?? match[3] ?? "";

    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:")) {
      continue;
    }

    try {
      links.add(normalizeUrl(new URL(decodeHtmlEntities(rawHref), baseUrl).toString()));
    } catch {
      // Ignore malformed page links. The review target is the resource entry.
    }
  }

  return links;
}

async function fetchSource(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "StreetlightResourceReview/0.1 (+https://streetlight.help)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    const body = await response.text();

    return {
      body,
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    try {
      return await fetchSourceWithCurl(sourceUrl);
    } catch (curlError) {
      const fetchDetail = error instanceof Error ? error.message : String(error);
      const curlDetail = curlError instanceof Error ? curlError.message : String(curlError);

      throw new Error(`${fetchDetail}; curl fallback failed: ${curlDetail}`);
    }
  }
}

async function fetchSourceWithCurl(sourceUrl) {
  const { stdout } = await execFile(
    "curl",
    [
      "-L",
      "-sS",
      "--max-time",
      String(Math.ceil(fetchTimeoutMs / 1000)),
      "-H",
      "Accept: text/html,application/xhtml+xml",
      "-A",
      "StreetlightResourceReview/0.1 (+https://streetlight.help)",
      "-w",
      `${curlMetadataMarker}%{url_effective}\t%{http_code}`,
      sourceUrl,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const markerIndex = stdout.lastIndexOf(curlMetadataMarker);

  if (markerIndex === -1) {
    throw new Error("curl output was missing response metadata.");
  }

  const body = stdout.slice(0, markerIndex);
  const metadata = stdout.slice(markerIndex + curlMetadataMarker.length).trim();
  const [finalUrl = "", statusCode = "0"] = metadata.split("\t");
  const status = Number.parseInt(statusCode, 10);
  const ok = status >= 200 && status < 300;

  return {
    body,
    finalUrl,
    ok,
    status,
    statusText: ok ? "OK (curl fallback)" : "curl fallback",
  };
}

function getKnownPhones(resource) {
  return [resource.phone, resource.secondaryPhone]
    .filter((phone) => typeof phone === "string" && phone.trim().length > 0)
    .map((phone) => ({
      display: phone,
      normalized: normalizePhone(phone),
    }));
}

function buildIssues({
  finalUrl,
  foundLinks,
  foundPhones,
  ok,
  primaryUrl,
  resource,
  status,
}) {
  const issues = [];
  const normalizedSourceUrl = normalizeUrl(resource.sourceUrl);
  const normalizedFinalUrl = normalizeUrl(finalUrl);
  const normalizedPrimaryUrl = normalizeUrl(primaryUrl);
  const foundPhoneSet = new Set(foundPhones.map((phone) => phone.normalized));
  const knownPhones = getKnownPhones(resource);

  if (!ok) {
    issues.push(`Source returned HTTP ${status}.`);
  }

  for (const phone of knownPhones) {
    if (!foundPhoneSet.has(phone.normalized)) {
      issues.push(`Maintained phone ${phone.display} was not found on the source page.`);
    }
  }

  if (
    normalizedPrimaryUrl !== normalizedSourceUrl &&
    normalizedPrimaryUrl !== normalizedFinalUrl &&
    !foundLinks.has(normalizedPrimaryUrl)
  ) {
    issues.push(`Maintained user-facing URL ${primaryUrl} was not found on the source page.`);
  }

  return issues;
}

function buildObservations({ finalUrl, resource }) {
  const observations = [];
  const normalizedSourceUrl = normalizeUrl(resource.sourceUrl);
  const normalizedFinalUrl = normalizeUrl(finalUrl);

  if (normalizedFinalUrl !== normalizedSourceUrl) {
    observations.push(`Source URL redirects to ${finalUrl}.`);
  }

  return observations;
}

async function reviewResource(resource, resourceFile) {
  const primaryUrl = resource[resourceFile.primaryUrlField];
  const knownPhones = getKnownPhones(resource);

  try {
    const result = await fetchSource(resource.sourceUrl);
    const title = extractTitle(result.body);
    const visibleText = stripHtml(result.body);
    const foundPhones = extractPhones(visibleText);
    const foundLinks = extractLinks(result.body, result.finalUrl);
    const observations = buildObservations({
      finalUrl: result.finalUrl,
      resource,
    });
    const issues = buildIssues({
      finalUrl: result.finalUrl,
      foundLinks,
      foundPhones,
      ok: result.ok,
      primaryUrl,
      resource,
      status: result.status,
    });

    return {
      displayName: resourceFile.displayName(resource),
      finalUrl: result.finalUrl,
      foundPhones,
      issues,
      knownPhones,
      observations,
      primaryUrl,
      resource,
      sourceGroup: resourceFile.label,
      status: `${result.status} ${result.statusText}`.trim(),
      title,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    return {
      displayName: resourceFile.displayName(resource),
      finalUrl: "",
      foundPhones: [],
      issues: [`Fetch failed: ${detail}`],
      knownPhones,
      observations: [],
      primaryUrl,
      resource,
      sourceGroup: resourceFile.label,
      status: "fetch failed",
      title: "",
    };
  }
}

function markdownLink(label, url) {
  return `[${escapeMarkdown(label)}](${url})`;
}

function escapeMarkdown(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function renderPhoneList(phones) {
  if (phones.length === 0) {
    return "none";
  }

  return phones
    .slice(0, maxDisplayedPhones)
    .map((phone) => phone.display)
    .join(", ");
}

function renderEntry(entry) {
  const lines = [
    `### ${escapeMarkdown(entry.sourceGroup)} / ${escapeMarkdown(entry.resource.id)} - ${escapeMarkdown(entry.displayName)}`,
    "",
    `- Source: ${markdownLink(entry.resource.sourceName, entry.resource.sourceUrl)}`,
    `- User-facing URL: ${markdownLink(entry.primaryUrl, entry.primaryUrl)}`,
    `- Fetch: ${escapeMarkdown(entry.status)}${entry.finalUrl ? ` at ${markdownLink(entry.finalUrl, entry.finalUrl)}` : ""}`,
    `- Page title: ${entry.title ? escapeMarkdown(entry.title) : "none found"}`,
    `- Maintained phone(s): ${renderPhoneList(entry.knownPhones)}`,
    `- Candidate phone(s) found: ${renderPhoneList(entry.foundPhones)}`,
  ];

  if (entry.issues.length > 0) {
    lines.push("- Review notes:");

    for (const issue of entry.issues) {
      lines.push(`  - ${escapeMarkdown(issue)}`);
    }
  }

  if (entry.observations.length > 0) {
    lines.push("- Observations:");

    for (const observation of entry.observations) {
      lines.push(`  - ${escapeMarkdown(observation)}`);
    }
  }

  return lines.join("\n");
}

function renderReport(entries) {
  const needsReview = entries.filter((entry) => entry.issues.length > 0);
  const unchanged = entries.filter((entry) => entry.issues.length === 0);
  const fetchFailed = entries.filter((entry) =>
    entry.issues.some((issue) => issue.startsWith("Fetch failed:")),
  );
  const redirects = entries.filter((entry) =>
    entry.observations.some((observation) =>
      observation.startsWith("Source URL redirects to "),
    ),
  );
  const lines = [
    `# Streetlight Resource Review - ${today}`,
    "",
    "This report is scrape-assisted only. It is meant to help a human decide what to verify; it does not update live resource data and should not be treated as authoritative.",
    "",
    "## Summary",
    "",
    `- Total resources checked: ${entries.length}`,
    `- Needs manual review: ${needsReview.length}`,
    `- Looks unchanged: ${unchanged.length}`,
    `- Fetch failed: ${fetchFailed.length}`,
    `- Source URL redirects observed: ${redirects.length}`,
    "",
    "## Needs Manual Review",
    "",
    needsReview.length > 0
      ? needsReview.map(renderEntry).join("\n\n")
      : "No scrape-assisted review flags.",
    "",
    "## Looks Unchanged",
    "",
    unchanged.length > 0
      ? unchanged.map(renderEntry).join("\n\n")
      : "No resources were cleanly matched.",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

const entries = [];

for (const resourceFile of resourceFiles) {
  const resources = await readJsonFile(resourceFile.path);

  if (!Array.isArray(resources)) {
    throw new Error(`${resourceFile.path} must contain an array.`);
  }

  for (const resource of resources) {
    if (typeof resource.sourceUrl !== "string" || resource.sourceUrl.length === 0) {
      throw new Error(`${resource.id ?? "unknown-id"} is missing sourceUrl.`);
    }

    entries.push(await reviewResource(resource, resourceFile));
  }
}

const report = renderReport(entries);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, report);

const needsReviewCount = entries.filter((entry) => entry.issues.length > 0).length;
const fetchFailedCount = entries.filter((entry) =>
  entry.issues.some((issue) => issue.startsWith("Fetch failed:")),
).length;

console.log("Streetlight resource source check");
console.log(`- report: ${path.relative(cwd, outputPath)}`);
console.log(`- resources checked: ${entries.length}`);
console.log(`- needs manual review: ${needsReviewCount}`);
console.log(`- fetch failed: ${fetchFailedCount}`);
