# Incidents

Public incident log. Part of the open-source repo on purpose — the "no
secrets about this project" stance is structurally encoded in three places:
open-source code, public architecture doc, public incident log. Each
reinforces the others.

## Format

- **Sev-1 and Sev-2** incidents produce a write-up within 7 days of
  resolution: `YYYY-MM-DD-shortname.md`. Honest, public. Includes timeline,
  what we knew when, what we did and why, what worked, what didn't, and
  changes being made (or explicitly not made) to prevent recurrence.
- **Sev-3** incidents get a one-paragraph entry in `log.md`.

The full incident framework is in `docs/data_architecture.md` under
"Incident Response Framework."

## Severity tiers (short version)

- **Sev-1** — live user harm or active breach. Kill switch first.
- **Sev-2** — suspected harm or breach, or significant tool dysfunction.
  Kill switch first.
- **Sev-3** — anomaly, near-miss, or operational issue. Kill switch may or
  may not be appropriate.

## Communication priority order

Partners → users → public.

## Status

No incidents. Tool is pre-launch.
