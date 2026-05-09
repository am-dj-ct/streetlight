# Data and Privacy Architecture

**Last reviewed:** 2026-05-09
**Last meaningful change:** 2026-05-09 (model tiering, generated follow-ups, no-cookie language routing, and weak-category coverage landed)
**Next scheduled review:** 2026-08-07 (quarterly)

---

## Triggers That Demand a Non-Scheduled Re-Read

Open this document and re-read it before any of the following land:

1. Any change to the model provider (Sonnet → something else, Haiku → something else, adding a fallback provider).
2. Any change to the persistence layer (adding Supabase, adding a new KV namespace, adding any database).
3. Any change to logging surface (adding Sentry, adding a Log Drain, adding analytics, even "just for this one debug session").
4. Any change to authentication, accounts, or user identification (the project has none of these — adding any is a fundamental shift).
5. Any change to refusal behavior or classifier behavior (categories, thresholds, prompt design).
6. Any change to the kill switch mechanism.
7. Any new secret being added to the env var set.
8. Any change to who has operational access (new bus-factor person, new collaborator, anything that expands the access list).
9. Funding or institutional partnership conversations that might shift the project's structure.
10. Any incident at Sev-1 or Sev-2 — the post-mortem reviews this doc as part of the write-up.

When any of these trigger, the change requires a dated entry in `docs/decisions/` and an update to this doc's "last reviewed" and "last meaningful change" dates before the change lands.

---

## Purpose and Scope

This document is the architectural foundation for the Access Tool — a free, public, mobile-web tool that puts a frontier LLM in the hands of people experiencing homelessness, housing insecurity, or extreme poverty in Seattle / King County.

It exists to:

- Brief any future Claude Code session on how the system is built and why.
- Govern decisions about logging, persistence, third-party services, and operator behavior.
- Provide the canonical privacy explainer text used in the user-facing privacy page.
- Serve as the structural reference for the threat model, incident response, and operator commitments.

It is paired with two other documents at the repo root:

- `CLAUDE.md` — entry point for future Claude Code sessions, contains a load-bearing cross-reference to this document.
- The V1 spec (`access_tool_v1_spec.md`) and the thesis (`access_tool_thesis.md`) — the project's ethos and product definition.

When this document and the spec disagree, the spec defines what the tool is and this document defines how it is built and operated. The Spec Reconciliation section below tags every architectural decision as confirming the spec, extending it, or new.

---

## Operator Context

This is unusual to put in writing. It's here on purpose.

The operator (Jesse, the builder) is self-taught, approximately three months into serious agentic-engineering work, with no prior formal technical training. He has shipped production projects, is comfortable with Next.js, Supabase, Vercel, and Twilio at a working level, and uses Claude Code as his primary dev environment.

The architecture in this document is deliberately shaped to accommodate that reality. Specifically:

- Operations happen through Vercel's dashboard, not the CLI, by default. The kill switch, env var management, and runtime log review are all dashboard-driven.
- The runbook is screenshot-driven, phone-friendly, and assumes no command-line fluency under stress.
- Recommendations from future Claude Code sessions should be calibrated to this context. Suggestions that assume CLI fluency, advanced DevOps practices, or significant infrastructure complexity should be flagged as such, with the simpler dashboard-based alternative offered first.
- The bus-factor person is also non-technical-by-training. Operational procedures must be executable by them.

This is not a permanent state — operator skill grows over time. But for V1 and likely V2, the architecture privileges simplicity, dashboard operability, and minimum viable infrastructure.

A future session that finds itself recommending Kubernetes, custom CI pipelines, Terraform, complex observability stacks, or anything that requires a DevOps mindset should pause and reconsider. The right answer is almost always simpler than the recommendation feels.

---

## Non-Negotiables

These are the privacy-ethos lines that govern every architectural decision in this document. They derive from the thesis and spec and are immutable without a formal review.

- **No PII retention.** PII enters conversations by necessity (users will paste letters with names and addresses) but must not persist in any system the project controls.
- **No identity association.** Conversations are not tied to a user. There is no user table, no session table, no account.
- **No surveillance posture.** Logs exist to debug operational issues, not to monitor users. Detection of issues is human, not algorithmic.
- **Honesty in the privacy explainer.** Whatever's true is what we say. If we cannot make a clean privacy claim, the design changes — not the language.
- **Treat the user as a normal capable adult.** Architecturally and communicationally. No surveillance, no patronizing, no protective gating.

---

## Threat Model

The architecture is designed to defend against eight specific threats. For each: the threat, what's exposed under the current design, the mitigation, the residual risk we accept.

### Threat 1: Subpoena / Legal Compulsion

**Scenario:** A user is in immigration proceedings, an eviction case, a child custody dispute, or a criminal investigation. An attorney, prosecutor, court, or government agency issues a subpoena to compel records about that user.

**Exposure:**
- We have no user identity. A subpoena ("records for John Doe") cannot be linked to anything in our system.
- We have no conversation content. Nothing to hand over.
- Hashed IPs in the rate-limit KV with daily TTL. After 24 hours, the hash is gone. Even within 24 hours, the hash is one-way.
- Aggregate metadata in Vercel runtime logs (3-day window): hashed IP, timestamp, button tapped, language, classifier category, model used, token counts. No content. No identity.
- Anthropic has the conversation content for 7 days. A subpoena to them, not us, could compel that.

**Mitigation:**
- Hashed IP with daily TTL is the structural defense. After 24 hours there is nothing to subpoena even if compelled.
- The hashed-IP salt rotates quarterly. Old hashes cannot be re-derived from a current salt.
- We operate no user-of-record system. There is no account a subpoena can name.
- Policy answer to a subpoena: "We don't have what you're asking for. Here's our public architecture document showing why."

**Residual risk accepted:**
- A subpoena lands on Anthropic for the 7-day window. We cannot prevent that; the privacy explainer is honest about it.
- A fast subpoena (within 24 hours of a session) plus a salt-disclosure order plus a known IP could in theory show that a specific IP used the tool in a specific window. No content, no identity beyond the IP. Narrow scenario, minimal harm.

### Threat 2: Anthropic Compromise

**Scenario:** Anthropic suffers a breach, internal access incident, or regulatory action exposing customer data.

**Exposure:**
- 7-day rolling window of conversation content on Anthropic's side is the worst-case exposure.
- Anthropic sees: prompt content, response content, our API key, the source IP of the API call (Vercel's, not the user's).
- Anthropic does not see: the user's actual IP, our hashed-IP salt, our metric logs, anything we do post-response.
- Trust & safety classifier scores retained 7 years on Anthropic's side. Out of our control.

**Mitigation:**
- Choosing Anthropic is itself a mitigation: 7-day default, no training use on commercial API, ZDR available, transparent published policy.
- Privacy explainer is honest that this hop exists.
- ZDR pursuit at month 9–10 closes most of this exposure forward.

**Residual risk accepted:**
- 7 days of content on Anthropic's side. Accepted because Anthropic is the cleanest available option, the alternative (no AI tool) is worse for users, and the privacy explainer doesn't hide it.
- 7-year classifier scores. Accepted as low-harm metadata (scores + timestamps + our org ID, no content).
- Treating users as adults — they are informed in plain language and trusted to make their own call about what to type.

### Threat 3: Vercel Compromise

**Scenario:** Vercel breach, deployment compromise, stolen Vercel auth token, platform-level vulnerability, or rogue Vercel employee accessing our project.

**Exposure (going forward):**
- Attacker can read environment variables: Anthropic API key, Turnstile secret, hashed-IP salt, Vercel KV credentials.
- Attacker can deploy code, including stealth content-logging code.
- Attacker can intercept live request traffic.
- Attacker can exfiltrate Vercel KV: rate-limit counters, daily spend tracking, kill switch state. No content there.

**Exposure (from the past):**
- Vercel runtime logs (~3 days): aggregate metadata only. No content.
- Vercel KV entries that haven't TTL'd out yet.
- Source code (open-source anyway).
- No conversation content recoverable from history because none was ever stored.

**Mitigation:**
- The architecture has no historical content to leak. The "no content logging ever" decision does structural work here.
- Hashed-IP salt rotates quarterly; an exfiltrated salt has bounded utility.
- 2FA on Vercel, 2FA on GitHub, hardware security key where supported.
- Kill switch enables ~30-second tool disablement on detection of compromise.

**Residual risk accepted:**
- Sophisticated attacker who pushes a stealth deploy could log content silently for some window before detection. Detection is human and slow. Accepted because the alternative (always-on third-party security monitoring) is worse for privacy posture.
- Open-source code lets attackers study the architecture before attacking. Accepted because open-source is non-negotiable for the project ethos.
- Vercel itself is a closed system. Accepted on the basis of published policy, the same way Anthropic is accepted.

### Threat 4: Malicious User / Abuse

**Scenario:** Someone uses the tool with bad intent — budget drain attack, scraping for free Claude API access, prompt injection, harassment proxying, attempts at illegal content generation, infrastructure reconnaissance.

**Exposure:**
- Budget drain capped by daily spend ceiling. Worst case: tool hits cap early, real users see "today's limit reached, try again tomorrow."
- Scraping: contained by output token cap and daily cap.
- Prompt injection: nothing to inject toward — no tools, agents, file system, or shell connected to user input. System prompt is open-source, no secrets.
- Harassment / illegal content: handled by Anthropic's safety floor.
- Infrastructure recon: Vercel platform protections, Turnstile.

**Mitigation:**
- Per-IP rate limit (~100 turns/day).
- Cloudflare Turnstile (invisible captcha, no friction, blocks scripted abuse).
- Output token cap (~1500 per response).
- Daily total spend cap with hard ceiling.
- Tiered model fallback (Sonnet → Haiku → cheapest viable → hard cap).
- Manual kill switch.
- Anthropic's safety training as the floor for content-level abuse.

**Residual risk accepted:**
- Determined budget-drain attacker can cap the tool for the day. Accepted because the alternatives (account systems, identity verification, Cloudflare WAF) violate the access ethos.
- Tool helps draft adversarial letters. By spec, this is a feature — the SOMA engineer's tool helps him draft adversarial letters too.
- Everything beyond budget drain is downstream of using a frontier LLM and is governed by Anthropic's safety floor. We do not add a refusal layer on top because it violates the spec.

### Threat 5: Hostile Partner Organization

**Scenario:** A partner organization (shelter, housing program, clinic, library) turns adversarial — leadership change, contractual pressure from funders, investigation of a specific resident, or simply institutional curiosity about user behavior.

**Exposure:**
- Partners have the public URL. Same access any user has.
- No admin panel. No partner accounts. No `partner_id` field anywhere because partners don't onboard, sign agreements, or get accounts.
- Partners cannot request "show me everything Resident X has typed." That data does not exist. Resident X is not an entity in our system.
- Aggregate-by-organization metrics do not exist.

**Mitigation:**
- Architectural. There is no `partner_id` because partners are not data entities. There is no admin view because there is no admin role. Hostile partner mitigation is structural, not policy.
- Communicational. Partners are told upfront: "We do not have data tied to your organization. If your funder asks for usage data tied to your shelter, we cannot provide it."
- Kiosk-toggle / shared-device mode in the save flow protects users on partner-loaned devices.

**Residual risk accepted:**
- A partner with kiosk computers can monitor their own clients' use of the tool on their own hardware. Out of our control. The save modal's shared-device warning is the structural response.
- A hostile partner can damage adoption in their network. Project-survival risk, not privacy risk. Soft-launch with friendly named partners is partly a hedge.
- Honesty of "we don't have that data" depends on the architecture staying this way. The "no" list and ADR directory are designed to prevent drift toward partner-tagging features.

### Threat 6: Coercive Partner

**Scenario:** An individual case manager, controlling intimate partner, family member, probation officer, or other person with personal-relationship power pressures a user to disclose what they typed into the tool.

**Exposure:**
- The user controls the device. Whatever's on the screen at the moment of coercion is visible. We cannot change that.
- Saved conversations on the device are visible to anyone with device access.
- In-memory conversation during active session is visible to anyone shoulder-surfing.
- After session ends, in-memory state is gone. Browser history shows the URL was visited, not what was typed.
- We have no server-side conversation history a coercer could compel "log in and show me."

**Mitigation:**
- No persistent server-side history. No accounts. No "log into your account" path.
- No automatic save. Save is opt-in with a one-time honest modal explicitly naming the shared-phone risk.
- Save modal language: "If this is a shared phone, library computer, or borrowed phone: don't save here." Users are pre-warned.
- Email-to-self alternative routes saved conversations through the user's existing email trust relationship.
- Fresh-start default. No login state. The conversation footprint is minimal after a session ends.

**Residual risk accepted:**
- Coercion at the moment of use is unaddressable by software design. The user is in a power dynamic that's bigger than the tool.
- Users on shared devices who save against the modal's advice have left a trail we cannot retroactively clear.
- Plausible deniability through fresh-start is real but limited. Architectural verification of "have you used this tool" cuts in either direction.

### Threat 7: Builder Compromise

**Scenario:** Operator's laptop is stolen. GitHub gets compromised. Phishing succeeds against Vercel auth. Anthropic dashboard credentials leak. SSH key leaks. Terminal left unlocked.

**Exposure (laptop / dev machine):**
- Local `.env.local` files contain secrets: Anthropic API key, Turnstile secret, hashed-IP salt, Vercel KV credentials.
- Local repo clone (open-source, no real loss).
- Browser sessions to Vercel, Anthropic, GitHub.
- No production user data on any machine because there is no production user data.

**Exposure (GitHub):**
- Source code (public).
- Any accidentally-committed secrets — failure mode.
- Push access to main → auto-deploy via Vercel → highest-impact path.

**Exposure (Vercel auth):**
- Full deploy access. Read access to env vars. Read access to runtime logs. Ability to disable kill switch.

**Exposure (Anthropic console):**
- View usage and billing. Generate / revoke API keys. **Read the 7-day API request log on Anthropic's side — only path where conversation content is reachable.**

**Mitigation:**
- 2FA on everything: GitHub, Vercel, Anthropic console, recovery email.
- Hardware security key as second factor where supported. SMS 2FA avoided.
- `.gitignore` discipline plus pre-commit secret scanning (`gitleaks` or `trufflehog`).
- No long-lived secrets in committed code. `.env.example` shows variable names with empty values.
- Quarterly hashed-IP salt rotation, annual Anthropic and Turnstile rotation.
- Bus-factor person has minimum-viable credentials (Vercel team-member, Anthropic billing-only, GitHub collaborator) — enough to keep the tool running, not enough to fully compromise it.
- Kill switch as failsafe.
- Detection is human: Vercel deploy notifications (configure on every production deploy), Anthropic billing alerts (configure daily spend threshold), GitHub security alerts.

**Residual risk accepted:**
- Sophisticated targeted phishing could compromise multiple credentials before detection. 2FA + hardware key is the highest-leverage mitigation.
- Anthropic console compromise gives 7-day conversation log access. Accepted because Anthropic is the only LLM provider in the design.
- Bus-factor doubles attack surface. Accepted tradeoff for continuity.

### Threat 8: Curious Operator

**Scenario:** Operator (current, future-self, or future Claude Code session) decides to peek at conversation content. Not adversarial — curious. "I wonder what people are using the tool for." "Just one quick look to debug this." "Let me read a few sessions to see if the new system prompt is landing."

**Exposure:**
- No content logs to read. The `/api/chat` route never persists conversation content. There is no log file, KV entry, database row, or third-party log destination that contains messages or responses.
- No debugging toggle. Option (a) was chosen specifically to close this surface. There is no env var, feature flag, or "temporary debug mode" that turns on content logging. The toggle does not exist.
- No admin panel. No UI in the project shows recent traffic, recent conversations, or per-session detail.
- Vercel runtime logs show metadata only.
- **Anthropic dashboard shows 7-day request logs.** This is the one place where actual conversation content is reachable by an operator with valid credentials. Not under our architectural control — Anthropic provides this view to API customers.

**Mitigation:**
- Architectural removal of temptation in our own infrastructure: done. Future-you cannot peek at our content logs because there are none.
- "No" list and ADR directory: future Claude Code sessions encounter explicit, dated decisions before drifting toward content logging.
- ESLint rule: future code that calls `console.log(messages)` or similar fails the build.
- ZDR pursuit at month 9–10 would close the Anthropic dashboard exposure entirely.
- **Self-discipline on the Anthropic dashboard:** the residual mitigation. See Operator Commitments below.

**Residual risk accepted:**
- The Anthropic dashboard window is a privacy failure point that depends on operator self-discipline. Accepted because (a) the privacy explainer is honest about messages touching Anthropic, (b) pre-ZDR, this is the design as stated, and (c) the written commitment in this document is the structural anchor.
- A future Claude Code session in good faith but without reading this doc could propose a logging change. The "no" list, ADR directory, ESLint rule, and CLAUDE.md cross-references are layered defenses. None is absolute. Combined posture is strong but not perfect.
- A future-you under stress could rationalize "just this once." Hardening is designed to require deliberate, multi-step action rather than a single click.

---

## Spec Reconciliation

Decisions in this document either confirm the V1 spec, extend it, or add something new. Tagging is explicit so a future reader can always trace authority.

### Confirmed (spec said it, this doc agrees)

- Anonymous by default, no account, no email, no phone, no PII retention.
- No conversation content stored server-side; fresh start each visit.
- No keyword crisis detection layer; no classifier-based crisis routing.
- No refusal categories; classifier flags weak categories with honest "find a human" surfacing.
- Default model Sonnet 4.6, Haiku 4.5 for classifier pass.
- Tiered model fallback: Sonnet → Haiku → cheapest viable → hard cap.
- Per-IP rate limit ~100/day; Cloudflare Turnstile; output token cap; daily spend cap; manual on/off switch.
- Open source from day one.
- Static UI strings as JSON per language; conversation translation handled by model.
- Geo-awareness via Vercel headers, no permission prompt.
- Save is opt-in, client-side only, with shared-phone honesty modal.

### Extended (spec said something compatible, this doc made it more specific)

- Privacy explainer: drafted in 6th-grade plain language, names Anthropic explicitly, names the 7-day retention. (Spec required the explainer; this doc provides the canonical text.)
- ZDR conversation: launch with Anthropic 7-day default, pursue ZDR + credits at month 9–10. (Spec said ZDR conversation goes alongside credits ask; this doc commits to the order and timing.)
- Server logs metadata only: exact metadata schema specified (timestamp, model, tokens, classifier category, response time, status, language, button id, hashed IP).
- Classifier metadata logged, input not: label-only classifier output (no reasoning text), specified.
- Debugging policy decision: option (a) — no content logging ever, no toggle.
- Cloudflare Turnstile: script-only mode, no proxy in front of Vercel.

### New (spec did not say, this doc decides)

- Cloudflare Turnstile script-only versus full proxy: script-only.
- Vercel plan: Pro.
- Vercel logging discipline rules (eight-rule list in Vercel section).
- No Supabase for V1; Vercel KV for rate limit / spend / kill switch; static JSON for referrals and translations; metrics as runtime logs.
- Hashed IP with secret salt, daily TTL.
- Synthetic regression suite per button system prompt.
- Partner bug-report template (5-question structured intake, no content paste).
- Model snapshot pinning via env var.
- Pre-deploy smoke check script.
- ESLint rule against logging Claude API request/response objects.
- ADR directory at `docs/decisions/`.
- "No" list at repo root.
- Eight-threat threat model.
- Three-tier incident framework with public `incidents/` directory.
- Two-switch kill design (soft + hard, both env-var-driven, dashboard-only).
- Operational runbook as P0 deliverable, screenshot-driven, practice-runned.
- Bus-factor person scope (minimum-viable credentials, briefed and rehearsed).
- Operator-context note acknowledging self-taught builder.
- Curious-operator written commitment about the Anthropic dashboard.
- Quarterly hashed-IP salt rotation, annual Anthropic and Turnstile rotation.
- Public incidents directory with 7-day post-mortem commitment for Sev-1/Sev-2.

---

## Full Request Flow

Every hop a user message takes from the moment they tap send to the moment a response renders. Text-only, paste-able into other chats.

**Implementation note as of 2026-05-07:** The current codebase implements the
core V1 request path: browser memory state, backend `/api/chat`, the main
Anthropic Messages API call, the Haiku classifier pass, the inline
weak-category UI note, KV-backed per-IP rate limiting, daily spend tracking,
the soft/hard pause controls, Cloudflare Turnstile validation, and the fixed
allowlisted per-turn metadata log in Vercel runtime logs.

### User Action: Tap Send

User has typed (or dictated via Web Speech API → text in browser) a message in the conversation screen. Button selection from the landing page is in the conversation's system prompt context. Conversation history is held in browser memory (React state) — not persisted server-side.

### Hop 1 — User's Browser (Phone)

- **Runs:** Next.js client-side React, the conversation UI.
- **Has access to:** Full conversation history for the current session (in-memory state), user's typed/dictated message, button selection that started the conversation, language setting, optional saved conversations (only if user explicitly saved — `localStorage` or generated text file/screenshot the user kept).
- **Logs by default:** Browser console (dev tools only). Browser history records the URL but not message content (we never put content in URL params).
- **Override:** No analytics/telemetry SDK is loaded. No Google Analytics, no Vercel Analytics, no Sentry, no PostHog. Page loads zero tracking pixels.
- **What leaves this hop:** HTTPS POST to `/api/chat` containing conversation history (system prompt + prior turns + new user message), language code, button-selection metadata, and a Cloudflare Turnstile token when Turnstile is configured. In local development without Turnstile keys, no token is sent. No user identifier, no session ID, no cookie. Language routing uses explicit `?lang=` links or the browser `Accept-Language` header; it does not set a language cookie.

### Hop 2 — Cloudflare Edge (Turnstile Only)

- **Runs:** Cloudflare's Turnstile validates the invisible captcha token when our Vercel function calls Cloudflare's `siteverify` endpoint. **Script-only mode — Cloudflare is not proxying the full chat request.** The user's actual message body never passes through a Cloudflare proxy.
- **Has access to:** The Turnstile token and the source IP attached to the verification call. Not the request body.
- **Logs by default:** Cloudflare keeps standard Turnstile validation logs (token validity, source IP at the moment of the validation call). Not configurable to "off."
- **Override:** No Cloudflare Workers in the body path. No Logpush. Standard Turnstile-only deployment.
- **What leaves this hop:** A validation result (token valid / invalid) back to Vercel. If Turnstile keys are absent, this hop is inactive and the request proceeds without a token.

### Hop 3 — Vercel Edge / Serverless Function (`/api/chat`)

- **Runs:** Next.js API route, serverless or edge function on Vercel. Validates Turnstile token server-side, applies per-IP rate limit check, applies daily spend cap check, selects model tier, constructs Anthropic API request, calls it, awaits response, fires off classifier pass, returns response to client.
- **Has access to:** Full request body including conversation history with whatever PII the user pasted in, source IP (from headers), Anthropic API key (env var), Vercel KV credentials, model tier state.
- **Logs by default:** Vercel runtime logs capture `console.log`/`console.error` output, request metadata (path, status, duration, region), uncaught exceptions including stack traces. **Critical: Vercel does not log request bodies by default.** Bodies appear in logs only if our code puts them there.
- **Override:** Strict logging discipline (see Vercel section below). No `console.log` of message content, ever. Try/catch around Anthropic call logs only error class, status, response time. No `console.error(error)` directly on caught errors.
- **What leaves this hop:** HTTPS POST to `https://api.anthropic.com/v1/messages` with conversation history, system prompt, model name, max_tokens. Plus a separate POST for the Haiku classifier pass after the main response returns.

### Hop 4 — Per-IP Rate Limit Check

- **Runs:** Inside the Vercel function before the Anthropic call. Vercel KV (Redis) stores a counter per hashed IP with daily TTL.
- **Has access to:** Source IP (briefly, to hash), current count.
- **Logs by default:** Vercel KV operations log (GET/SET on key names). Key is the hashed IP, not the raw IP.
- **Override:** Hash IP using `sha256(ip + secret_salt)`. Salt is in env var, never logged. Key store contains only the hash and a TTL counter. Counter resets daily via TTL.
- **What leaves this hop:** Either a "proceed" flag or a 429 response back to the client.

### Hop 5 — Anthropic API (Main Model — Sonnet 4.6 by default)

- **Runs:** Anthropic's infrastructure. Receives conversation, runs the model, returns the completion.
- **Has access to:** Full conversation contents, our API key (identifies our org), source metadata Anthropic chooses to log.
- **Logs by default (under our chosen 7-day retention):** Inputs and outputs auto-deleted after 7 days. Never used for training. Trust & safety classifier scores retained 7 years. Flagged-violation requests retained up to 2 years.
- **Override:** None. We accept the published commercial-API defaults. ZDR pursued at month 9–10 alongside credits conversation.
- **What leaves this hop:** Model completion, returned to our Vercel function.

### Hop 6 — Vercel Receives Response, Fires Classifier and Follow-Up Suggestions

- **Runs:** Same Vercel function. Receives main model response. Fires a second Anthropic API call with Haiku 4.5 and the classifier prompt (label-only, returns one of: legal_procedure, medical_dosing, benefits_eligibility, immigration, drug_interactions, specific_deadlines, specific_dollar_amounts, none). Fires a separate small Haiku follow-up-suggestion pass that returns JSON-only tappable suggestions for the next user turn.
- **Has access to:** Main model output (which may carry PII forward from the user's prompt), classifier prompt.
- **Logs by default:** Same Vercel runtime log behavior as Hop 3. Same Anthropic 7-day retention as Hop 5.
- **Override:** Same logging discipline as Hop 3. No `console.log` of classifier input or output. We log only the classification result label.
- **What leaves this hop:**
  - A metadata log entry: `{timestamp, model_main, model_classifier, classifier_category, main_tokens_in, main_tokens_out, classifier_tokens_in, classifier_tokens_out, suggestions_tokens_in, suggestions_tokens_out, main_response_time_ms, classifier_response_time_ms, suggestions_response_time_ms, main_status, classifier_status, suggestions_status, language, button_id, hashed_ip}`. No content.
  - Response payload to the client containing main model text, classifier category for the inline UI flag, and follow-up suggestion labels.

### Hop 7 — Metadata Log Write

- **Runs:** `console.log(JSON.stringify(metadata))` to Vercel runtime logs. No external destination.
- **Has access to:** Only the named metadata fields.
- **Logs by default:** Vercel runtime logs. Pro plan retains for several days. No Log Drain configured.
- **Override:** Schema is a fixed allowlist. No additional fields written. ESLint rule prevents `console.log` of any Claude API request/response objects.
- **What leaves this hop:** Nothing. End of write path.

### Hop 8 — Response Renders in Browser

- **Runs:** React renders the new message. TTS button appears. Find-a-human button is present (always). If classifier category is non-"none", inline weak-category note renders below the response. If follow-up suggestions are available, up to three tappable suggestions render below the response.
- **Has access to:** Response text, classifier category, prior conversation history.
- **Logs by default:** Browser console only.
- **Override:** None — no client-side analytics.
- **What leaves this hop:** Nothing until the next user turn.

### Side Path — Find-a-Human Button Tap

- **Runs:** Browser fetches static JSON from `/api/referrals?category=legal` (or similar) with a maintained list of King County referral resources, optionally pre-filtered by classifier category.
- **Has access to:** Category parameter, source IP, standard headers.
- **Logs by default:** Standard Vercel access log — path, status, duration, IP. The category is in the URL path.
- **Override:** Served as a static asset where possible. The category in the URL is a UI hint, not user content. No POST body, no headers added, no cookies set.
- **What leaves this hop:** JSON of referral entries. No write path.

### Side Path — TTS Button Tap

- **Runs:** Browser, Web Speech API. Browser's built-in synthesizer speaks the response text. No network call to us.
- **Has access to:** The response text being read aloud.
- **Logs by default:** None on our side. Browser/OS may have its own behavior (out of our control — Web Speech API on some platforms calls cloud TTS services).
- **Override:** None — platform behavior, the alternative (server-side TTS) would require sending response text through a service we'd have to vet.
- **What leaves this hop:** Nothing on our side.

### Side Path — Save Conversation

- **Runs:** Browser-side only. Generates plain-text file the user downloads, screenshot, or `mailto:` link with conversation in the body.
- **Has access to:** Full conversation in browser memory.
- **Logs by default:** None.
- **Override:** Nothing leaves the browser. First-time save modal handles the shared-phone honesty disclosure. `mailto:` opens the user's mail app — email routes through their own provider (their existing trust relationship, not ours).

### Summary of All Touchpoints That See Message Content

1. User's browser (in-memory, optionally saved client-side by user).
2. Vercel function (in-memory during request handling; not logged).
3. Anthropic API — main model (7-day retention).
4. Anthropic API — classifier (7-day retention).

Cloudflare Turnstile script-only mode does not see message bodies.

---

## Anthropic-Side Data Handling

### Default Retention (Confirmed for V1)

For commercial API customers using `/v1/messages`:

- **Inputs and outputs**: 7 days, then auto-deleted. Reduced from 30 days as of September 14, 2025.
- **Never used for training** without explicit opt-in. We have not opted in.
- **Trust & safety classifier scores**: retained up to 7 years. Out of our control.
- **Flagged Usage Policy violations**: retained up to 2 years. Out of our control.

### Why Not ZDR for V1

ZDR is available to enterprise API customers subject to Anthropic approval. It would close most of the Anthropic-side exposure: inputs/outputs not stored at rest after the API response returns, except where needed to comply with law or combat misuse.

We are not pursuing ZDR for V1 because:
- Approval is not guaranteed for a small public-good project.
- Approval timing could delay soft-launch.
- The 7-day default is meaningfully stricter than most providers and acceptable for the harm model.

ZDR pursuit is planned for month 9–10 alongside the Anthropic credits conversation. The two asks are packaged together as a public-good conversation.

### CORS Note

ZDR, when granted, does not support CORS. API calls must go through a backend proxy. Our architecture already does this — the Vercel function is the proxy, the browser never calls Anthropic directly. ZDR adoption would require no architectural change.

### What Changes if ZDR is Granted

- Privacy explainer changes one line: "Anthropic deletes your message within 7 days" → "Anthropic does not store your conversation."
- Threat 2 (Anthropic compromise) residual risk shrinks substantially.
- Threat 8 (curious operator) Anthropic-dashboard exposure closes.
- This document gets a dated entry in `docs/decisions/` recording the change.

### What Does Not Change

- Trust & safety classifier scores still retained 7 years on Anthropic's side, even under ZDR.
- Flagged violations still retained up to 2 years, even under ZDR.
- These are accepted as low-harm metadata.

---

## Vercel-Side Configuration and Logging Discipline

### Plan and Configuration

- **Plan:** Vercel Pro ($20/month).
- **Region:** Default multi-region. No data residency restriction. Tool is intentionally usable from anywhere.
- **Vercel Analytics:** Off.
- **Vercel Speed Insights:** Off.
- **Vercel Web Analytics:** Off.
- **Log Drains:** None. Not configured. Future addition would trigger a re-read of this document.
- **Deploy Notifications:** On (email on every production deploy). Acts as part of the human detection layer.

### What Vercel Logs by Default

- HTTP method, request path, route pattern.
- Status code, response time, region, function type.
- `RequestId`.
- `console.log` / `console.error` output (256KB per line, 256 lines per request, 1MB total).
- Uncaught exception stack traces.

**Vercel does NOT log request bodies by default.** Bodies appear in logs only if our application code puts them there.

### Logging Discipline Rules (the Eight Rules)

These rules are enforced by the codebase and any future Claude Code session. Violation is a privacy incident.

1. **Never `console.log(req.body)` or `console.log(messages)`.** Anywhere. Including dev. Habits leak to prod.
2. **Wrap the Anthropic API call in a try/catch where the catch logs only:** error class, status code, response time, model used, token counts if available, a stable error code we define. Never the request payload, never the response body, never the error's full message if that message could echo content.
3. **Same for the classifier call.** Catch, log only structured metadata.
4. **No `console.log(error)` directly on a caught error from the Anthropic SDK.** Those errors sometimes include the request that failed. Always extract specific safe fields.
5. **Disable Next.js dev-server request logging in production builds** — verify `next.config.js` doesn't enable anything custom that bleeds into prod.
6. **No third-party error reporters.** No Sentry, Datadog, LogRocket, Bugsnag. All default to capturing request/response in their auto-instrumentation.
7. **No Log Drain configured.** Pinned in writing so a future session does not add Logflare or Axiom casually.
8. **No Vercel Analytics, Speed Insights, or Web Analytics.** All would inject client-side scripts capturing page views, user agents, geographic data, and in some configs custom event payloads.

**Current code state as of 2026-05-07:** The `/api/chat` route follows the
no-content-logging rules. It writes one fixed-schema metadata record per send
attempt with only the allowlisted fields from this document, plus separate
structured error records for operational failures. The rate-limit and spend
checks use Vercel KV when the relevant env vars are present; local
development without those env vars intentionally fails open so the app remains
usable on the operator's machine. `SOFT_PAUSE_ENABLED` is checked at the top
of `/api/chat`, and `HARD_PAUSE_ENABLED` is enforced in `src/proxy.ts`.

### Geo-Awareness

- Vercel edge headers (`x-vercel-ip-country`, `x-vercel-ip-country-region`, `x-vercel-ip-city`) are read once per request to select which referral resource list to surface (King County / WA → local; elsewhere → 211 + 988 fallback).
- Headers are read server-side on the initial page render. No client-side permission prompt. No GPS access.
- Headers are never logged, never stored, never passed to the model in the system prompt, never used for analytics or segmentation.

### ESLint Rule

A custom ESLint rule (or pre-commit grep hook) forbids `console.log`, `console.error`, `console.warn` calls whose argument is `req`, `req.body`, `messages`, `response`, `completion`, or any variable matching common Anthropic SDK response shapes. Forbids `console.error(error)` directly — must be `console.error({code, status, model})` with named fields. Cannot be merged if violated.

---

## Persistence Layer

### What V1 Persists

| Data | Storage | Retention | Why |
|---|---|---|---|
| Per-IP rate limit counter (hashed IP) | Vercel KV | 24-hour TTL | Abuse mitigation |
| Daily spend tracking | Vercel KV | Reset daily | Tier selection |
| Kill switch state (soft/hard pause) | Vercel KV or env var | Indefinite | Operational control |
| Aggregate metadata events | Vercel runtime logs | ~3 days (Pro plan) | Quarterly review |
| Referral resource list (JSON) | Static file in repo | Indefinite | UI content |
| UI string translations | Static files in repo | Indefinite | i18n |

### What V1 Does Not Persist

- Conversation content (any of it, ever).
- User identifiers (no accounts exist).
- IP addresses (raw — only hashed).
- Anything that could be aggregated to identify or profile a user.

### Why No Supabase

The V1 spec does not specify Supabase. It was considered and rejected for these reasons:

1. **Privacy surface.** Adding Supabase adds a third party with access to whatever is stored there. The privacy claim is simpler if Supabase is not in the stack.
2. **None of the persistence needs require a relational database.** Rate limiting and spend tracking are KV with TTL. Metrics are append-only event logs. Referrals and translations are static files.
3. **Pre-commits a "no database" architecture that future sessions cannot casually undo.** If Supabase were in the repo from day one, future sessions would reach for it for any "we should track..." feature request. Its explicit absence is a guardrail.

### V2 SMS Bridge Implications

The V2 SMS bridge (Twilio) may require a small persistent table mapping hashed phone numbers to active conversation state. If so, the addition triggers a re-read of this document and a new ADR. The table would be: hashed phone, conversation state (small JSON), TTL. No content, no identity beyond the hash.

### Aggregate Metrics — Tradeoff Accepted

Vercel Pro retains runtime logs for several days, accessible via dashboard and CLI. For quarterly review, logs from earlier in the quarter may be gone. Accepted because:
- The quarterly review is qualitative, not quantitative.
- A 7-day rolling view of session-shape is enough to detect drift.
- Adding a database to preserve metrics longer adds privacy surface the architecture explicitly rejects.

If this tradeoff proves insufficient in practice, fallback options (in order of preference): (a) accept the limitation; (b) monthly manual `vercel logs --since 30d > metrics-YYYY-MM.jsonl` export to a private file; (c) Vercel KV append-list keyed by month with size-bounded retention.

---

## Classifier-Side Handling

### Architecture

- After the main model returns, a second `/v1/messages` call to Anthropic with Haiku 4.5 as the model.
- Classifier prompt requests label-only output: one of `legal_procedure`, `medical_dosing`, `benefits_eligibility`, `immigration`, `drug_interactions`, `specific_deadlines`, `specific_dollar_amounts`, `none`. Nothing else in the response.
- Classifier label drives the inline "AI gets this wrong sometimes" UI flag and pre-filters the find-a-human list.

### What Gets Logged

A single metadata record per turn:

```
{
  timestamp,
  model_main: "claude-sonnet-4-6-YYYYMMDD",  // pinned snapshot
  model_classifier: "claude-haiku-4-5-YYYYMMDD",  // pinned snapshot
  classifier_category,    // one of 8 enum values
  main_tokens_in,
  main_tokens_out,
  classifier_tokens_in,
  classifier_tokens_out,
  suggestions_tokens_in,
  suggestions_tokens_out,
  main_response_time_ms,
  classifier_response_time_ms,
  suggestions_response_time_ms,
  main_status,
  classifier_status,
  suggestions_status,
  language,
  button_id,
  hashed_ip
}
```

No content, no excerpts, no classifier "reasoning."

### What Does Not Get Logged

- Classifier input text (the main model's response, which may carry PII forward from the user's prompt).
- Full classifier output text (only the label).
- Follow-up suggestion input text (the main model's response).
- Full follow-up suggestion raw output text (only sanitized button labels go to the browser).
- Anything that would let us reconstruct what the user wrote.

### Single Source of Truth for Categories

The classifier prompt and the metric schema both reference the enum from `lib/classifier-prompt.ts` (or equivalent). When the prompt changes, the schema changes in lockstep. Drift between the two corrupts metrics.

### Codified Rule

**Never `console.log` a Claude API request or response object directly.** Only named fields from the explicit allowlist above. Enforced by ESLint rule. Violation fails the build.

---

## Debugging Policy

### Decision: Option (a) — No Content Logging Ever

There is no debugging toggle for content logging. There is no env var, feature flag, or "temporary debug mode" that turns on content logging. The toggle does not exist.

Debugging happens against synthetic cases that approximate reported issues. Production stays content-free always.

### Why Option (a)

1. **Privacy claim simplicity.** "We never log your conversation" is a claim a low-literacy user can hold in their head. "We don't log except during temporary debugging windows that auto-purge" requires explanation, requires trust, and is not verifiable from the outside.
2. **Population context.** The user base has been over-surveilled their whole lives. A debugging-window mechanism, however well-intentioned, has the same shape as every "we only access your data when necessary" claim every system that has surveilled them has made.
3. **Actual debugging value of content access is lower than it looks.** The bugs we'd catch are mostly model-behavior bugs, reproducible from a partner's description plus a similar synthetic prompt. Code bugs surface as 5xx errors, timeouts, classifier mismatches, rate-limit weirdness — all visible in metadata.
4. **Toggle is future surface area.** A future operator (you, a future Claude Code session) under stress could rationalize "just turn it on for the day." The architecture enforces the ethos rather than relying on the operator to enforce it every time.

### How Debugging Actually Works Under Option (a)

When a partner reports an issue:

1. Builder asks structured diagnostic questions (see partner bug-report template).
2. Builder attempts synthetic reproduction locally — write a test prompt that resembles the described situation, run against the actual button system prompt and classifier.
3. If reproducible: fix the code, deploy, verify with smoke check, follow up with partner.
4. If not reproducible: log the report in a private bug log, ask partner to capture more detail next time it recurs, monitor metrics for patterns.

Most bugs are reproducible from description. The narrow class that is not (silent quality degradation that doesn't fire errors) is caught by the synthetic regression suite at deploy time.

### Hardening Around Option (a)

The following are P0 build deliverables to ensure option (a) is operationally robust.

#### 1. Synthetic Regression Suite

- Directory `tests/prompts/` with subdirectories per button.
- Each subdirectory contains 5–10 canonical synthetic prompts covering typical and edge cases.
- Each test runs the actual button system prompt + synthetic user prompt against the live API (test mode or separate test API key).
- Assertions: response length within bounds, response in correct language when input language is specified, response doesn't refuse the request, classifier fires correct category for cases where one is expected.
- `specific_deadlines` is reserved for concrete due dates or timing rules, not general urgency language.
- `specific_dollar_amounts` is reserved for concrete dollar amounts, balances, fees, payment plans, bill breakdowns, benefit amounts, income thresholds, or calculations that the user may need to verify.
- Runs on every PR that touches `lib/system-prompts/`, `lib/classifier-prompt.ts`, or model config.
- Fails the build on regression.

#### 2. Partner Bug-Report Template

- Lives in `docs/partners/bug-report.md`. Distributed to partners as Google Doc or printed sheet.
- Five-question structured intake:
  1. Which button did they tap (or "typed their own")?
  2. What language was the conversation in?
  3. What was the user trying to do, in your words?
  4. What did the model say, in your paraphrase? **Do not paste the actual response.**
  5. What felt wrong?
- Plus optional: "Anything else useful for the builder?"
- Submitted via email or simple Google Form (no content collection — structured fields only).
- Builder reviews each report, attempts synthetic repro, files a fix or "can't reproduce yet" note in private bug log.

#### 3. Model Snapshot Pinning

- Use dated snapshot strings (e.g., `claude-sonnet-4-6-YYYYMMDD`), not moving aliases.
- Same for Haiku 4.5 classifier.
- Pinned versions live in env vars: `MAIN_MODEL`, `CLASSIFIER_MODEL`.
- New snapshots are adopted deliberately — change env var, run regression suite, deploy.

#### 4. Pre-Deploy Smoke Check

- Script `scripts/smoke.ts` runs after every deploy.
- Hits 3–4 canonical prompts against the live API endpoint as if it were a user.
- Asserts: 200 status, response present, classifier metadata present, response time under 10 seconds.
- Failure surfaces as Vercel deployment alert (built-in, no third-party tooling).

#### 5. Architecture Decision Records

- Directory `docs/decisions/` with one markdown file per major decision.
- Each file: question, options considered, decision, reasoning, date.
- Future Claude Code sessions open relevant ADR before changing related thing.

#### 6. The "No" List as Code

- File `docs/forbidden.md` (or section in this doc, mirrored).
- Lists what the project does not do, ever (see Deliberate Absences).
- Not enforceable by code, but lives at repo root for any session opening the project.

---

## Key Rotation and Secret Management

### Secrets

| Secret | Purpose | Storage | Rotation |
|---|---|---|---|
| Anthropic API key | Main + classifier + follow-up suggestion API calls | Vercel env var | Annual, or on suspected compromise |
| `MAIN_MODEL` | Pins main model snapshot | Vercel env var | On deliberate model upgrade |
| `FALLBACK_MAIN_MODEL` | Optional main-model fallback after 80% daily spend; defaults to classifier model when unset | Vercel env var | On deliberate model upgrade |
| `CHEAPEST_MAIN_MODEL` | Optional cheapest Anthropic main-model tier after 95% daily spend | Vercel env var | On deliberate model upgrade |
| `CLASSIFIER_MODEL` | Pins classifier snapshot | Vercel env var | On deliberate model upgrade |
| Turnstile secret | CAPTCHA validation | Vercel env var | Annual, or on suspected compromise |
| Hashed-IP salt | One-way hashing for rate limit | Vercel env var | **Quarterly**, or on suspected compromise |
| Vercel KV credentials | Auto-managed by Vercel | Vercel internal | Auto |
| Vercel deploy tokens | Auto-managed by Vercel | Vercel internal | Auto |
| GitHub auth | Repo access | Operator's password manager + 2FA | Standard hygiene |

### Where Secrets Live

- All app-level secrets in Vercel Environment Variables. Production scope. Encrypted at rest by Vercel.
- Local development uses `.env.local` (gitignored). Same variable names with potentially different values.
- `.env.example` committed, contains variable names only with empty values.
- Nothing in code. Nothing in `vercel.json`. Nothing in commit history.

### Access

- **Operator (builder):** full Vercel project, full Anthropic console, full GitHub repo.
- **Bus-factor person:** Vercel team-member (read env vars, flip kill switch, cannot delete project), Anthropic billing-only (see spend, cannot generate keys), GitHub collaborator (cannot force-push to main).

### Rotation Procedure

**Anthropic API key / Turnstile secret:**
1. Generate new value in respective console.
2. Update Vercel env var.
3. Wait for redeploy.
4. Verify smoke check passes.
5. Revoke old value in respective console.

**Hashed-IP salt:**
1. Generate new random value.
2. Update Vercel env var.
3. Existing rate-limit hashes become non-correlatable to the new salt (effectively a fresh start for rate limit, harmless).

**On suspected compromise:**
1. Kill switch (soft or hard depending on severity).
2. Rotate Anthropic key.
3. Rotate Turnstile.
4. Rotate hashed-IP salt.
5. Update Vercel env vars.
6. Verify smoke check.
7. Unkill.
8. File incident write-up.

### Detection Hooks

- Vercel deploy notifications: on (email on every production deploy).
- Anthropic billing alerts: configure daily spend threshold that emails operator on breach.
- GitHub security alerts: on by default.

---

## Kill Switch Design

### Two Switches

**Soft pause** — for operational moments where the tool should stop processing but not disappear.

- Use cases: budget anomaly, traffic spike under investigation, partner-reported issue requiring an hour of attention, brief operator unavailability.
- Mechanism: env var `SOFT_PAUSE_ENABLED` checked at the top of `/api/chat`. When true, route returns 503 with structured disabled-message JSON instead of calling Anthropic.
- User experience: tool's UI loads normally. User taps a button or sends a message. Receives a card from the model side of the conversation:

  > The tool is paused right now while the person who runs it checks on something. Try again later today.
  >
  > If you need help right now: 988 for crisis, 211 for resources, 911 for emergencies.

  Crisis footer remains visible.
- Action time: ~30 seconds via Vercel dashboard env var toggle.

**Hard pause** — for incidents, breaches, or sunset.

- Use cases: confirmed breach, Sev-1 incident requiring public communication, project sunset.
- Mechanism: env var `HARD_PAUSE_ENABLED` checked by middleware that intercepts every request and serves a static page regardless of path.
- User experience: URL serves a single static HTML page:

  > The tool is paused.
  >
  > [Incident-related: brief plain-language description of what happened and what's known.]
  >
  > [Sunset-related: the tool has ended; here's why; here are alternatives.]
  >
  > If you need help right now: 988 for crisis, 211 for resources, 911 for emergencies.
  >
  > Built and run by one person in Seattle. Contact: [bug-report channel].

- Action time: ~30 seconds via Vercel dashboard env var toggle.

### Operator

Two people only: builder + bus-factor person. Both flip switches via Vercel dashboard. No CLI required, no `git push` required.

Partners do not have a kill switch. Partners are in the diagnostic loop, not the operational loop.

### No Silent Recovery

When the tool comes back from a hard pause after a Sev-1 incident, the post-mortem write-up in `incidents/` must be live before the tool is reachable again. The pause page links to the post-mortem before redirecting back to the tool.

### Operational Runbook (P0 Deliverable)

A separate document (`OPERATIONAL_RUNBOOK.md`) is a P0 launch deliverable. Requirements:

- Screenshot every step from the operator's actual Vercel dashboard after deploy.
- Plain language. No assumed knowledge of env vars, redirect rules, or deploys.
- Phone-friendly (PDF or screenshots in operator's phone gallery; printed copy at home).
- Severity decision tree on the first page.
- Bus-factor person's contact info.
- "What to do after" section: notify bus-factor, write down what was seen and when, open `incidents/log.md` when calmer.
- Practice run scheduled before any partner uses the tool. Twice solo, once with bus-factor person.

---

## Incident Response Framework

### Definition of an Incident

Any event meeting one of:

- Suspected or confirmed breach of any system in the data flow (Anthropic, Vercel, GitHub, Vercel KV, dev machine).
- Confirmed accidental content logging — code shipped that violated the no-content-logging discipline, even briefly.
- Anomalous traffic patterns suggesting active abuse beyond rate-limit handling.
- Partner report of a serious quality-of-tool issue affecting users.
- Tool-availability outage exceeding 24 hours.
- Anything where the operator finds themselves thinking "this might be an incident."

The bar for declaring is low. Cost of declaring something that turns out to be nothing: small. Cost of not declaring something that turns out to be real: high.

### Severity Tiers

**Sev-1 — live user harm or active breach.** Confirmed content leak, active attack in progress, partner reports a user was actively harmed by a response. Response: immediate.

**Sev-2 — suspected harm or breach, or significant tool dysfunction.** Suspected compromise without confirmation, classifier broadly miscalling categories, tool down for hours, serious partner report short of "user actively harmed." Response: within hours.

**Sev-3 — anomaly, near-miss, or operational issue.** Weird traffic patterns, single-instance partner concern, billing anomaly, dev-machine compromise where production wasn't reached. Response: within the day.

### 60-Second Action

- **Sev-1 / Sev-2:** Kill switch first (soft or hard depending on context). Thinking happens after.
- **Sev-3:** Kill switch may or may not be appropriate. Default no, err toward yes if uncertain.

### Communication Plan

**Audience priority order: partners → users → public.**

- **Partners** (Malia, Jennifer, Gary, others as engaged): notified within 24 hours of any Sev-1 or Sev-2. Within a week for Sev-3 affecting users they referred. Plain-language, names what happened, what's known and unknown, what's changing.
- **Users**: Sev-1 affecting user data triggers a banner on the landing page within 24 hours. Sev-2 may or may not warrant a banner. Sev-3 typically does not.
- **Public**: any Sev-1 or Sev-2 produces a public post-incident write-up within 7 days, committed to `incidents/YYYY-MM-DD-shortname.md`. Sev-3 may or may not.

### Post-Incident Write-Up

Sev-1 and Sev-2 produce a write-up within 7 days of resolution. Public. Honest. Committed to `incidents/YYYY-MM-DD-shortname.md`. Includes:

- Timeline of events.
- What we knew when.
- What we did and why.
- What worked, what didn't.
- Changes being made to prevent recurrence.
- What we're explicitly not changing and why.

Sev-3 incidents get a one-paragraph entry in `incidents/log.md`.

### Public Incidents Directory

The `incidents/` directory is part of the open-source repo. Public. Searchable. Linked from the privacy page when relevant. The "no secrets about this project" stance is structurally encoded in three places: open-source code, public architecture doc, public incident log. Each reinforces the others.

---

## Operator Commitments

These commitments are the residual mitigation for risks the architecture cannot remove. They are written for future-you to encounter.

### On the Anthropic Dashboard

> I will not read Anthropic's API request logs to satisfy curiosity about how the tool is being used. I read them only when investigating a specific operational issue (billing anomaly, abuse incident, suspected breach), and I record what I read and why in an incident log file. The 7-day window on Anthropic's side is a privacy exposure that depends on this discipline. The architecture removes every other path to user content; this is the path the architecture cannot remove.

### On Drift

> I will re-read this document in full at the start of every quarterly review. I will re-read it before any of the 10 trigger conditions land. I will resist proposals — from partners, from funders, from future Claude Code sessions, from myself — that contradict the "no" list, the threat model, or the privacy explainer's claims. When a proposal seems compelling enough to override these, the override happens through a dated ADR with explicit reasoning, not through a quiet code change.

### On Sustainability Honesty

> I will tell partners and users the truth about the project's structure: one person, one-year initial commitment, $400/month personal-spend ceiling, graceful sunset path if no institutional home is found. I will not let the tool drift into a posture of permanence it has not earned. The honesty is the point.

---

## Privacy Explainer (Canonical User-Facing Copy)

This is the canonical text of the user-facing privacy page at `/privacy`. Linked from the landing page footer (visible on every screen including the conversation screen), the about page, the first-time save modal, and the bug-report channel.

Translated into all seven supported languages (English, Spanish, Vietnamese, Somali, Russian, Amharic, Chinese) as a P0 launch deliverable. The current repo permits AI-assisted translation for launch, with spot-check review for safety wording, privacy wording, and mobile UI fit before shipping.

The page footer includes "Last updated: YYYY-MM-DD" reflecting the last meaningful change. No changelog. The current state is what's true now.

---

# Privacy

## What we save: nothing about your conversation.

Your messages and the answers you get are not saved on our servers. We don't keep them. We don't read them later. We don't sell them. We don't use them to train AI.

## What we do save: numbers, not words.

We save things like: how long it took to answer, which button you tapped, what language you used, what kind of question it was. We don't save what you typed or what the answer said.

We save these to make sure the tool works and to know if something is broken.

## How we know it's not you.

We don't ask for your name. We don't ask for your email. We don't ask for your phone number. We don't have an account system. There's no way for us to know who you are.

We do see the internet address your phone is using. We turn that into a scrambled code so we can stop someone from spamming the tool. We can't unscramble it back into your address.

## Where your messages go.

When you send a message, it goes to a company called Anthropic. They make the AI that answers you. They keep your message for 7 days, then delete it. They don't use it to train AI. They don't share it.

We picked Anthropic because their rules about your data are stricter than most companies that make AI.

## If you save a conversation on your phone.

You can save a conversation if you want. If you do, it stays on your phone, not on our servers. If someone else uses your phone, they could see it. If you're using a borrowed phone or a library computer, don't save here. You can email it to yourself instead.

## What we don't do.

- We don't have ads.
- We don't sell anything.
- We don't share your data with anyone.
- We don't have an account or login.
- We don't track you across the internet.
- We don't know who you are.

## Crisis numbers and resources.

The crisis numbers and resource lists are public. We don't track who taps them. We don't know who called.

## If something goes wrong.

If you think the tool gave you bad information, you can tell us through the link at the bottom of every screen. You don't have to give us your name. You don't have to give us the conversation. Just tell us what happened in your own words.

## Who built this.

This tool is built and run by one person in Seattle. It's free. It's not a company. It's not a research project. Nobody is making money from it. If it ever stops being free, it has stopped being this tool.

---

## Deliberate Absences

What is not in this architecture and why. Each entry is a "we don't do this and here's why" statement. A future Claude Code session, a future operator, or a future contributor must actively contradict the listed reasoning to add the missing piece.

- **No backups.** Nothing is stored that could be backed up. No database, no user content, no per-user state.
- **No monitoring or alerting tooling.** No Sentry, Datadog, Bugsnag, LogRocket, New Relic, Pingdom. Detection is human. Slower than automated; accepted because monitoring tools introduce vendors with content access and a surveillance-shaped surface.
- **No analytics.** No Google Analytics, Plausible, Fathom, Vercel Web Analytics. Aggregate session-shape metrics from runtime logs only.
- **No A/B testing or experimentation framework.** One version ships. Improvements deploy for everyone after partner review.
- **No accounts, no login, no email, no phone collection.** No user table, no session table, no auth code. Adding any is a fundamental shift.
- **No admin panel.** Vercel's dashboard is the only admin surface.
- **No content logging, no debugging toggle for content logging.** Permanent. The architecture removes the temptation by removing the capability.
- **No third-party error reporting.** Errors caught locally with metadata-only logs. Surfaced through Vercel-native runtime logs.
- **No CRM, partner database, or partner organization tracking.** Partners are not data entities.
- **No user feedback storage.** Bug reports surface to operator's email, are read, acted on, not stored. Incident write-ups are the artifact.
- **No cookies, no localStorage tracking, no fingerprinting.** Only persistent storage browser-side is what the user explicitly creates via save flow.
- **No referral tracking, no UTM parameters, no campaign attribution.** Distribution is via trusted humans.
- **No recommendation engine, personalization, or per-user model tuning.** Same model, same prompts, same classifier for everyone. No user history because there is no user history.
- **No paid tier, no subscription, no upgrade flow.** Public utility.
- **No API offered to third parties.** Other projects fork the open-source code; they do not consume our API.
- **No federation, no multi-tenancy, no white-labeling.** One tool. Other organizations fork and run their own deployments.
- **No phone home, no telemetry to the operator.** The deployed tool does not send signals back beyond named hops (Anthropic, Vercel native logs).
- **No ML or analytics on classifier categories beyond aggregate counts.** Categories counted in metadata for quarterly review. Not fed into a learning loop.

---

## Open Items for V2

These are deferred to V2 with explicit reasoning. None blocks V1.

- **ZDR + Anthropic credits conversation** at month 9–10. Pursued as a packaged public-good ask. If granted, this document gets a dated ADR, the privacy explainer changes one line, Threat 2 and Threat 8 residual risks shrink.
- **SMS bridge (Twilio).** Same backend, different front door. May require small persistent table mapping hashed phone to active conversation state. Triggers a re-read of this document and a new ADR.
- **Voice-first UI.** Auto-playing responses, voice-only navigation for users with low literacy or vision issues. Shares thinking with SMS — both are non-visual modalities.
- **Panic clear feature** considered and explicitly deferred at V1. Single-tap "clear current conversation and return to landing." Useful in coercion scenarios. Not in V1 spec; revisit at V2 if partner feedback suggests value.
- **Foundation grant or fiscal sponsorship** at month 9–10. Pursued only after V1 evidence justifies the conversation. Funding changes the project's structure and triggers a re-read of this document.
- **Open-source contribution policy.** V1 is one-person operated. V2 may accept external contributions, which requires a contributing guide, code of conduct, and reviewer protocol.

---

## Architectural Decision Summary

One-line summary of every decision in this document, dated for traceability.

**2026-05-07 — initial draft:**

- Cloudflare Turnstile script-only, not full proxy.
- Anthropic standard 7-day retention for V1; ZDR pursued at month 9–10.
- Vercel Pro plan, multi-region, no third-party error reporters, no Log Drains, no Vercel Analytics/Speed Insights/Web Analytics.
- Geo headers used once per request, never logged, never stored, never passed to model.
- No Supabase for V1; Vercel KV for rate-limit/spend/kill-switch; static JSON for referrals/translations; metrics via Vercel runtime logs.
- Hashed IP with secret salt, daily TTL, quarterly salt rotation.
- Classifier: label-only output, metadata logging only, never log Claude API request/response objects directly. Prompt disambiguation added for landlord/tenant/legal versus benefits cases.
- Debugging policy: option (a), no content logging ever, no toggle.
- Hardening: synthetic regression suite, partner bug-report template, model snapshot pinning, pre-deploy smoke check, ESLint rule, ADR directory, "no" list at repo root.
- Eight-threat threat model with explicit residual risks accepted.
- Three-tier incident framework, kill-switch-first action, partners-then-users-then-public communication, 7-day post-mortem for Sev-1/Sev-2, public `incidents/` directory.
- Two-switch kill design (soft + hard, both env-var-driven, dashboard-only).
- Operational runbook as P0 deliverable, screenshot-driven, phone-friendly, practice-runned.
- Bus-factor person scope: minimum-viable credentials, briefed and rehearsed.
- Operator-context note acknowledging self-taught builder.
- Curious-operator written commitment about Anthropic dashboard.
- Annual Anthropic and Turnstile rotation, quarterly hashed-IP salt rotation.
- Privacy page at `/privacy`, footer-linked from every screen, professional translation into seven languages as P0 launch deliverable.
- Seventeen deliberate absences explicitly named.

**2026-05-09 — classifier specific-dollar guidance:**

- Classifier prompt now explicitly defines `specific_dollar_amounts` for exact money amounts, balances, fees, payment plans, bill breakdowns, and dollar calculations.
- Regression fixtures now cover rent-ledger/payment-plan and medical-bill dollar breakdown cases.

**2026-05-09 — architecture drift closeout:**

- Language routing no longer sets or reads a cookie; explicit `?lang=` links and `Accept-Language` remain.
- Daily spend now selects a main-model tier: primary model until 80% spend, fallback main model after 80%, optional cheapest Anthropic model after 95%, hard cap at the configured daily limit.
- Follow-up suggestions now use a separate small Haiku JSON-only pass and render as tappable buttons below model responses.
- Metadata schema now includes suggestion pass token counts, response time, and status, still with no content fields.
- Classifier prompt now explicitly covers `medical_dosing`, `drug_interactions`, and `immigration`, with regression fixtures for each.

---

*End of document.*
