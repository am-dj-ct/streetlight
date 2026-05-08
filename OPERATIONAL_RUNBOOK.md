# Access Tool Operational Runbook

This is the dashboard-first runbook for operating the Access Tool in a bad
moment. It is written for a stressed human, on a phone if necessary.

Before launch:

- Replace every `[Screenshot]` placeholder with an actual screenshot from the
  real Vercel dashboard.
- Add the bus-factor person's current contact info.
- Practice this twice solo and once with the bus-factor person.
- Confirm `DEV_MOCK_CHAT` is unset or `false` in the Vercel production
  environment.

## Fill this in before launch

- Live URL: `ADD-LIVE-URL-HERE`
- Bus-factor person: `[ADD-NAME]`
- Best phone or text: `[ADD-PHONE]`
- Backup email: `[ADD-EMAIL]`

---

## Page 1: Fast decision tree

### If any of these are true

- You think the tool may be leaking data.
- You see traffic or billing that looks wrong.
- A partner reports serious harmful output.
- The app is behaving in a way you do not understand.

Start here:

1. Pause the tool first.
2. Write down the time.
3. Decide later whether it was "really" an incident.

When in doubt, pause.

### Which pause to use

Use **soft pause** if:

- the site itself is fine but responses should stop for a while
- billing looks wrong
- traffic spike needs investigation
- you need an hour to check something

Use **hard pause** if:

- you suspect a breach
- the wrong code may be live
- the public should not keep using the app right now
- you need every route to stop immediately

---

## Soft pause

### What it does

The site still loads, but chat requests stop and users get a plain-language
pause message.

### How to do it in Vercel

1. Open the Vercel dashboard.
2. Open the `access-tool` project.
3. Go to `Settings`.
4. Go to `Environment Variables`.
5. Find `SOFT_PAUSE_ENABLED`.
6. Set it to `true`.
7. Save.
8. Wait for the redeploy to finish.

[Screenshot: Vercel project settings]
[Screenshot: Environment Variables]
[Screenshot: SOFT_PAUSE_ENABLED set to true]

### What to check after

1. Open the live site.
2. Start a conversation.
3. Send a message.
4. Confirm the pause notice appears instead of an AI response.

Write down:

- time you turned it on
- why you turned it on
- what you saw

---

## Hard pause

### What it does

Every route serves the pause page.

### How to do it in Vercel

1. Open the Vercel dashboard.
2. Open the `access-tool` project.
3. Go to `Settings`.
4. Go to `Environment Variables`.
5. Find `HARD_PAUSE_ENABLED`.
6. Set it to `true`.
7. Save.
8. Wait for the redeploy to finish.

[Screenshot: HARD_PAUSE_ENABLED set to true]

### What to check after

1. Open the landing page.
2. Open a conversation URL directly.
3. Confirm both now show the pause page.

Write down:

- time you turned it on
- what triggered it
- whether partners need to be told right away

---

## Unpause

Do not rush this.

### Before turning the tool back on

- You understand what happened well enough to explain it plainly.
- If this was a serious incident, the public incident write-up is live first.
- You have tested the live app again.
- `DEV_MOCK_CHAT` is still unset or `false` in Vercel production.

### To turn soft pause off

1. Go back to `SOFT_PAUSE_ENABLED`.
2. Set it to `false`.
3. Save.
4. Wait for redeploy.
5. Test a real conversation send.

### To turn hard pause off

1. Go back to `HARD_PAUSE_ENABLED`.
2. Set it to `false`.
3. Save.
4. Wait for redeploy.
5. Test landing, conversation, and referrals.

---

## Key places in the dashboard

### Deployments

Use this to confirm:

- whether a redeploy happened
- when it happened
- whether the latest build succeeded

[Screenshot: Deployments tab]

### Runtime logs

Use this for:

- 5xx errors
- rate-limit errors
- spend-cap or pause responses
- metadata-only debugging

Do **not** go looking for user content. This app is designed so there should
not be any in logs.

[Screenshot: Runtime logs]

### Usage / billing

Use this if:

- spend suddenly spikes
- you suspect abuse
- a partner says the app stopped responding

[Screenshot: Usage view]

---

## If you suspect credential compromise

Do this in order:

1. Hard pause.
2. Rotate the Anthropic API key.
3. Rotate the Turnstile secret.
4. Rotate the hashed-IP salt.
5. Confirm env vars are updated in Vercel.
6. Wait for redeploy.
7. Run the smoke check:
   - `/healthz` returns `{"ok":true,"service":"access-tool","chatMode":"live-model","deployEnv":"production","deployConfigOk":true,...}`
   - landing page loads
   - conversation page loads
   - sending a message works
8. Only then consider unpausing.

Reference:

- `docs/data_architecture.md` → `Key Rotation and Secret Management`

---

## Incident notes

If something weird happens, open:

- `incidents/log.md` for Sev-3 notes
- `incidents/YYYY-MM-DD-shortname.md` for Sev-1 or Sev-2 write-ups

Minimum notes to capture immediately:

- date and time
- what you first noticed
- what you did first
- what changed after that
- whether partners were affected

Do not trust memory later. Write it down while it is fresh.

---

## Partner communication order

If the incident is serious:

1. Partners
2. Users
3. Public write-up

Short, plain-language update template:

> The tool is paused while I check on a problem. I do not yet know the full
> cause. I will follow up when I know more. If anyone needs help right now,
> use 988 for crisis, 211 for resources, and 911 for emergencies.

---

## Bus-factor section

Fill this in before launch:

- Primary operator:
- Bus-factor person:
- Best phone number:
- Best email:
- Time zone:

---

## Related documents

- `docs/data_architecture.md`
- `docs/forbidden.md`
- `incidents/README.md`
- `incidents/log.md`
