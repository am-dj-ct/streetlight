# Bounded Turnstile pass for the scheduled UI sentry

Date: 2026-09-26. Owner authorization: Jesse explicitly requested this change.
Status: proposed for review; production activation follows coordinator merge.
Architecture re-read completed before implementation.

## Decision and scope

Add a separate server-only `STREETLIGHT_MONITOR_TOKEN`, generated from 48 random
bytes, in Doppler `agent-secrets/dev` and Vercel **Production** for `access-tool`.
An absent value or a value shorter than 32 UTF-8 bytes disables the pass. Compare
SHA-256 digests with Node's constant-time `timingSafeEqual`; never compare the
credential with ordinary string equality. The credential is accepted only for
POST `/api/chat`, in `x-streetlight-monitor-token`.

A valid credential skips only the existing Turnstile validation. Body/input
validation, production configuration checks, hard pause, soft pause, per-IP rate
limits, model selection, daily spend accounting/caps and output limits remain
in their existing positions. No provider, prompt, refusal or user-facing change.

Before granting a pass, reserve one of **12 uses per UTC day**, globally across
all instances, using one atomic Redis Lua operation in the existing Vercel KV.
The key is `monitor-pass:YYYY-MM-DD`; its value is only an integer. Increment and
absolute expiry (UTC midnight plus 60 seconds) are atomic. Never refund a use,
even if a later control rejects the request. Count exhaustion, absent KV, errors
or unexpected KV results fall back to ordinary Turnstile. No memory-only cap,
fail-open bypass, extra KV namespace credentials or per-user keys.

## Browser boundary and integration

The first live turn of each attempt must still pass real Turnstile. Later turns
may opt in only after that first turn succeeds. A helper installed before page
navigation observes the widget callback, leaves the real first execution alone,
and on explicitly selected later turns supplies a fixed **nonsecret** marker to
release the application's client-side token wait. A header alone cannot fix
`client_blocked`: that state means the browser withheld the POST entirely.
The marker grants no server authority; without a valid header and available
quota, normal Turnstile rejects it. If the first real check fails, the helper
never enables the pass. Missing/short local credentials leave normal behavior.

The credential stays in the monitor process, attached only to same-origin chat
POSTs by a Playwright route, never page JavaScript, URLs, cookies, localStorage,
screenshots, traces or reports. The route uses `fallback` so the existing
request-boundary eight-turn budget guard and synthetic-traffic authentication
still run. Current `/api/chat` has no redirect; a future redirect on this route
requires review because Playwright header overrides can follow redirects.
No new logs or metadata fields. Existing OPS_READ_TOKEN authentication continues
to exclude synthetic turns from public usage and error-stream aggregates; the
new credential alone does not grant dashboard access or alter usage accounting.

The helper is shipped separately; the coordinator wires `tier2.mjs` after the
concurrent monitor lane merges. No monitor run, live production chat, production
deploy, launchd edit or merge is part of this implementation task.

## Threat model and limits

A stolen credential can bypass CAPTCHA for at most 12 requests per UTC day,
subject to every other existing control, and can exhaust the monitor's quota.
It cannot reveal conversations or grant operational read access. At midnight,
two adjacent daily quotas can be consumed close together. Reservations can be
lost on network errors; conservative under-use is preferable to bypassing the
cap. Loss/eviction of the counter in KV can reset quota, so this relies on the
existing store's durability and access controls, as existing spend/rate limits do.
Clock boundaries use the server UTC clock. The cap permits the usual five
post-first turns and a bounded repeat, without replacing the eight-turn per-run
monitor budget. It does not authorize additional scheduled runs.

Keep this credential out of request/error dumps and rotate on suspected exposure
or annually. Update both secret stores and redeploy via the supported release
path; remove the production variable and redeploy to disable. Mixed deployments
during rotation may reject the old credential and fall back to Turnstile.
`/healthz` exposes only `abuseControls.monitorPassConfigured` (valid-length token
and KV settings present), not quota, credential, or a live KV availability claim.
The pass is optional and its absence does not fail launch/deployment readiness.

## Alternatives

Random pauses do not guarantee token issuance and obscure what failed. Reusing
the ops credential would couple CAPTCHA bypass to operational access. Disabling
Turnstile globally, IP allowlisting, a cookie/session table, or a client-only
bypass expands privileges or identity retention. A header without a client-wait
bridge does not solve this incident. This bounded, separate credential is the
smallest server authority that meets the requirement.

## Verification

Synthetic unit and route tests cover authentication, daily boundary/cap,
absent/error KV, normal Turnstile fallback, unchanged pause/input/
rate/spend controls, configuration booleans, and secret-free logs/responses.
Browser tests cover first-turn gating, the later-turn token wait, origin/method
scope and coexistence with the budget guard. Lint, build and category-aware
verification run locally; preview is checked with no monitor credential.
Production success remains for the coordinator's post-merge scheduled run.
