# Production upload validation

Post-deploy checks for the inline photo/PDF attachment feature
(`docs/decisions/2026-07-26-inline-file-upload-v1.md`). Runs from the
`prod-upload-validation` GitHub Actions workflow, or locally.

All test documents are synthetic (generated fake letters) — never use real
user content, per the repo fixture rule.

- `gen-assets.mjs` renders a 4-page fake benefits letter as JPEG/PNG pages
  and a multi-page PDF using Chromium.
- `validate-live.mjs [baseUrl]` drives the real UI with Playwright on a
  mobile viewport (so production Turnstile executes normally in-page):
  single JPEG, single PNG, 4-image multi-attach, multi-page PDF, and an
  image-only send. Each case asserts the intercepted `/api/chat` POST
  carried the expected attachment count/types (proves the client
  downscale-to-JPEG pipeline) and that a reply streamed. Costs a few live
  image turns when pointed at production.
- `stress.mjs [baseUrl]` sends only invalid requests that are rejected
  during body/shape validation, before the Turnstile check and before any
  model call: 413s for oversized bodies, 400s for cap/type/shape
  violations, plus a concurrent near-cap burst. Zero model spend.

Local use: `npm install playwright-core` in this directory, then set
`CHROME_PATH` to a Chrome/Chromium binary. `HEADED=1` runs headed (use
`xvfb-run` on CI). This directory's `package.json` is standalone — the app
build does not depend on it.
