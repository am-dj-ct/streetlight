# What this project will not do

The "no" list. Re-read before adding anything that feels like it might be on
it. Lives at repo root so any session opening the project encounters it
early.

This list combines the spec's pre-committed "no" list with the architecture
doc's Deliberate Absences. Each entry is a "we don't do this and here's why"
statement. To add something on this list to the project, a future operator,
contributor, or Claude session must actively contradict the listed reasoning
and produce a dated ADR in `docs/decisions/` justifying the change.

---

## Product / business

- **No advertising.** Public utility, not a startup.
- **No paid tier, no subscription, no upgrade flow.**
- **No sponsored content.**
- **No charging partner organizations for access.**
- **No sale of conversation data, even anonymized.** The data does not
  exist to sell. The capacity to sell does not exist either.
- **No branding the tool as "for homeless people."** The framing is the
  politics. The tool is free and accessible; it is not a category-marker.
- **No service directory.** The tool refuses to be a "which shelter has
  beds tonight" oracle and refers those questions to humans. This is a
  product decision, not an architecture limitation.

## Identity / accounts

- **No accounts, no login, no email, no phone, no signup.** No user table,
  no session table, no auth code.
- **No `partner_id`, no `organization_id`.** Partners are not data
  entities. Aggregate-by-organization metrics do not exist by design.
- **No `user_id`.** Users are not entities in the system.
- **No collection of identifying user data for any reason.**

## Logging / observability

- **No content logging, ever.** No request bodies, no message contents, no
  responses, no classifier inputs, no classifier reasoning text.
- **No debugging toggle for content logging.** No env var, no feature flag,
  no "temporary mode." The toggle does not exist by design.
- **No third-party error reporting.** No Sentry, Datadog, Bugsnag,
  LogRocket, New Relic, Pingdom. Errors caught locally with metadata-only
  logs, surfaced through Vercel-native runtime logs.
- **No analytics.** No Google Analytics, Plausible, Fathom, Vercel Web
  Analytics, Vercel Speed Insights.
- **No Log Drains.** No Logflare, Axiom, Datadog log forwarding.
- **No automated harm-detection systems.** No anomaly detection on content,
  no sentiment classifiers, no automated red-flagging beyond the
  weak-category classifier explicitly defined in the spec.
- **No cookies, no localStorage tracking, no fingerprinting.** Only
  persistent browser-side storage is what the user explicitly creates via
  the save flow.
- **No referral tracking, no UTM parameters, no campaign attribution.**

## Persistence

- **No backups.** Nothing user-shaped is stored that could be backed up.
- **No conversation history server-side.** Fresh start every visit.
- **No CRM, partner database, or partner organization tracking.**
- **No user feedback storage.** Bug reports go to operator's email, are
  read, acted on, not stored. Incident write-ups are the artifact.

## Refusals / gating

- **No refusal categories beyond the safety floor.** The model does the
  work. Where the model is known to get things wrong, an honest
  weak-category note appears below the response and a "find a human" button
  surfaces routed referrals. Refusal is replaced by honesty plus referral.
- **No purpose-locking refusals.** Code, homework, anything else — the tool
  helps. The access gap is not reproduced inside the tool.
- **No keyword-based crisis detection layer. No classifier-based crisis
  routing. No UI override.** The model handles crisis disclosures with its
  trained behavior. Crisis numbers are visible in the persistent footer.
- **No geofence, region-locking, or access control.**

## Distribution / framing

- **No app store presence.** Mobile web only. Lost or replaced phones do
  not require re-install.
- **No push notifications, ever.** Users come to the tool when they need
  it; the tool does not reach out.
- **No public marketing push, QR-code distribution at scale, or Hacker
  News launch in V1.** Soft-launch through named partners only.

## Architecture / governance

- **No admin panel.** Vercel's dashboard is the only admin surface.
- **No phone home, no telemetry to the operator.** The deployed tool does
  not send signals back beyond named hops (Anthropic, Vercel native logs).
- **No A/B testing or experimentation framework.** One version ships.
- **No recommendation engine, personalization, or per-user model tuning.**
  Same model, same prompts, same classifier for everyone.
- **No API offered to third parties.** Other projects fork the
  open-source code; they do not consume an API.
- **No federation, no multi-tenancy, no white-labeling.** One tool. Other
  organizations fork and run their own deployments.
- **No ML or analytics on classifier categories beyond aggregate counts.**

---

## How to add something to this list

If during development a temptation emerges that should be permanently
foreclosed, add it here with the reasoning. The list grows over time as
new failure modes are imagined.

## How to remove something from this list

Open `docs/decisions/`, write a dated ADR with the question, options
considered, decision, and reasoning. Update `docs/data_architecture.md` if
the change is privacy-relevant. Update this file. The override happens
through deliberate, multi-step action — never through a quiet code change.
