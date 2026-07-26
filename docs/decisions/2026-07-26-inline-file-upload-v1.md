# 2026-07-26: Inline pass-through file upload (photos and PDFs) V1

## Status

Accepted.

## Context

Streetlight's document help has been text-only: users must type or paste the
text of a letter or form. The population this tool serves mostly holds paper
documents (benefits letters, eviction notices, court papers, medical
paperwork) and smartphone cameras, not scanners or portals. Asking someone to
transcribe a dense DSHS letter on a phone keyboard fails exactly the users
the tool exists for. Comparable consumer AI apps all accept a photo of paper.

Research established:

- The dominant real artifact is a camera photo of paper (JPEG on Android,
  HEIC on iPhone), then PNG screenshots, then multi-page PDFs from agency
  portals or legal aid. Spreadsheets and decks are effectively absent.
- Anthropic's Messages API accepts JPEG/PNG/GIF/WebP images (10 MB each) and
  PDFs (32 MB request cap, hundreds of pages) as inline base64 content
  blocks. Inline base64 inputs are ephemeral on Anthropic's side: processed,
  then deleted, not stored, not used for training. HEIC and DOCX are not
  accepted.
- Anthropic's Files API stores uploads until explicitly deleted. That is
  server-side persistence of user content on a third party and conflicts
  with this project's posture.
- Vercel's function request-body limit is 4.5 MB, which after base64
  inflation (4/3) budgets roughly 3 MB of original file bytes per request.
- iOS transcodes HEIC to JPEG at file-selection time when the file input's
  accept list excludes HEIC, which removes the HEIC problem without a
  client-side decoder.

## Decision

Add inline pass-through attachments to the existing `/api/chat` request.
Nothing is stored anywhere, by us or on our behalf.

- Accepted inputs: JPEG, PNG, and WebP images, and PDF documents. HEIC is
  handled by exclusion from the accept list (iOS transcodes to JPEG) plus a
  magic-byte guard with a friendly error. DOCX, XLSX, and all other formats
  are rejected in V1.
- Up to 5 attachments per message. Images are downscaled and re-encoded to
  JPEG on the device (longest edge ~2000 px) before upload. This keeps
  uploads small on prepaid data plans and strips all EXIF metadata,
  including GPS location, before anything leaves the device. PDFs are not
  re-encoded; they are size-capped client- and server-side.
- Attachments ride inside the existing JSON body as base64 fields on the
  latest user message only. The whole-body cap rises from 64 KB to 4 MB
  (under the Vercel 4.5 MB platform limit). Prior turns resend text only;
  attachment bytes are never resent in history. The message history shows a
  fixed placeholder line where an attachment was.
- The server maps attachments to Anthropic `image` and `document` content
  blocks (attachments before text) in the same streaming call used today.
  Inline base64 only. The Anthropic Files API is not used and must not be.
- Attachments go to Anthropic only. The OpenAI outage fallback remains
  text-only: on fallback, attachment blocks are replaced with a fixed
  placeholder sentence and the model is told it could not view the file.
  This keeps the privacy explainer sentence "photos and files you attach go
  only to Anthropic" true without qualification.
- The classifier and follow-up-suggestion passes remain text-only and never
  see attachments. For an image-only turn the classifier input substitutes a
  fixed placeholder for the empty user text alongside the assistant's text
  response, so the recall-first weak-category note still fires when someone
  photographs a benefits letter or court paper.
- No blob store, no upload service, no server-side file writes, no image
  cache, no thumbnails in storage, no perceptual hashes, no OCR service.
  Attachment bytes exist server-side only in the in-memory request body for
  the duration of the request.
- Logging: attachment content, filenames, dimensions, and derived
  fingerprints are content and are never logged. The metadata allowlist is
  unchanged in V1; not even an attachment count is logged. The ESLint
  no-content-logging denylist is extended with upload-shaped variable names
  (`attachment(s)`, `file(s)`, `image(s)`, `dataUrl`, `blob`, `upload`,
  `photo`, `bytes`, `buffer`).
- Abuse and spend: the existing per-IP daily turn limit, Turnstile, and
  daily spend cap apply unchanged. Image tokens are billed inside
  `input_tokens`, so per-token spend accounting is already correct; the new
  exposure is per-turn magnitude, bounded by the 5-attachment cap, the
  client downscale, and the 4 MB body cap. Spend-tier fallback models must
  remain vision-capable models.
- The privacy explainer and about pages in all seven languages say what is
  now true: you can attach a photo or PDF; it is sent to Anthropic to
  answer you and is not saved on our servers; Anthropic deletes it after
  processing; it is never used for training; attachments never go to the
  backup provider.

## Consequences

Positive:

- A user can photograph a paper letter and ask what it means. This is the
  single largest capability gap V1 shipped with, for the exact documents
  this population holds.
- The privacy story stays flat: device to Anthropic, nothing retained by
  Streetlight, ephemeral on Anthropic's side, EXIF/GPS stripped on-device.
- No new providers, no new persistence, no new named hops.

Tradeoffs:

- A single turn can now cost 10-50x a text turn in input tokens. The daily
  spend cap and tiered fallback absorb this, but the daily budget buys
  fewer turns on heavy-image days.
- During an OpenAI fallback window, attached files are not seen by the
  model. Users get an honest sentence saying so instead of silent failure.
- Earlier attachments are not resent with history, so the model cannot
  re-inspect a photo from a previous turn; the user must re-attach it.
- Uploaded documents are the densest PII the tool touches. The mitigation
  is architectural (nothing persists) rather than procedural.

Rejected alternatives:

- Anthropic Files API: persistent third-party storage requiring explicit
  deletes; a crashed function orphans a user's document indefinitely.
- Direct-to-blob-store upload (Vercel Blob, S3): a new persistence layer
  and named hop; forbidden-list shaped.
- Multimodal OpenAI fallback: technically possible inline, but it widens
  where sensitive photos can travel for a rare availability edge case.
- DOCX support: requires server-side binary conversion of user bytes, the
  first user-input-driven binary-processing surface in the project. Revisit
  only with a dedicated ADR.
- Crop/scan-enhancement UI and OCR preprocessing: model vision handles
  imperfect photos; each added step loses low-literacy users.
