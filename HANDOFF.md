# HANDOFF

Persistent end-of-session handoff for this repo.

Update this file only when explicitly asked by the user. Add the newest entry at
the top. Each entry should include:

- what happened in the previous session
- anything flagged to come back to later
- where work was left
- what is next
- any relevant commits
- git/deploy state if it matters

`HANDOFF.md` is a tracked repo artifact and should be committed whenever it is
updated.

## 2026-05-21

### Previous session

- Fast-forwarded local `main` to `429d6cb` from `origin/main`.
- Manually verified the previously flagged resource entries against their
  official pages.
- Updated `src/data/referrals.json` with the current NWIRP phone numbers and
  better review-source URLs for the L&I and DOL entries.
- Added the scheduled `Resource Review` GitHub Actions workflow and documented
  the weekly review process in `docs/resource_maintenance.md`.
- Patched `scripts/check-resource-sources.mjs` to fall back to `curl` when
  Node fetch fails on site certificate issues, which cleared the recurring
  `washington-poison-center` false positive.
- Confirmed `tmp/resource-review-2026-05-21.md` now reports zero manual-review
  flags and zero fetch failures.
- Decided that `HANDOFF.md` should be committed with the repo whenever it
  changes.

### Flagged to come back to

- Push the local commit once reviewed.
- Keep running the weekly resource-review workflow and spot-check any future
  report changes against the official sources.

### Where things left off

- Local changes are ready to commit together, including `HANDOFF.md`.
- Local `main` is current with `origin/main` at
  `429d6cb2d66851d346ad6fb00cd6355d6cf206fa` before the new commit.

### Next

- Commit the verified resource-review updates and the tracked `HANDOFF.md`
  policy change.
- Push when ready.

### Commits

- No new commit created yet in this session at the time of this note.
- Relevant current branch point:
  `429d6cb` local HEAD and `origin/main`.

## 2026-05-21

### Previous session

- Created this persistent `HANDOFF.md` file at repo root.
- Defined the rule that it should only be updated when explicitly requested by
  the user.
- Seeded it with the prior resource-review session summary and the current
  branch/deploy mismatch so future sessions have a clear restart point.

### Flagged to come back to

- Decide whether to commit `HANDOFF.md` as a tracked repo artifact or leave it
  local-only.
- Review the upstream `429d6cb` work before doing more local changes, since
  local `main` is still behind.
- Keep the earlier flagged resource-review follow-ups in view:
  manual verification of the flagged resources, then a scheduled review job.

### Where things left off

- Local working tree is otherwise clean; the only uncommitted change is
  `HANDOFF.md`.
- Local HEAD remains `8ef052beb09b795b0096064a4d685c1e35fc7ac3`
  (`Add resource source review tooling`).
- `origin/main` remains
  `429d6cb2d66851d346ad6fb00cd6355d6cf206fa`
  (`Add QR code generator and static assets for print distribution`).

### Next

- If the handoff file should live in the repo, commit `HANDOFF.md`.
- Then reconcile local `main` with `origin/main`.
- After that, continue the resource-manual-verification pass and cron setup.

### Commits

- No new commit created in this session.
- Relevant current branch points:
  `8ef052b` local HEAD, `429d6cb` on `origin/main`.

## 2026-05-21

### Previous session

- Added scrape-assisted resource review tooling without making scraped data the
  source of truth.
- Added `sourceUrl` to the maintained resource records in
  `src/data/referrals.json` and `src/data/crisis-resources.json`.
- Added `npm run resources:check`, which fetches each `sourceUrl` and writes a
  human review report to `tmp/resource-review-YYYY-MM-DD.md`.
- Updated resource validation and maintenance docs so the review flow is part
  of the expected workflow.

### Flagged to come back to

- Manually verify the resources flagged in
  `tmp/resource-review-2026-05-17.md`.
- The flagged items from that report were:
  `washington-poison-center`, `nwirp`, `wa-lni-employment-standards`, and
  `wa-dol-id-help-unhoused`.
- After manual verification, set up a scheduled job to run the review tooling
  and surface the report.

### Where things left off

- Local `main` is clean but is currently behind `origin/main` by one commit.
- Local HEAD: `8ef052beb09b795b0096064a4d685c1e35fc7ac3`
  (`Add resource source review tooling`).
- `origin/main` and production `/healthz` are currently at
  `429d6cb2d66851d346ad6fb00cd6355d6cf206fa`
  (`Add QR code generator and static assets for print distribution`).
- That means the repo has moved since the resource-review session and local
  work should start by reviewing or pulling `429d6cb`.

### Next

- Review and pull `429d6cb` into local `main`.
- Manually verify the flagged resource entries and update the resource JSON if
  needed.
- Then add the scheduled report job for the resource review system.

### Commits

- `8ef052b` - `Add resource source review tooling`
- `55c568f` - `Improve conversation button contrast`
- `429d6cb` - `Add QR code generator and static assets for print distribution`
