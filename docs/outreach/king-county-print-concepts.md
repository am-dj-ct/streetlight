# King County Outreach Print Concepts

Working direction for the first Streetlight business cards and flyers.
Grounded in `docs/access_tool_thesis.md` and the approved brand foundation.

## Business Card Messaging Stacks

### 1. Utility Signal

Front:

> Free AI for anyone
>
> Help with real-life problems.
>
> Understand a letter or form. Figure out what to do next. Write something. Think something through.
>
> No login.

Back:

> Scan to use Streetlight
>
> No account. No app. No cost.
>
> Paste a letter, ask a question, or type a few words.
>
> AI can be wrong. Streetlight is a thinking partner, not an oracle.
>
> Here's my best read.

Why it works: clearest fit for a handoff moment. It leads with access, then quickly proves usefulness.

### 2. Letter First

Front:

> Confusing letter?
>
> Free AI for anyone.
>
> Streetlight can help you read it in plain language and decide what to do next.
>
> No login.

Back:

> Scan here
>
> Also helps you write something, sort out a decision, or think through a hard situation.
>
> It can be wrong. Use it like a calm thinking partner.

Why it works: most concrete and believable, especially for case managers handing someone a card during paperwork stress.

### 3. Pocket Thinking Partner

Front:

> Stuck on something?
>
> Free AI for anyone.
>
> Read. Write. Plan. Think it through.
>
> No login.

Back:

> Open Streetlight
>
> Type a few words. A letter, a question, a decision, or something hard to say.
>
> It will give its best read and help you find the next useful step.

Why it works: broadest everyday-use framing, but slightly less immediately believable than the letter/form lead.

Recommended for card: **Utility Signal**, with the Letter First use case visible in the body copy.

## Flyer Messaging Stacks

### 1. Direct Utility

Headline:

> Free AI for anyone

Body:

> Help with real-life problems:
>
> Understand a letter or form.
> Figure out what to do next.
> Write something.
> Think something through.
>
> No login. No app. No cost.
>
> Streetlight can be wrong. Use it like a thinking partner, not an oracle.

Why it works: strongest universal-first flyer. It reads quickly from a wall, table, or handout stack.

### 2. Paperwork Doorway

Headline:

> Need help understanding a letter or form?

Body:

> Streetlight is free AI for anyone.
>
> It can explain confusing wording, help you find the deadline or next step, and help you write a reply.
>
> It can also help you sort out a decision or think something through.
>
> No login. No app. No cost.

Why it works: excellent in partner offices where paperwork is the obvious starting point. Slightly narrower than the thesis wants.

### 3. Hard Moment

Headline:

> When you are stuck, start here.

Body:

> Free AI for anyone.
>
> Type a few words about a letter, form, message, decision, or hard situation.
>
> Streetlight will help you slow it down, read it clearly, and find one useful next step.
>
> No login.

Why it works: emotionally true and calm, but less instantly concrete than Direct Utility.

Recommended for flyer: **Direct Utility**, with one small line borrowing the Hard Moment promise: "Start with a few words."

## Visual Concept Directions

### 1. Signal Standard

A dark field with a warm geometric signal mark: a simple square/diamond light source with an outward glow. The layout feels like a public utility sign or late-night transit marker, not a tech brand. Big blunt headline, high contrast, quiet `Streetlight` signature.

Best for: business card and flyer system. It can scale cheaply and stay recognizable without photos.

### 2. Night Notice

A larger flyer-first direction: off-white information field under a dark top band, with the warm signal cutting down into the page. More practical for low-cost office printing while still retaining the nighttime visual world.

Best for: flyers in partner spaces where ink cost matters.

### 3. Pocket Beacon

A business-card-first direction where the QR code is treated like a lit utility panel: white QR block, warm rule/glow around it, dark surrounding field, tiny Streetlight signature.

Best for: cards that need to make scanning feel obvious and immediate.

Recommended visual system: **Signal Standard**, with a flyer variant that borrows the print economy of Night Notice.

## Original Recommended Direction

Use **Utility Signal / Direct Utility / Signal Standard**.

Reason: it is the most faithful to the thesis. It speaks to anyone, names a concrete use case, avoids service-client language, keeps Streetlight as a quiet tool rather than a campaign, and makes the trust posture visible without overexplaining it.

This direction was useful for the first draft, but the vector signal mark was
not the final visual system.

## Locked Visual Direction Update

The vector utility-sign mark was useful for getting the system started, but it
read too much like clip art. The locked direction is now a generated nighttime
street scene: an actual streetlight cropped into the top-left of frame, clearly
casting warm light over an empty street. The light source is legible, but the
lamp remains secondary. The image says "public light" without turning the
streetlight into a logo.

Final test-batch files live in `public/assets/outreach/moo-test-batch/`.

The current upload PDFs are color-managed CMYK exports. Regenerate them with
`npm run outreach:moo:print`; the script renders the card PDFs at 600 dpi, the
US Letter flyer at 300 dpi, converts through the GRACoL 2006 coated CMYK
profile with Ghostscript, verifies the embedded images as CMYK with
`pdfimages`, and copies the upload PDFs into the Desktop MOO order folder.

Final messaging:

- Front card / flyer lead: "Need help making sense of something?"
- Core promise: "Free AI to help you read, write, and think through next
  steps."
- Concrete examples stay broad: "Letters. Forms. Bills. Questions you're stuck
  on."
- Back card action language: "Scan to use Streetlight" and "Type, paste, or
  speak."
- Accessibility/value line: "Multiple languages. Free. No app. No account."
- Trust line: "For anything important, check with a person you trust."

Primary MOO upload files:

- `moo-business-card-front-upload.pdf`
- `moo-business-card-back-upload.pdf`
- `moo-us-letter-flyer-upload.pdf`

Fallback PNGs for visual checking / alternate upload:

- `moo-business-card-front-upload-300dpi.png`
- `moo-business-card-back-upload-300dpi.png`
- `moo-us-letter-flyer-upload-300dpi.png`

Source/support files:

- `public/assets/outreach/streetlight-master-left-panel.png`
- `moo-business-card-front.svg`
- `moo-business-card-back.svg`
- `moo-us-letter-flyer.svg`
- `public/assets/outreach/moo-test-batch/README.md`
- `scripts/export-moo-print-files.mjs`

Ordering recommendation:

- Order a limited MOO test batch first.
- Business cards: Original / Standard, matte, rounded corners, two-sided.
- Flyers: Premium Flyers, US Letter, matte, single-sided / blank back.
- Skip posters until cards/flyers are tested in real case-manager handoff.

MOO preview checks:

- Use the PDFs first, not PNGs.
- Confirm MOO does not add crop marks.
- Confirm all meaningful text, QR codes, and streetlight lamps sit inside the
  safe area, especially on rounded business-card corners.
- Confirm the QR codes are not cropped and remain high-contrast black on white.
