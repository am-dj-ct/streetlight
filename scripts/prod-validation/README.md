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

Deeper local-only suites (run against `npm run dev:mock`, zero spend):

- `make-evil-assets.mjs` crafts adversarial files into `evil/`: JPEGs with
  hand-built EXIF GPS + orientation segments, truncated/zero-byte/garbage
  files, a HEIC magic-byte stub, extension lies (PDF named .jpg and vice
  versa), transparent PNG, 1x1, 8000x8000, and a 6000x60 panorama.
- `torture.mjs` drives those through the real composer and asserts at the
  wire level: EXIF/GPS fully stripped, filenames never transmitted,
  history turns never resend attachment bytes, EXIF orientation honored,
  friendly rejection notices, sniffing beats file extensions, white
  background for transparent PNGs, downscale edge dimensions, the 5-file
  limit, preview removal, and double-click sending exactly one POST.
- `boundary.mjs` hits `/api/chat` directly with exact-cap payloads (accept
  at the cap, reject one step over), base64 alphabet edges, mixed
  image+PDF messages, extra-field smuggling, and concurrent valid sends.

Local use: `npm install playwright-core` in this directory, then set
`CHROME_PATH` to a Chrome/Chromium binary. `HEADED=1` runs headed (use
`xvfb-run` on CI). This directory's `package.json` is standalone — the app
build does not depend on it.
