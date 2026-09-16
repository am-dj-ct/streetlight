// Print the category-aware verification plan for a change.
//
//   node scripts/plan-verify.mjs --base origin/main
//   node scripts/plan-verify.mjs --changed docs/partners/launch-packet.md
//   node scripts/plan-verify.mjs --base <sha> --manifest verify-manifest.json
//
// Always reports. A plan with nothing to say still prints its manifest and
// still exits 0; a plan it cannot classify exits 2 and names the path rather
// than passing quietly or expanding to the whole suite on its own. The
// `--check` escape hatch supplies a bounded, named check list for that case.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { checkIds, planVerify } from "./lib/verify-plan.mjs";

const args = process.argv.slice(2);
const options = { all: false, base: null, changed: [], checks: [], json: false, manifest: null };

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = () => {
    const value = args[index + 1];

    if (value === undefined) {
      console.error(`${arg} needs a value.`);
      process.exit(2);
    }

    index += 1;
    return value;
  };

  if (arg === "--base") {
    options.base = next();
  } else if (arg === "--changed") {
    options.changed.push(next());
  } else if (arg === "--check") {
    options.checks.push(next());
  } else if (arg === "--manifest") {
    options.manifest = next();
  } else if (arg === "--all") {
    options.all = true;
  } else if (arg === "--json") {
    options.json = true;
  } else {
    // An unsupported flag is a mistake in the caller, not something to guess at.
    console.error(`Unsupported argument: ${arg}`);
    process.exit(2);
  }
}

for (const checkId of options.checks) {
  if (!checkIds.includes(checkId)) {
    console.error(`Unsupported --check value: ${checkId}`);
    console.error(`Known checks: ${checkIds.join(", ")}`);
    process.exit(2);
  }
}

function changedPathsFromGit(base) {
  const merged = spawnSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" });
  const comparison = merged.status === 0 ? merged.stdout.trim() : base;
  const diff = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMRTD", `${comparison}...HEAD`], {
    encoding: "utf8",
  });

  if (diff.status !== 0) {
    // An unusable comparison base is a hard failure. Treating it as "nothing
    // changed" would hand back a green plan that verified nothing at all.
    console.error(`Could not diff against ${base}: ${diff.stderr.trim()}`);
    process.exit(2);
  }

  return diff.stdout.split("\n").filter((line) => line.trim() !== "");
}

// `--all` is the deliberate full pass: the post-merge run on the default
// branch, and anything an operator wants verified end to end. It is stated
// rather than inferred, so a broken comparison base can never quietly turn
// into "everything ran".
if (options.all) {
  options.checks = checkIds;
}

const changedPaths =
  options.all
    ? []
    : options.changed.length > 0
    ? options.changed
    : options.base
      ? changedPathsFromGit(options.base)
      : (() => {
          console.error("Pass --base <ref> or one or more --changed <path>.");
          process.exit(2);
        })();

const plan = planVerify({ changedPaths, overrideChecks: options.checks });
const manifest = {
  base: options.base,
  generatedAt: new Date().toISOString(),
  overrideChecks: options.checks,
  ...plan,
  checks: plan.checks.map((check) => ({
    command: check.command,
    id: check.id,
    label: check.label,
    phase: check.phase,
    reasons: check.reasons,
  })),
};

if (options.manifest) {
  writeFileSync(options.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (options.json) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  console.log("Verify plan");
  console.log("");
  console.log(`base: ${options.base ?? "(explicit --changed list)"}`);
  console.log(`changed paths: ${plan.changedPathCount}`);
  console.log(`categories: ${plan.categories.length > 0 ? plan.categories.join(", ") : "(none)"}`);
  console.log("");
  console.log("Changed paths and why:");

  if (plan.paths.length === 0) {
    console.log("  (no changed paths; baseline checks still run)");
  }

  for (const entry of plan.paths) {
    console.log(`  ${entry.path}`);
    console.log(`      category=${entry.category ?? "UNMAPPED"} rule=${entry.ruleId ?? "none"}`);
    console.log(`      ${entry.reason}`);
  }

  console.log("");
  console.log("Selected checks:");

  for (const check of plan.checks) {
    const causes = [...new Set(check.reasons.map((reason) => reason.path))];
    console.log(`  ${check.id}  [${check.phase}]  ${check.label}`);
    console.log(`      because: ${causes.slice(0, 6).join(", ")}${causes.length > 6 ? ", ..." : ""}`);
  }

  console.log("");
  console.log(`needs build: ${plan.needsBuild}; needs running app: ${plan.needsRuntime}`);

  if (plan.unmapped.length > 0) {
    console.log("");
    console.log("MISSING RELATIONSHIP — these paths match no rule:");

    for (const entry of plan.unmapped) {
      console.log(`  ${entry}`);
    }

    console.log("");
    console.log("Add a rule in scripts/lib/verify-plan.mjs, or re-run with an explicit");
    console.log("bounded list, for example: --check lint --check build --check smoke");
  }

  console.log("");
  console.log(`plan status: ${plan.status}`);
}

process.exitCode = plan.blocked ? 2 : 0;
