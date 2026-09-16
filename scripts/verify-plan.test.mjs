// Guards for the category-aware verify plan.
//
// These exist because the failure mode of a selective check is silent: it
// picks a smaller set, everything goes green faster, and nobody finds out
// that the check which would have caught the bug is no longer selected. Each
// test below is a specific way that could happen.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { alwaysChecks, checkCatalog, checkIds, classifyPath, planVerify, rules } from "./lib/verify-plan.mjs";
import { launchRequiredFiles } from "./lib/repo-readiness.mjs";

function checksFor(changedPaths, overrideChecks = []) {
  return planVerify({ changedPaths, overrideChecks }).checks.map((check) => check.id);
}

test("a plain docs change does not build or start a server", () => {
  const plan = planVerify({ changedPaths: ["docs/access_tool_thesis.md"] });
  assert.equal(plan.status, "ok");
  assert.deepEqual(plan.categories, ["docs"]);
  assert.equal(plan.needsBuild, false);
  assert.equal(plan.needsRuntime, false);
});

test("product-consumed documentation still runs check:launch", () => {
  for (const relativePath of launchRequiredFiles) {
    const ids = checksFor([relativePath]);
    assert.ok(
      ids.includes("check:launch"),
      `${relativePath} is read by check-launch-readiness.mjs but did not select check:launch`,
    );
  }
});

test("every product-consumed documentation path actually exists", () => {
  // If one is renamed and the planner list is not updated, the rule silently
  // stops matching and those docs fall back to the cheap lane.
  for (const relativePath of launchRequiredFiles) {
    assert.ok(existsSync(relativePath), `${relativePath} is in launchRequiredFiles but is not in the repo`);
  }
});

test("product docs are not classified by the plain-doc rule", () => {
  const rule = classifyPath("docs/partners/launch-packet.md");
  assert.equal(rule.id, "product-consumed-doc");
  assert.notEqual(classifyPath("docs/access_tool_thesis.md").id, "product-consumed-doc");
});

test("resource data selects validation, staleness and the rendered pass", () => {
  const ids = checksFor(["src/data/referrals.json"]);
  assert.ok(ids.includes("validate:data"));
  assert.ok(ids.includes("check:launch"));
  assert.ok(ids.includes("smoke"));
  assert.deepEqual(planVerify({ changedPaths: ["src/data/referrals.json"] }).categories, ["data"]);
});

test("translated copy selects the locale checks and the rendered pass", () => {
  const ids = checksFor(["src/data/ui-copy/es.json"]);
  assert.ok(ids.includes("check:locales:summary"));
  assert.ok(ids.includes("check:content"));
  assert.ok(ids.includes("smoke"));
});

test("UI source selects lint, build, parity and the rendered pass", () => {
  const ids = checksFor(["src/components/crisis-footer.tsx"]);
  assert.ok(ids.includes("lint"));
  assert.ok(ids.includes("build"));
  assert.ok(ids.includes("parity"));
  assert.ok(ids.includes("smoke"));
  assert.deepEqual(planVerify({ changedPaths: ["src/components/crisis-footer.tsx"] }).categories, ["ui"]);
});

test("no rule can select a rendered check without the parity proof", () => {
  // This is the whole justification for testing the production build rather
  // than the development server. Iterating the exported rules, not a list of
  // example paths: a NEW rule that selects smoke without parity has to fail
  // here, and a hardcoded list of four paths would not have noticed it.
  const runtimeIds = checkCatalog.filter((check) => check.phase === "runtime").map((check) => check.id);

  for (const rule of rules) {
    if (!rule.checks.some((id) => runtimeIds.includes(id))) {
      continue;
    }

    assert.ok(rule.checks.includes("parity"), `rule ${rule.id} selects a rendered check without parity`);
    assert.ok(rule.checks.includes("build"), `rule ${rule.id} selects a rendered check without a build`);
  }
});

test("every rule names only checks that exist", () => {
  for (const rule of rules) {
    for (const id of rule.checks) {
      assert.ok(checkIds.includes(id), `rule ${rule.id} names unknown check ${id}`);
    }
  }
});

test("the whitespace check diffs against the comparison base, not the worktree", () => {
  // `git diff --check HEAD` compares the working tree to HEAD. A CI checkout
  // is clean, so that form passed unconditionally and the docs lane verified
  // nothing at all.
  const whitespace = checkCatalog.find((check) => check.id === "docs:whitespace");
  assert.ok(whitespace.command.some((part) => part.includes("{{base}}")), "docs:whitespace lost its comparison base");
  assert.ok(!whitespace.command.includes("HEAD"), "docs:whitespace compares the worktree to HEAD again");
});

test("toolchain and script changes run the whole catalog", () => {
  for (const relativePath of ["package.json", ".github/workflows/verify.yml", "scripts/smoke.mjs"]) {
    assert.deepEqual(checksFor([relativePath]), checkIds, `${relativePath} did not select every check`);
  }
});

test("the plan itself is a toolchain input", () => {
  assert.deepEqual(checksFor(["scripts/lib/verify-plan.mjs"]), checkIds);
});

test("the non-negotiable scans run on every plan", () => {
  for (const changed of [[], ["docs/access_tool_thesis.md"], ["src/app/page.tsx"]]) {
    const ids = checksFor(changed);

    for (const alwaysId of alwaysChecks) {
      assert.ok(ids.includes(alwaysId), `${alwaysId} missing for ${JSON.stringify(changed)}`);
    }
  }
});

test("every file already in the repository classifies", () => {
  // The first real CI run of this plan blocked on `.gitignore`, which no rule
  // claimed. Blocking was correct -- an unknown input must never pass quietly
  // -- but a rule set that cannot classify files already sitting in the repo
  // blocks the next unrelated change too. Anything tracked today has to be
  // claimed by some rule.
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim() !== "");
  const unclassified = tracked.filter((relativePath) => !classifyPath(relativePath));
  assert.deepEqual(unclassified, [], `no rule claims: ${unclassified.join(", ")}`);
  assert.ok(tracked.length > 100, "git ls-files returned suspiciously little");
});

test("an unclassified path blocks and names itself", () => {
  const plan = planVerify({ changedPaths: ["some/brand-new-surface/thing.bin"] });
  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.unmapped, ["some/brand-new-surface/thing.bin"]);
});

test("an unclassified path is not masked by a mapped one", () => {
  // The dangerous version of the previous test: a real change alongside an
  // unknown one must not come back green because the known half selected
  // something.
  const plan = planVerify({
    changedPaths: ["src/app/page.tsx", "some/brand-new-surface/thing.bin"],
  });
  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.unmapped, ["some/brand-new-surface/thing.bin"]);
});

test("an operator can resolve a missing relationship with a bounded list", () => {
  const plan = planVerify({
    changedPaths: ["some/brand-new-surface/thing.bin"],
    overrideChecks: ["lint", "build"],
  });
  assert.equal(plan.status, "ok");
  assert.deepEqual(plan.unmapped, ["some/brand-new-surface/thing.bin"]);
  assert.ok(plan.checks.map((check) => check.id).includes("lint"));
});

test("every catalog entry is reachable from some rule or the always list", () => {
  const reachable = new Set(alwaysChecks);

  for (const relativePath of [
    "config/sentinel-v5-registry-fragment.streetlight.json",
    ".gitignore",
    "package.json",
    "docs/partners/launch-packet.md",
    "docs/access_tool_thesis.md",
    "src/data/referrals.json",
    "src/data/ui-copy/es.json",
    "src/app/page.tsx",
  ]) {
    for (const id of checksFor([relativePath])) {
      reachable.add(id);
    }
  }

  assert.deepEqual([...reachable].sort(), [...checkIds].sort());
});

test("the plan reports something for every run", () => {
  // Always-reporting: even an empty change set produces a manifest with
  // checks in it, never an empty skipped result.
  const plan = planVerify({ changedPaths: [] });
  assert.equal(plan.status, "ok");
  assert.ok(plan.checks.length > 0);
});
