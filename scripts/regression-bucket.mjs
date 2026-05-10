import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bucket = (process.argv[2] ?? "").trim();

if (!bucket) {
  throw new Error("Usage: node scripts/regression-bucket.mjs <stable-core|variance-watchlist>");
}

const allowedBuckets = new Set(["stable-core", "variance-watchlist"]);

if (!allowedBuckets.has(bucket)) {
  throw new Error(`Unknown bucket "${bucket}". Use one of: ${Array.from(allowedBuckets).join(", ")}`);
}

const listPath = path.join(process.cwd(), "tests", "prompts", `${bucket}.txt`);
const rawList = await readFile(listPath, "utf8");
const cases = rawList
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (cases.length === 0) {
  throw new Error(`No cases found in ${listPath}`);
}

const failures = [];
let passed = 0;

console.log(`Running ${cases.length} case(s) from ${bucket}...`);

for (const caseId of cases) {
  process.stdout.write(`- ${caseId} ... `);
  const result = spawnSync("npm", ["run", "regression:prompts"], {
    env: {
      ...process.env,
      PROMPT_CASE_FILTER: caseId,
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });

  if (result.status === 0) {
    passed += 1;
    console.log("ok");
    continue;
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const errorLine =
    combinedOutput.split("\n").find((line) => line.startsWith("Error: Case ")) ??
    "Error: regression execution failed";

  failures.push({
    caseId,
    errorLine: errorLine.replace(/^Error: /, ""),
  });
  console.log("FAIL");
}

console.log("");
console.log(`${bucket} summary: ${passed}/${cases.length} passed, ${failures.length} failed`);

for (const failure of failures) {
  console.log(`- ${failure.caseId}: ${failure.errorLine}`);
}

if (bucket === "stable-core" && failures.length > 0) {
  process.exit(1);
}
