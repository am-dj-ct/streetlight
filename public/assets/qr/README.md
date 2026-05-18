# Streetlight QR code assets

Static QR codes encoding `https://streetlight.help`.

## Files

- `streetlight-qr.svg` — vector, infinitely scalable, primary asset for print shops
- `streetlight-qr-300.png` — 300x300px, ~1 inch at 300 DPI, business cards
- `streetlight-qr-600.png` — 600x600px, ~2 inches at 300 DPI, flyers
- `streetlight-qr-1200.png` — 1200x1200px, ~4 inches at 300 DPI, posters

## Specs

- Encoded: `https://streetlight.help` (static — destination cannot be changed without regenerating)
- Error correction: Level Q (25% damage recovery)
- Quiet zone: 4 modules
- Colors: pure black on pure white
- No logo, no styling

## Regenerating

`npm run qr:generate`

Edit `scripts/generate-qr.ts` to change URL, sizes, or error correction level.

## Print guidance

Minimum sizes for reliable scanning (10:1 rule — scanning distance ÷ 10 = minimum side length):
- Business card (scanned at ~30cm): 1 inch / 2.5cm minimum
- Flyer (scanned at ~50cm): 1.5–2 inches / 4–5cm minimum
- Poster (scanned at 1–2m): 3–4 inches / 8–10cm minimum

Always print a sample at actual final size on the actual final paper stock and test on at least 3 different phones in low light before committing to a print run.
