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

- Read `HANDOFF.md` and `docs/access_tool_thesis.md` before starting the
  Streetlight branding interview.
- Ran a one-question-at-a-time interview focused on ethos, branding, voice,
  visual direction, and public-facing messaging foundations rather than design
  production.
- Landed the core brand stance:
  Streetlight should feel like help through the dark, not "ChatGPT for poor
  people," not paternalistic, and not like a stripped-down charity-tech tool.
- Landed the voice:
  a calm, competent friend who is matter-of-fact, honest, useful, and does not
  bullshit the user.
- Landed the primary messaging direction:
  `Free AI for anyone` should lead, with supporting language around help with
  real-life problems and concrete tasks such as understanding a letter or form
  and figuring out what to do next.
- Confirmed that AI should be explicit and central in the message, not hidden
  or softened.
- Confirmed the trust posture:
  Streetlight should present itself as a thinking partner, not an oracle, and
  honesty about uncertainty is a key feature; the example phrasing the user
  liked was `Here's my best read`.
- Confirmed the brand should feel universal first, with the access-inequality
  politics staying underneath rather than being foregrounded on user-facing
  materials.
- Landed the visual direction:
  public-utility-first, noticeable at a distance, readable above all else,
  slightly unusual, and visually grounded in `dark field with warm light`,
  `nighttime urban`, and `warm against the dark`.
- Confirmed the graphic system should avoid photos and people, use a geometric
  utility-sign-like base, and use a defined outward glow as the main motif.
- Produced a compact brand/messaging foundation in chat that can be used as the
  basis for the next design session.

### Flagged to come back to

- Turn the approved brand foundation into actual business-card and flyer
  concepts in the next session.
- Keep the headline/value hierarchy centered on:
  `Free AI for anyone`, then practical task examples, then `No login`, with
  `Streetlight` acting more like a quiet signature than the main headline.
- Keep the first believable use case grounded in `Understand a letter or form`,
  while making the broader promise visible with adjacent examples like
  `Figure out what to do next`.
- Preserve the visual guardrails:
  no corporate gloss, no government brochure energy, no bleakness, no
  futurism, no photos/people.
- Existing print constraints from the prior session still apply:
  first batch likely `500` standard matte two-sided business cards and a few
  dozen low-cost `8.5 x 11` flyers for King County distribution.

### Where things left off

- No design files or saved branding docs were created in the repo during this
  session; the outcomes currently live in the chat transcript.
- The repo working tree was otherwise clean before this `HANDOFF.md` update.
- Local `main` was ahead of `origin/main` by two commits at session start:
  `bf6f135` (`Review resource sources and schedule weekly checks`) and
  `3b4a601` (`Update handoff for outreach planning`).

### Next

- Commit this `HANDOFF.md` update.
- In the next session, translate the brand foundation into concrete business
  card and flyer concepts and draft copy.
- Use the existing QR assets in `public/assets/qr/` when the print layouts are
  built.

### Commits

- `3b4a601` - `Update handoff for outreach planning`
- `bf6f135` - `Review resource sources and schedule weekly checks`
- This handoff update should be committed next.

## 2026-05-21

### Previous session

- Finished the first logistics/planning conversation for Streetlight printed
  outreach materials.
- Confirmed the QR-code work from `429d6cb` is a self-contained generator plus
  static assets for `https://streetlight.help`, intended for print use.
- Researched current vendor/format constraints for a small King County print
  run:
  `500` business cards, a few dozen `8.5 x 11` flyers, and optional cheap paper
  posters later.
- Settled the first-run logistics baseline:
  King County first, budget about `$300-500`, business cards and flyers from
  the start, posters only later if they are cheap and clearly useful.
- Settled working print specs:
  business cards should be standard wallet size, two-sided, matte, about
  `500`; flyers should be standard `8.5 x 11` on low-cost paper.
- Clarified that the print materials should speak directly to the person using
  Streetlight, not to staff, even though case managers and partner sites may
  hand them out.
- Clarified that AI should be explicit and part of the draw. The message should
  not hide or soften that this is AI; it should tell people that free AI help is
  for them too, without sounding preachy.
- Chose a working message direction:
  "Need help figuring something out?" plus a clear invitation to try free AI
  help, with exact copy still undecided.
- Chose lived-question examples over category labels as the stronger direction,
  especially for flyers/posters. Examples should map to the site's entry
  points, such as understanding a letter, writing something, figuring out what
  to do first, preparing what to say/bring/ask, or making a plan.
- Decided multilingual support should be a single universal version per format,
  with English primary and translated key points on the same piece. Exact
  languages and copy are still undecided.
- Decided approval can be internal: the user and Malia can eyeball drafts and
  greenlight the first print batch. Partner feedback is useful but not a
  required gate before printing.
- Decided the next session should focus on design, branding, messaging, ethos,
  and vision for Streetlight. The session after that should turn those decisions
  into business-card and flyer designs.

### Flagged to come back to

- Next chat should begin by reading `HANDOFF.md` and
  `docs/access_tool_thesis.md`.
- Next chat should interview the user one question at a time to arrive at a
  Streetlight ethos/branding/vision before making design files.
- Do not jump straight into business-card/flyer layout in the next chat; the
  next chat is the brand and messaging foundation.
- Later, turn the approved direction into actual card and flyer layouts using
  the existing QR assets in `public/assets/qr/`.
- Posters remain optional and should only be considered after cards/flyers if
  they are cheap and add clear value.

### Where things left off

- Local `main` is ahead of `origin/main` by one commit:
  `bf6f135` (`Review resource sources and schedule weekly checks`).
- `HANDOFF.md` is being updated again and should be committed as a tracked repo
  artifact.
- No print-design files have been created yet.

### Next

- Commit this `HANDOFF.md` update.
- In the next session, run a one-question-at-a-time interview to define
  Streetlight's design/branding/messaging foundation.
- In the following session, use that foundation to create print-ready or
  vendor-ready business-card and flyer designs.

### Commits

- `bf6f135` - `Review resource sources and schedule weekly checks`
- This handoff update should be committed next.

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
