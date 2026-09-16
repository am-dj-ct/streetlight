// Category-aware verification planning.
//
// The Verify workflow used to do the same thing for every change: install,
// run every static check, build, start a development server, smoke it. A
// one-word docs edit paid for a Next build and a dev server; a resource-data
// edit paid for the same. AGENTS.md has always described docs, data/resources
// and UI as three different verification categories with three different
// expectations. This module is that description made executable.
//
// Two properties matter more than the speedup:
//
//   1. Always reporting. The plan never produces "nothing ran, nothing said".
//      Every run prints a manifest naming every changed path, the rule that
//      classified it, and the checks that rule selected. A docs-only change
//      still concludes with a visible verdict instead of a skipped check that
//      branch protection can never resolve.
//
//   2. Product-consumed documentation is not "just docs". `docs/partners/*`,
//      `docs/resource_maintenance.md`, `docs/translation_handoff.md`,
//      `docs/translation_worklist.md`, `README.md`, `OPERATIONAL_RUNBOOK.md`
//      and `incidents/log.md` are read by scripts/check-launch-readiness.mjs
//      and scripts/lib/repo-readiness.mjs. A TBD marker or a missing partner
//      file in one of those is a real failure, so those paths select
//      `check:launch` rather than the cheap docs lane. The list is imported
//      from repo-readiness.mjs, not copied, so it cannot drift.
//
// An input this module cannot classify does not quietly pass and does not
// quietly expand to everything: the plan comes back `blocked` and names the
// path, and an operator can supply a bounded named check list instead.

import { launchRequiredFiles } from "./repo-readiness.mjs";

// Ordered. The runner executes selected checks in this order, so cheap
// static checks fail before anything builds or starts a server.
export const checkCatalog = [
  {
    id: "docs:whitespace",
    command: ["git", "diff", "--check", "HEAD"],
    label: "git diff --check",
    phase: "static",
  },
  {
    id: "check:no-tracked-secrets",
    command: ["npm", "run", "check:no-tracked-secrets"],
    label: "tracked-secret scan",
    phase: "static",
  },
  {
    id: "check:forbidden-integrations",
    command: ["npm", "run", "check:forbidden-integrations"],
    label: "forbidden-integration scan",
    phase: "static",
  },
  {
    id: "lint",
    command: ["npm", "run", "lint"],
    label: "eslint",
    phase: "static",
  },
  {
    id: "check:env",
    command: ["npm", "run", "check:env"],
    label: "env shape",
    phase: "static",
  },
  {
    id: "check:content",
    command: ["npm", "run", "check:content"],
    label: "content contracts",
    phase: "static",
  },
  {
    id: "check:locales:summary",
    command: ["npm", "run", "check:locales:summary"],
    label: "locale coverage",
    phase: "static",
  },
  {
    id: "check:translation-worklist",
    command: ["npm", "run", "check:translation-worklist"],
    label: "translation worklist freshness",
    phase: "static",
  },
  {
    id: "validate:data",
    command: ["npm", "run", "validate:data"],
    label: "resource data validation",
    phase: "static",
  },
  {
    id: "check:launch",
    command: ["npm", "run", "check:launch"],
    label: "launch readiness (product-consumed docs)",
    phase: "static",
  },
  {
    id: "test:verify-plan",
    command: ["npm", "run", "test:verify-plan"],
    label: "verify-plan guard tests",
    phase: "static",
  },
  {
    id: "test:ui-sentry",
    command: ["npm", "run", "test:ui-sentry"],
    label: "ui-sentry tests",
    phase: "static",
  },
  {
    id: "test:sentinel-v5",
    command: ["npm", "run", "test:sentinel-v5"],
    label: "sentinel-v5 tests",
    phase: "static",
  },
  {
    id: "build",
    command: ["npm", "run", "build"],
    label: "next build",
    phase: "build",
  },
  {
    id: "parity",
    command: ["node", "scripts/check-build-runtime-parity.mjs"],
    label: "mock build / runtime parity proof",
    phase: "parity",
  },
  {
    id: "check:ops",
    command: ["npm", "run", "check:ops"],
    label: "ops tools",
    phase: "runtime",
  },
  {
    id: "smoke",
    command: ["npm", "run", "smoke"],
    label: "rendered smoke",
    phase: "runtime",
  },
  {
    id: "regression:mock",
    command: ["npm", "run", "regression:mock"],
    label: "mock prompt regression",
    phase: "runtime",
  },
];

export const checkIds = checkCatalog.map((check) => check.id);

const uiRuntimeChecks = [
  "lint",
  "check:content",
  "build",
  "parity",
  "check:ops",
  "smoke",
  "regression:mock",
];

const everyCheck = checkIds;

// Checks that run on every plan, whatever changed. These are the repo's
// non-negotiables (AGENTS.md "Non-Negotiables") and they are cheap: a change
// that adds a tracked secret or a forbidden analytics integration must never
// be able to pick a category that does not look for it.
export const alwaysChecks = ["check:no-tracked-secrets", "check:forbidden-integrations"];

function isUnder(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

// First matching rule wins for a given path. Each rule explains itself, and
// the explanation is printed in the manifest, so a surprising selection is
// readable rather than archaeological.
export const rules = [
  {
    category: "meta",
    checks: everyCheck,
    id: "meta-toolchain",
    match: (p) =>
      p === "package.json" ||
      p === "package-lock.json" ||
      p === "next.config.ts" ||
      p === "tsconfig.json" ||
      p === "eslint.config.mjs" ||
      p === "postcss.config.mjs" ||
      p === "vercel.json" ||
      p === ".env.example" ||
      isUnder(p, ".github") ||
      isUnder(p, "scripts") ||
      isUnder(p, "tests"),
    reason:
      "toolchain, workflow, script or fixture input: shapes every other check, so the plan is the full set",
  },
  {
    category: "docs",
    checks: ["check:launch", "check:translation-worklist", "docs:whitespace"],
    id: "product-consumed-doc",
    match: (p) => launchRequiredFiles.includes(p),
    reason:
      "documentation read by scripts/check-launch-readiness.mjs; placeholders, missing partner files and stale translation state are real failures here",
  },
  {
    category: "data",
    checks: [
      "validate:data",
      "check:content",
      "check:launch",
      "build",
      "parity",
      "check:ops",
      "smoke",
      "regression:mock",
    ],
    id: "resource-data",
    match: (p) => p === "src/data/referrals.json" || p === "src/data/crisis-resources.json",
    reason:
      "referral/crisis resource data: validated statically, checked for staleness by check:launch, and rendered by the find-a-human surface, so it also runs the rendered pass",
  },
  {
    category: "data",
    checks: [
      "check:content",
      "check:locales:summary",
      "check:translation-worklist",
      "check:launch",
      "build",
      "parity",
      "check:ops",
      "smoke",
      "regression:mock",
    ],
    id: "locale-content",
    match: (p) =>
      isUnder(p, "src/data/ui-copy") ||
      isUnder(p, "src/data/conversation-content") ||
      isUnder(p, "src/data/static-pages"),
    reason:
      "translated copy consumed by the product: contract-checked, locale-checked, and asserted as rendered text by smoke",
  },
  {
    category: "data",
    checks: ["validate:data", "check:content", "check:launch"],
    id: "other-data",
    match: (p) => isUnder(p, "src/data"),
    reason: "static data under src/data",
  },
  {
    category: "ui",
    checks: uiRuntimeChecks,
    id: "application-source",
    match: (p) => isUnder(p, "src") || isUnder(p, "public"),
    reason:
      "application source or public asset: linted, built, parity-proved, then verified against the production build in the rendered workflow",
  },
  {
    category: "meta",
    checks: ["test:sentinel-v5"],
    id: "sentinel-registry-config",
    match: (p) => isUnder(p, "config"),
    reason:
      "checked-in configuration read by scripts/sentinel-v5; its registry sync test is what notices a bad fragment",
  },
  {
    category: "meta",
    checks: ["docs:whitespace"],
    id: "repo-hygiene",
    match: (p) =>
      p === ".gitignore" ||
      p === ".gitattributes" ||
      p === ".nvmrc" ||
      p === "LICENSE",
    reason:
      "repository hygiene file; .gitignore in particular changes what is tracked, which the always-on tracked-secret scan is the check for",
  },
  {
    category: "docs",
    checks: [],
    id: "outreach-asset",
    match: (p) => !p.includes("/") && /\.(png|jpe?g|gif|svg|pdf|ico|webp)$/i.test(p),
    reason: "outreach or print asset at the repository root; no check reads it",
  },
  {
    category: "docs",
    checks: ["docs:whitespace"],
    id: "plain-doc",
    match: (p) =>
      isUnder(p, "docs") ||
      isUnder(p, "incidents") ||
      isUnder(p, ".claude") ||
      (!p.includes("/") && p.endsWith(".md")),
    reason: "documentation no script or product surface reads",
  },
  {
    category: "meta",
    checks: [],
    id: "ignored-artifact",
    match: (p) => isUnder(p, "tmp") || isUnder(p, ".vercel") || isUnder(p, "node_modules"),
    reason: "build or local artifact, not an input to any check",
  },
];

export function classifyPath(relativePath) {
  for (const rule of rules) {
    if (rule.match(relativePath)) {
      return rule;
    }
  }

  return null;
}

/**
 * @param {{ changedPaths: string[], overrideChecks?: string[] }} input
 */
export function planVerify({ changedPaths, overrideChecks = [] }) {
  const paths = [];
  const unmapped = [];
  const selected = new Map();

  function select(checkId, reasonPath, ruleId) {
    if (!checkIds.includes(checkId)) {
      throw new Error(`Unknown check id in plan: ${checkId}`);
    }

    const entry = selected.get(checkId) ?? { checkId, reasons: [] };
    entry.reasons.push({ path: reasonPath, ruleId });
    selected.set(checkId, entry);
  }

  for (const checkId of alwaysChecks) {
    select(checkId, "(every run)", "always");
  }

  const uniquePaths = [...new Set(changedPaths.filter((value) => value.trim() !== ""))].sort();

  for (const relativePath of uniquePaths) {
    const rule = classifyPath(relativePath);

    if (!rule) {
      unmapped.push(relativePath);
      paths.push({
        category: null,
        path: relativePath,
        reason: "no rule in scripts/lib/verify-plan.mjs claims this path",
        ruleId: null,
      });
      continue;
    }

    paths.push({
      category: rule.category,
      path: relativePath,
      reason: rule.reason,
      ruleId: rule.id,
    });

    for (const checkId of rule.checks) {
      select(checkId, relativePath, rule.id);
    }
  }

  for (const checkId of overrideChecks) {
    select(checkId, "(operator override)", "override");
  }

  const blocked = unmapped.length > 0 && overrideChecks.length === 0;
  const checks = checkCatalog
    .filter((check) => selected.has(check.id))
    .map((check) => ({ ...check, reasons: selected.get(check.id).reasons }));

  const categories = [...new Set(paths.map((entry) => entry.category).filter(Boolean))].sort();

  return {
    blocked,
    categories,
    changedPathCount: uniquePaths.length,
    checks,
    needsBuild: checks.some((check) => check.phase === "build"),
    needsRuntime: checks.some((check) => check.phase === "runtime"),
    paths,
    status: blocked ? "blocked" : "ok",
    unmapped,
  };
}
