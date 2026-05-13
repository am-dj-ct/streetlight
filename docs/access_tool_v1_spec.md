# Streetlight — V1 Specification

A free, public, mobile-web tool that puts a frontier LLM in the hands of
people experiencing homelessness, housing insecurity, or extreme poverty
in Seattle / King County.

---

## Two-Product Framing

V1 is two products that share one artifact:

**Product A — the user tool.** Used by people in the target population,
mediated initially by trusted frontline workers. Success = real users
solved real problems they couldn't have solved otherwise. Target: 20–50
documented sessions in 90 days where a partner can describe a concrete
outcome (a letter sent, a document understood, a hard conversation
prepared for).

**Product B — the proof of concept and credibility object.** Built well
enough that decision-makers (Anthropic, foundations, Miracle Messages,
DESC leadership, Seattle Public Library) look at it and conclude that
the larger version is worth supporting. Success = a working tool, a
clean public-facing landing page that conveys ethos and scope in 90
seconds, documented stories from Product A, and a credible scaling
narrative.

The two products inform different parts of the design. Most decisions
serve both. Where they diverge, the spec calls it out.

---

## Outcomes

A user (or staff member, or anyone else) lands on the URL on a phone, in
under one second, and within two taps is in a useful conversation with a
frontier-class LLM about a real problem. They get help that a connected
person would get from Claude or ChatGPT routinely and that this user
otherwise has no access to: a bureaucratic letter explained, a difficult
message drafted, a stuck thought worked through, a hard conversation
rehearsed, a basic question answered without judgment.

The tool does not pretend to be a service directory, a clinician, a
lawyer, or a friend. It does not collect identity, does not retain
content, does not gate access, does not advertise. It treats every user
as a capable adult.

---

## Platform / Delivery

V1 is a **mobile web app**. A website, accessed by URL or QR code in a
phone's browser. No app store, no install, no download.

- Designed mobile-first. Desktop browsers will technically work but
  phones are the assumed medium.
- Built with Next.js, deployed on Vercel.
- Static landing page server-rendered for fast paint on 2G and low-end
  Android devices.
- One codebase serves V1. V2 adds an SMS bridge (Twilio) as a second
  front door against the same backend — not a separate codebase.
- No native iOS or Android app in V1 or V2.
- No push notifications, ever. The tool doesn't reach out to users —
  users come to it when they need it.

Reasoning: install friction is incompatible with the access ethos.
Anonymous web access via a URL is one tap from a text message, a QR
code, or a link a partner shows on their own phone. Surviving a lost
or replaced phone is the default — no re-install, no re-login. Updates
deploy instantly to every user on next visit.

---

## In-Scope (V1 web)

### Landing Screen

- Static HTML, server-rendered, paints under 1 second on 2G.
- No splash screen, no loading state, no welcome video, no explainer
  paragraph.
- Header: two lines max, plain language. No brand prominence.
- Eight prompt buttons stacked vertically, large tap targets, plain
  verb-led labels:
  1. Understand a letter or form
  2. Write something
  3. Think it through (listen and ask questions)
  4. Figure out what to do next
  5. Explain something like I'm new to it
  6. Prepare for something hard
  7. Am I being unreasonable
  8. Something I'm embarrassed to ask
- "Type your own" and "Talk instead" as equal-billing alternatives at
  the bottom of the button list.
- Persistent footer with crisis resources and "Find a human" link,
  visible on every screen.
- No login, no email, no phone number, no signup of any kind.

### Language Handling

- Auto-detect from browser `Accept-Language` header. UI renders in the
  detected language from first paint.
- Visible language strip on first visit: "English · Español ·
  Tiếng Việt · Soomaali · Русский · አማርኛ · 中文" (each in native
  script). Tappable, no English-language navigation required.
- Globe icon with current language in native script for return visits.
- Static UI strings translated once, stored as JSON per language.
- Conversation translation handled natively by the model.
- Crisis numbers and referral lists may vary per language community
  (DV hotlines etc.) — content problem, not tech problem.

### Voice

- Mic button always visible in the input bar on every screen with text
  input, never auto-activated. Web Speech API for input (free, native).
- TTS play button on every model response, opt-in per response, never
  auto-plays. Azure AI Speech provides the normal read-aloud path through
  a server-side proxy; Web Speech API remains the device fallback.
- Pure-voice end-to-end use is a known V1 gap — UI is text-first with
  voice helpers. Acknowledged on the about page. V2 priority.

### Post-Tap Behavior

- Tapping a button opens the conversation screen with a single
  clarifying turn from the model already in place. Button selection is
  passed into the conversation's system prompt so the model has context.
- No forms, no wizards, no multi-step flows.
- Input box is focused and ready.

### Conversation Screen

- Looks like a text thread, not like ChatGPT. No sidebar, no chat
  history, no regenerate button, no edit-message, no share, no thumbs.
- Top: small back-arrow (returns to landing) and language indicator.
  Nothing else.
- Middle: messages styled as a thread. User right, model left. Plain
  text, generous line spacing, large font.
- Below each model response: TTS play button, "Find a human for this"
  button.
- If post-hoc classifier flags the response as a known-weak category,
  inline note appears below the response: "ℹ️ This is the kind of thing
  AI sometimes gets wrong. Worth verifying with a person who does
  [category]." Tappable to expand the find-a-human list pre-filtered.
- Up to three model-generated tappable follow-up suggestions appear
  below each response. User can tap, type, or use mic.
- Bottom: input bar (text input, mic icon, send button).
- Persistent crisis footer always visible.

### Per-Button System Prompt Tuning

- Each of the eight buttons routes to a slightly different system
  prompt tuned for the use case.
- Prompt #7 ("Am I being unreasonable") specifically tuned for direct,
  honest pushback — the model is instructed not to soften assessments.
- Other prompts let the model be warm. No global anti-sycophancy
  treatment.
- Master system prompt orients the model: free public tool, user might
  be in any situation including significant material hardship, default
  to maximally useful, treat them as a capable adult.
- Master system prompt is brief-first by design: start with the most
  usable version in plain language, keep critical caveats and next
  steps, and expand when the user asks or when the task requires a
  complete draft, checklist, document explanation, script, or
  high-stakes detail.

### Classifier Pass

- After each main-model response, a second pass via Haiku 4.5 classifies
  the response into known-weak categories: legal procedure, medical
  dosing, medical decision-making, benefits eligibility rules,
  immigration, drug interactions, employment rights, identity
  documentation, specific deadlines, specific dollar amounts.
- Result drives the inline weak-category flag and pre-filters the
  find-a-human list.
- Classifier classifications are logged (no content). See Privacy.

### Find-a-Human

- Persistent button on every model response.
- Opens a maintained list of King County referral resources, optionally
  pre-filtered by classifier category.
- List lives in a single JSON file maintained outside the model. No
  inline referral generation.

### Save / Re-Entry

- No accounts, no server-side conversation storage, no automatic
  history.
- Default: fresh start every visit.
- Optional save: client-side only. Generates a plain-text file or
  formatted screenshot the user can save to their device.
- First save shows a one-time plain-language confirmation modal naming
  the actual risk and offering share, copy, or email as alternatives:

  > **Save this conversation?**
  >
  > This will save a copy on this device. If someone else uses this
  > device, they could see it.
  >
  > If this is your device and only you use it: probably fine.
  > If this is a shared or borrowed device, or a library computer:
  > don't save here. If your device offers Share, use that, or copy
  > the text into a private message, notes app, or another place you
  > trust.
  >
  > [Save here] [Share from this device] [Copy text instead] [Cancel]

- After first save, button reads "Save · stays on this device" with a
  "?" to re-open the explanation.
- Share/copy/email options happen on the device, with no server involvement.
- The browser may remember small local UI preferences like voice choice,
  speech speed, and whether the save warning was already shown. These are
  not identifiers, tracking tags, or analytics.
- Optional shared-device toggle (for library/kiosk deployments) hides
  local save entirely; share/copy/email alternatives only.

### Geo-awareness

- No geofence. Public URL accessible from anywhere.
- Landing page makes King County scope visible: "Resources are organized
  for King County, WA. The tool itself works for anyone, anywhere."
- Free geo-awareness via Vercel request headers (no permission prompt):
  WA users see local crisis/referral content; non-WA users see 211 +
  988 fallback.

### Audience

- No distinction between user types. Frontline staff, end users,
  researchers, anyone — all get the same tool. No framing that
  excludes or promotes any population.

---

## Explicitly Out-of-Scope (V1)

- Native iOS or Android app.
- Service directory functionality (shelter beds, eligibility databases,
  benefits enrollment).
- Pure-voice end-to-end UI with auto-playing responses and voice-only
  navigation.
- Account system, login, password, email verification.
- Conversation history server-side.
- User profiles, preferences, personalization across sessions.
- Geofence, region-locking, or access control.
- Refusal categories beyond the safety floor (legal, medical, etc. —
  the model helps; weak-category flags surface honest calibration).
- Refusals based on intended use (writing code, doing homework, etc.).
- Automated harm-detection systems. Anomaly detection on content.
  Sentiment classifiers. Automated red-flagging.
- Public marketing push, QR-code distribution at scale, Hacker News
  launch.
- Synthetic adversarial testing as a recurring practice.

---

## V2 SMS Plans (high level)

V2 adds an SMS bridge using Twilio. Same backend, different front door.

- Critical for users without smartphones, with burner phones, or with
  unreliable phone access.
- Likely a meaningful fraction of the actual target population.
- No buttons, no rich content, no inline UI affordances. Different
  design center.
- Will share thinking with V2 voice-first UI (both non-visual modalities).

V2 voice-first UI:

- Auto-playing responses, voice-only navigation, designed for users
  with low literacy or vision issues for whom V1 is unusable.

V2 work begins after V1 evidence justifies institutional support
(funding, partner endorsement, or both).

---

## Constraints and Assumptions

- Self-taught dev, ~3 months serious coding experience, has shipped
  production projects. Comfortable with Next.js, Supabase, Vercel,
  Twilio.
- Maintained by one person on a one-year commitment. At year one, the
  project either finds an institutional home or sunsets gracefully.
- HIPAA is not a constraint (no PHI is collected by the tool itself —
  see Privacy section for the actual data architecture work).
- Personal-spend ceiling: $400/month. Configurable as a daily cap.
- Target population assumed to have phones (often unreliable,
  intermittent, lost/stolen often), low average reading literacy, low
  average tech literacy, full capability to use a tool that meets them
  where they are.
- Self-onboarding from a QR code without human intermediation is
  expected to be ~0.1% — V1 design center is assisted use through
  trusted frontline partners. Solo use is supported but not the median
  case.
- The model's natural warmth is a feature for this population, not a
  bug. Sycophancy concerns are not a primary V1 problem; per-button
  system prompts handle the narrow case where honest pushback matters.

---

## Decisions Already Made

- **No keyword-based crisis detection layer. No classifier-based crisis
  routing. No UI override that hijacks the conversation.** The model
  handles crisis disclosures with its trained behavior. Localized
  resources (988, DESC crisis line, local mobile crisis team, plus DV
  and overdose specifics) included in the system prompt so when the
  model surfaces help, it surfaces help that's actually useful in King
  County. Persistent footer with crisis numbers — present, not
  performative. Same logic as the BLT auto-reply pattern: declining
  to claim detection competence is the legally and ethically clean
  position.
- **No refusal categories.** The model does the work — explains
  documents, drafts letters, walks through situations, answers
  questions. A second-pass classifier flags responses in known-weak
  categories with an honest "this is the kind of thing LLMs get wrong"
  note and a routed find-a-human option. Harm-reduction-style honesty
  replaces refusal in the dosing/interaction case.
- **Brief-first is not refusal.** Shorter default answers are an
  accessibility choice for mobile, read-aloud, and low reading stamina.
  The tool still does the task; it just leads with the usable version
  before adding more detail.
- **Default model: Claude Sonnet 4.6.** Haiku 4.5 for the classifier
  pass. Architecture supports trivial model swap (config-level, not
  hardcoded). Reserves the right to change models, including to
  alternatives like DeepSeek when justified.
- **Tiered fallback for cost management.** Sonnet → Haiku → cheapest
  viable when budget tightens. Users not informed mid-conversation;
  honest mention on about page. Hard cap fires only when even the
  bottom tier would breach budget. "Today's limit reached, try again
  tomorrow" message is acceptable and treats users as adults.
- **No purpose-locking refusals.** If a user asks the tool to help with
  code, homework, or anything else, the tool helps. The access gap is
  not reproduced inside the tool.
- **Personal-spend ceiling: $400/month.** Configurable daily cap.
  Funding plan: pursue Anthropic credits and foundation grants only
  after V1 evidence justifies the conversation. Personal spend covers
  V1 soft-launch and meaningful early growth.
- **Soft-launch only.** No Hacker News, no QR codes on shelter walls,
  no public push until the practitioner loop is working with the
  named partners. Public URL is accessible; the tool just isn't
  promoted.
- **Maintained by one person on a one-year commitment.** Open source
  from day one as backstop. Bus factor of two minimum (one trusted
  second person with operational access). Year-one institutional
  conversation is a planned milestone at month 9–10. Wind-down path
  is real and designed.
- **Frontline staff use is welcome.** No distinction in the framing.

---

## Refusal and Crisis Handoff Design

**Crisis handoff design — the entire design:**

1. The model handles crisis disclosures with its own trained behavior.
2. The system prompt includes localized King County crisis resources
   (988, DESC crisis line, DV-specific lines, mobile crisis team
   contacts, overdose response info) so referrals are useful.
3. A small persistent footer on every screen surfaces crisis numbers.
   Not scary, not pop-up, just present.
4. No keyword detection. No classifier-based routing. No UI override.
5. The tool does not claim to detect crisis. It is a tool, the user is
   an adult, and the resources are visible.

**Refusal taxonomy — none.** The tool does not refuse use cases.

What the tool *does* do:

- Honest calibration via the weak-category classifier flag (after the
  fact, not as a refusal).
- A persistent "Find a human for this" button surfacing maintained
  King County referrals.
- Harm-reduction-style honesty for dosing/interaction questions: gives
  the relevant general information, names uncertainty clearly, points
  to a better source for the specific number (DOPE Project line,
  pharmacist).
- A short standing pattern of "I'm an LLM, I get things wrong, here's
  a human who can verify" — present but not performative, never used
  to refuse the request itself.

---

## Distribution Plan

V1 distribution is **not a public launch.** It is a soft-launch with
named partners, evaluated at 90 days.

**Primary partners (pre-existing relationships):**

- **Malia** — case manager doing outreach for women experiencing
  homelessness or housing instability at Mary's Place. Lives with the
  builder. Pre-committed to supporting the work. Will use the tool
  herself with clients. Highest-fidelity feedback channel.
- **Jennifer** — supportive housing case manager at 1811 Eastlake (DESC).
  Used to work for the builder. Will use the tool with residents and
  give blunt feedback.
- **Gary** — DCR / mobile crisis outreach worker, BLT board member.
  Long-time behavioral health colleague.

**Secondary partner (cold contact):**

- **Juan Rubio at Seattle Public Library.** Cold-email at week 4–8 with
  the credibility content from primary partners. Library is a strong
  deployment node — population already comes there, staff are trained
  to help with bureaucratic and digital tasks.

**Strategic deferred contact:**

- **Director of housing at DESC.** Largest non-profit serving
  homelessness in Seattle. Approached at week 8–16, warm-introduced
  through Jennifer's track record at 1811. Ask is small and specific
  (e.g., "Put a card in the welcome packet at one shelter for 60 days
  and see what happens"). One-shot resource — not used until V1 has
  field evidence to make the meeting easy.

**Distribution mechanics:**

- Adoption in this population is driven by trusted humans saying "this
  thing might help with what you just told me about." Posters on walls
  are theater. The first 16 weeks are about practitioner adoption, not
  user reach.
- Story capture is a first-class V1 feature. Partners take notes on
  what worked, what didn't, what users did, what the outcomes were
  (with consent, anonymized). These stories are the proof-of-concept
  evidence and the foundation pitch.
- Crisis Solutions Center, Evergreen, and other warm contacts are
  deprioritized for V1.

**Timeline:**

- **Weeks 1–4:** Malia and Jennifer use the tool. Builder sits with
  Malia and her clients in person at least once. Iterate on what
  breaks.
- **Weeks 4–8:** Cold-email Juan Rubio. Library becomes the second
  deployment node.
- **Weeks 8–16:** Approach DESC director with field evidence. Small,
  contained, time-boxed pilot ask.
- **Beyond:** If DESC says yes to a small pilot, V1 has access to the
  largest possible user base in the city through the most credible
  channel.

DESC is not required for V1 success. If Malia's clients use it, if
Jennifer's residents use it, if the library puts it on their tools
page, V1 has done the thing.

---

## Sustainability Plan

**Cost model:**

- Sonnet 4.6: $3/M input, $15/M output. ~$0.054 per session at typical
  use (3K input / 3K output, ~5 turns).
- Haiku 4.5 classifier pass: <$0.001 per session. Negligible.
- $400/month at Sonnet rates supports ~7,400 sessions/month, ~245/day,
  ~160 daily users. Well past V1 soft-launch capacity.

**Tiered fallback:**

- Default: Sonnet 4.6.
- When ~80% of daily budget is consumed: switch to Haiku 4.5 for
  remaining sessions. Still capable for most use cases.
- If even Haiku would breach budget: switch to cheapest viable model
  (DeepSeek or comparable).
- If even Tier 3 would breach: hard cap. "Today's limit reached, try
  again tomorrow."
- User-facing behavior: no mid-conversation model disclosure. Honest
  mention on about page that the tool uses different models depending
  on availability.

**Personal spend:**

- $400/month ceiling, configurable daily cap.
- Builder commits to one year of active maintenance.
- This funds V1 soft-launch and meaningful early growth without
  external funding.

**Funding strategy:**

- No money pursued for V1 launch. The tool runs on personal spend.
- At month 9–10, builder pursues:
  - Anthropic credits via the public-good / nonprofit credit program
    (the build-it-with-Claude angle is a credibility play and a
    deliberate strategy).
  - One foundation grant or fiscal sponsor to provide institutional
    home.
- The pitch is built on V1 field evidence: real partners, real users,
  real stories, real cost-management discipline.

**Continuity plan:**

- Open source from day one. GitHub repo, MIT or Apache license,
  documented well enough that someone could fork it.
- Bus factor of two: builder + one trusted second person with access
  to Vercel, Anthropic, domain, and a basic operational runbook.
- Year-one fork:
  - **Found institutional home** → continue.
  - **No institutional home, builder is done** → 30-day notice on
    landing page, partners notified, code stays on GitHub, domain
    redirects to a static page explaining the project ended and
    pointing to alternatives. Graceful sunset.
- About page is honest about the structure: "Built and maintained by
  one person. If you're depending on it, know that it might not be
  here forever."

**Abuse mitigations (none of which violate the access ethos):**

- Per-IP rate limit: ~100 turns/day. Generous for any real user, blocks
  bots and casual abuse.
- Cloudflare Turnstile (invisible captcha, no friction).
- Output token cap per response (~1500). Plenty for any real use case;
  prevents budget-drain attacks.
- Daily total spend cap as ultimate failsafe.
- Manual on/off switch — builder can disable the tool in 60 seconds if
  needed.

---

## Privacy and Data Architecture

**Status: P1 unresolved area. Must be designed and implemented before
the soft-launch with named partners. Not before code begins, but before
a real user touches the tool.**

The honest version of the privacy claim: PII enters the conversation by
necessity (users will paste in eviction notices, name their kids,
describe their PO), but is not retained, not associated with identity,
not aggregated, and not accessible after the session.

**Required before launch:**

- A documented end-to-end data flow: what touches what, what gets
  logged where, retention windows, who has access.
- A Zero Data Retention agreement with Anthropic, or an explicit
  decision to launch without it and accept their standard retention.
  ZDR request goes in alongside the credits conversation.
- Server logs configured to log metadata only (timestamps, response
  times, error codes, model used, token counts) — not message bodies.
  Vercel logging defaults audited and adjusted.
- Classifier metadata logged (which weak category was flagged); input
  text to classifier not logged.
- An explicit debugging policy: either no-content logs ever, or a
  short-window content-logging mode (24 hours, auto-purge) toggleable
  for diagnosis. Decision made and documented.
- A privacy explainer page in plain language linked from the landing
  page footer. Matches what's actually true.

---

## Verification Criteria

V1 success is measured against the two-product framing.

**Product A — the user tool:**

- 20–50 documented sessions in 90 days where a partner can describe a
  concrete outcome (a letter sent, a document understood, a hard
  conversation prepared for, a stuck thought worked through).
- At least three named partners (Malia, Jennifer, Gary, plus library
  if Juan engages) using the tool with their clients/patrons.
- Story capture in place: partners are taking notes, builder is
  collecting them.
- No reported acute harms. No user worse off in a way a partner can
  describe.
- Tool is online >99% of measured time. Outages handled within 24
  hours.

**Product B — proof of concept:**

- Working public landing page that conveys ethos and scope in 90
  seconds.
- Open-source repo, public, documented.
- 5–10 documented anonymized stories from partners.
- Privacy architecture implemented and verifiable (data flow document,
  ZDR status, logging audit).
- A credible scaling narrative ready for conversations with Anthropic,
  one foundation, and the DESC director.

**Harm-detection plan (running throughout V1):**

- Quarterly structured check-ins with each partner (separate calls,
  documented).
- Footer link in the tool: "Did this tool steer you wrong? Tell us."
- Classifier categories logged (no content) to see what users are
  actually using the tool for.
- Aggregate session-shape metrics: average session length, turns per
  session, prompt-tap distribution, language distribution, time-of-day.
  No content.
- 90-minute quarterly self-review of metrics + partner notes.

**Drift prevention (running throughout V1):**

- Written ethos statement (this spec, plus the original brief), re-read
  before any meaningful change, funding decision, or partnership.
- One trusted human with standing to tell the builder when the project
  is drifting.
- Pre-committed "no" list:
  - No advertising.
  - No account/login system.
  - No collection of identifying user data for any reason.
  - No paid tier.
  - No sale of conversation data, even anonymized.
  - No branding the tool as "for homeless people."
  - No sponsored content.
  - No charging partner organizations for access.

---
