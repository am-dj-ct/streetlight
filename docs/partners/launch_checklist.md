# Partner Soft-Launch Checklist

Use this before any named partner starts sending real people to the tool.

## Product checks

- Landing page loads on a phone.
- Conversation flow works.
- `Find a human` works.
- Crisis footer is visible.
- Save flow works.
- Privacy page is live.
- About page is live.

## Operations checks

- `npm run verify` passes locally.
- `npm run diagnostics:local` shows the expected local mode before testing.
- `npm run ops:status` shows the expected local mode and only the known
  pre-launch doc placeholders.
- `npm run check:launch` passes.
- `OPERATIONAL_RUNBOOK.md` exists and has real screenshots.
- `DEV_MOCK_CHAT` is unset or `false` in the Vercel production environment.
- Live `/healthz` shows `chatMode=live-model`, `deployEnv=production`, and `deployConfigOk=true`.
- Bus-factor contact info is filled in.
- Soft pause tested once.
- Hard pause tested once.
- Bug-report template is shared with partners.

## Content checks

- Referral list reviewed for obvious stale entries.
- Referral and crisis entries have current `lastVerified` dates in the JSON data.
- Crisis numbers reviewed.
- Translation fallback behavior reviewed on non-English routes.

## Partner readiness

- Partner knows the tool is not a lawyer, clinician, or case manager.
- Partner knows bug reports should paraphrase, not paste user content.
- Partner knows the tool may pause if something looks wrong.

## Launch note

When this checklist is complete, send the partner:

- the main URL
- `docs/partners/one-sentence-framing.md`
- `docs/partners/bug-report.md`
- `docs/partners/current-limits.md`
- `docs/partners/launch-packet.md`
