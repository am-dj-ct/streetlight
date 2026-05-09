# 2026-05-09 — Azure Speech read-aloud side path

## Question

Should Access Tool keep using only browser/device text-to-speech, or add a
provider-backed read-aloud path for more natural voices?

## Decision

Add Azure AI Speech as an explicit, tap-to-play read-aloud side path. Keep the
browser Web Speech API as the fallback. Do not fold audio generation into
`/api/chat`.

The implementation uses a narrow server-side `/api/tts` route:

- The browser sends only the assistant response text, the UI language, and no
  user identifier.
- The server calls Azure AI Speech with the Azure key held in environment
  variables.
- The server returns audio bytes with `Cache-Control: no-store`.
- The browser plays the audio from an in-memory blob URL and revokes it after
  playback.
- No audio files, audio URLs, or TTS text are persisted.

## Options Considered

1. Keep only browser/device voices.
2. Call Azure directly from the browser.
3. Add a server-side Azure proxy as an explicit read-aloud side path.

## Reasoning

Browser/device voices are too uneven for the language mix this tool supports.
Some sound robotic enough to make the read-aloud feature disruptive instead of
helpful.

Direct browser-to-Azure calls would expose the provider key or require a more
complicated public credential flow. It would also send the user's device
network metadata directly to another provider.

The server-side proxy keeps the key out of the browser, preserves the existing
no-content-logging discipline, and makes the privacy claim explainable: Azure
sees answer text only when the user taps read-aloud.

## Consequences

- Azure AI Speech becomes a named content touchpoint for assistant response
  text when the user taps read-aloud.
- The privacy page and architecture document must say that plainly.
- New env vars are required: `TTS_ENABLED`, `AZURE_SPEECH_KEY`,
  `AZURE_SPEECH_REGION`, and optional `TTS_DAILY_CHARACTER_LIMIT`.
- A mock mode, `DEV_MOCK_TTS`, exists for local plumbing checks only and is
  blocked in production.
- The free Azure tier can be used first; if the project later upgrades to paid
  Azure Speech, the daily character cap should be set before the upgrade.
