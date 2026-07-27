# Codex brief: full live test of file uploads on streetlight.help

Role: act as a real user in a REAL, VISIBLE browser (never headless). Target:
https://streetlight.help. Real API spend — hard budget of ~25 chat turns total;
adversarial/rejection cases cost nothing (they never reach the model).

## Setup
1. Clone github.com/am-dj-ct/streetlight.
2. In `scripts/prod-validation/`: `npm i playwright-core`, then
   `CHROME_PATH=<local chrome> node gen-assets.mjs` and `node make-evil-assets.mjs`.
   Yields synthetic letter pages (JPEG/PNG), a 4-page PDF, and `evil/` files.
   Read that directory's README.
3. Make two extras locally: `letter-page-2.webp` (convert the JPEG), and
   `big.pdf` > 2.1 MB raw (e.g. concatenate the sample PDF repeatedly) to trip
   the client size cap.

## Phase A — core pathways (~8 turns, "Understand a letter or form" entry)
Each: screenshot before send, after reply. A reply passes only if it shows real
comprehension (cites the Aug 15 deadline / Basic Food review / fair-hearing
rights actually printed in the synthetic letter).
A1. letter-page-1.jpg + "What is this asking me to do, and by when?"
A2. Follow-up, NO new file: "What proof of income would count?" — context must hold.
A3. letter-page-3.png + "What rights does this page say I have?"
A4. All 4 JPEGs in one message + "These are one letter — what do I send, where?"
A5. letter-4pages.pdf + "Summarize this in plain words."
A6. Image only, no text typed — send button must enable; reply substantive.
A7. letter-page-2.webp + any question — must upload and be read.
A8. In the reply UI from A5: check the weak-category "verify with a person"
    note and the "Find a human for this" link behave.

## Phase B — conversation & product features around attachments (~5 turns)
B1. After an image turn: use "Listen" (read-aloud) on the reply — TTS must play.
B2. Save/export the conversation (TXT and PDF save options): exported content
    must show "[Photo or file attached]" placeholder, never the image itself.
B3. Suggested-reply chip tapped right after an image reply — works normally.
B4. A different entry point (e.g. "Help me figure out what's next") with a photo
    — attachments must not be entry-specific.
B5. Switch language to Español, attach a photo, send a Spanish question — UI
    copy (previews, errors) localized; reply in Spanish about the document.

## Phase C — UI mechanics (no spend unless noted)
C1. THE FIX: click into the message box (focused), attach 3 photos, click the
    middle preview's ✕ once — it must vanish on first click, keyboard/caret
    retained. Repeat right after a reply arrives (composer auto-refocuses).
C2. Attach 6 files at once → "up to 5 files" notice, nothing attached; then 3,
    then 3 more → second batch refused, first 3 intact.
C3. Attach, remove all previews, verify send disables again (with empty text).
C4. Rapid double-click send on an attachment turn (1 turn spend) — exactly one
    user bubble/reply.
C5. Refresh mid-preview (before sending) — no crash, previews gone, no orphan state.
C6. Back/forward navigation after an attachment turn — thread restores, no
    attachment errors in console.
C7. Narrow the window to ~390px — previews wrap, composer usable, no horizontal
    scroll. Also full-width desktop.

## Phase D — adversarial files through the real site (no spend)
Each should produce the correct friendly notice, keep send disabled, and a good
file must still work immediately after (one combined recovery send, 1 turn):
D1. evil/photo.heic → "file type does not work here"
D2. evil/garbage.jpg, evil/zero-byte.jpg, evil/truncated.jpg → "could not be read"
    (truncated MAY decode — either a clean preview or the notice is a pass; note which)
D3. evil/actually-a-pdf.jpg → should attach as PDF (PDF tile preview)
D4. evil/actually-a-jpeg.pdf → should attach as an image preview
D5. big.pdf (>2.1 MB) → "too big to send" notice
D6. evil/gps-photo-jane-doe-eviction.jpg → attaches fine; in DevTools Network,
    inspect the /api/chat POST (do NOT send more than once, 1 turn): confirm
    payload has no "Exif", no GPS, no filename anywhere.
D7. evil/huge-8000.jpg → preview appears after downscale; note how long the
    "Getting your file ready..." state lasts.

## Phase E — environment matrix (~4 turns)
E1. Repeat A1 + C1 in Safari (closest desktop proxy for the iOS user base).
E2. Repeat A1 in Firefox if installed.
E3. Chrome DevTools network throttling "Slow 4G": one image turn — spinner
    behavior, no timeout, reply completes; note latency.
E4. DevTools device emulation (iPhone profile, touch events): A6 + C1.

## Bug protocol
On any failure: screenshot, copy console errors, note the /api/chat HTTP status
and timing from the Network tab, write exact repro steps, then CONTINUE the
suite (don't stop, don't try to fix the site). If Turnstile blocks sends
entirely, stop and report that alone.

## Deliverable
A structured report: per case — pass/fail, latency, comprehension quality
(did it cite real document contents?), screenshots, and a consolidated bug list
with repro steps + console/network evidence.
