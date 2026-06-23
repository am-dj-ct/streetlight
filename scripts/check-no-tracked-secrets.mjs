import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const forbiddenTrackedPathPatterns = [
  {
    label: "local env file",
    pattern: /^\.env(?:\..*)?\.local$/,
  },
  {
    label: "Vercel project metadata",
    pattern: /^\.vercel(?:\/|$)/,
  },
];
const secretPatterns = [
  {
    label: "Anthropic API key",
    pattern: /sk-ant-api[0-9A-Za-z_-]+/,
  },
  {
    label: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[0-9A-Za-z_-]{32,}/,
  },
  {
    label: "private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  },
  {
    label: "populated ANTHROPIC_API_KEY assignment",
    pattern: /^ANTHROPIC_API_KEY=sk-/m,
  },
  {
    label: "populated OPENAI_API_KEY assignment",
    pattern: /^OPENAI_API_KEY=sk-/m,
  },
  {
    label: "populated KV_REST_API_TOKEN assignment",
    pattern: /^KV_REST_API_TOKEN=.+/m,
  },
  {
    label: "populated TURNSTILE_SECRET_KEY assignment",
    pattern: /^TURNSTILE_SECRET_KEY=.+/m,
  },
  {
    label: "populated AZURE_SPEECH_KEY assignment",
    pattern: /^AZURE_SPEECH_KEY=.+/m,
  },
];
const binaryExtensions = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
]);

function fail(message) {
  throw new Error(message);
}

const trackedFilesResult = spawnSync("git", ["ls-files", "-z"], {
  cwd,
  encoding: "utf8",
});

if (trackedFilesResult.error) {
  fail(`Could not list tracked files: ${trackedFilesResult.error.message}`);
}

if (trackedFilesResult.status !== 0) {
  fail(`git ls-files exited ${trackedFilesResult.status}.`);
}

const trackedFiles = trackedFilesResult.stdout.split("\0").filter(Boolean);
const violations = [];

for (const relativePath of trackedFiles) {
  for (const { label, pattern } of forbiddenTrackedPathPatterns) {
    if (pattern.test(relativePath)) {
      violations.push(`${relativePath}: tracked ${label}`);
    }
  }
}

for (const relativePath of trackedFiles) {
  if (binaryExtensions.has(path.extname(relativePath).toLowerCase())) {
    continue;
  }

  const source = await readFile(path.join(cwd, relativePath), "utf8");

  for (const { label, pattern } of secretPatterns) {
    if (pattern.test(source)) {
      violations.push(`${relativePath}: ${label}`);
    }
  }
}

if (violations.length > 0) {
  fail(`Tracked secret-like value(s) found: ${violations.join("; ")}.`);
}

console.log("Tracked secret check passed.");
