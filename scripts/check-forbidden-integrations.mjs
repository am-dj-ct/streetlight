import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./lib/json-file.mjs";

const cwd = process.cwd();
const sourceRoots = ["src", "scripts"];
const scannedExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const dependencyBuckets = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const forbiddenPackages = [
  "@bugsnag/js",
  "@bugsnag/plugin-react",
  "@datadog/browser-logs",
  "@datadog/browser-rum",
  "@logtail/next",
  "@logtail/node",
  "@sentry/nextjs",
  "@sentry/react",
  "@vercel/analytics",
  "@vercel/speed-insights",
  "axiom",
  "dd-trace",
  "fathom-client",
  "logflare",
  "logrocket",
  "newrelic",
  "plausible-tracker",
  "posthog-js",
];

function fail(message) {
  throw new Error(message);
}

function isForbiddenSpecifier(specifier) {
  return forbiddenPackages.some(
    (packageName) =>
      specifier === packageName || specifier.startsWith(`${packageName}/`),
  );
}

async function collectSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }

    if (scannedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractImportSpecifiers(source) {
  const patterns = [
    /\bimport\s+(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  return patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]),
  );
}

const packageJson = await readJsonFile(path.join(cwd, "package.json"));
const packageLock = await readJsonFile(path.join(cwd, "package-lock.json"));
const dependencyViolations = [];

for (const bucket of dependencyBuckets) {
  const dependencies = packageJson[bucket];

  if (!dependencies || typeof dependencies !== "object") {
    continue;
  }

  for (const packageName of Object.keys(dependencies)) {
    if (isForbiddenSpecifier(packageName)) {
      dependencyViolations.push(`${bucket}.${packageName}`);
    }
  }
}

if (dependencyViolations.length > 0) {
  fail(`Forbidden integration package(s): ${dependencyViolations.join(", ")}.`);
}

const lockfileViolations = [];

if (packageLock.packages && typeof packageLock.packages === "object") {
  for (const packagePath of Object.keys(packageLock.packages)) {
    if (!packagePath.startsWith("node_modules/")) {
      continue;
    }

    const packageName = packagePath.slice("node_modules/".length);

    if (isForbiddenSpecifier(packageName)) {
      lockfileViolations.push(packagePath);
    }
  }
}

if (lockfileViolations.length > 0) {
  fail(`Forbidden integration lockfile package(s): ${lockfileViolations.join(", ")}.`);
}

const importViolations = [];

for (const rootName of sourceRoots) {
  const sourceFiles = await collectSourceFiles(path.join(cwd, rootName));

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      if (isForbiddenSpecifier(specifier)) {
        importViolations.push(
          `${path.relative(cwd, filePath)} imports ${specifier}`,
        );
      }
    }
  }
}

if (importViolations.length > 0) {
  fail(`Forbidden integration import(s): ${importViolations.join("; ")}.`);
}

console.log("Forbidden integration check passed.");
