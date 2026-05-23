# MOO Test Batch Files

Use the `*-upload.pdf` files for MOO upload. The PDFs are generated through the
repo export script as CMYK print files using the GRACoL 2006 coated profile.
MOO accepts PNGs too, so the `*-upload-300dpi.png` files are included as a
fallback and visual check, but PDF is the better first choice for this mixed
photo/text artwork.

Regenerate all upload files with:

```sh
npm run outreach:moo:print
```

The script (`scripts/export-moo-print-files.mjs`) requires Ghostscript and
Poppler (`gs` and `pdfimages`) and downloads `GRACoL2006_Coated1v2.icc` into
`tmp/icc/` when missing.

## Business Cards

MOO product:

- Standard / Original Business Cards
- 3.5 x 2.0 in trim
- Matte finish
- 16pt / Original stock
- Two-sided

Upload:

- Front: `moo-business-card-front-upload.pdf`
- Back: `moo-business-card-back-upload.pdf`

Fallback:

- Front PNG: `moo-business-card-front-upload-300dpi.png`
- Back PNG: `moo-business-card-back-upload-300dpi.png`

Specs used:

- Full bleed: 3.66 x 2.16 in
- PDF image size: 2196 x 1296 px
- PDF density: 600 dpi
- Preview PNG size: 1098 x 648 px
- Preview PNG density: 300 dpi

## Flyers

MOO product:

- Premium Flyers
- US Letter
- Matte finish
- Two-sided off / single-sided

Upload:

- `moo-us-letter-flyer-upload.pdf`

Fallback:

- PNG: `moo-us-letter-flyer-upload-300dpi.png`

Specs used:

- Full bleed: 8.66 x 11.16 in
- PDF image size: 2598 x 3348 px
- PDF density: 300 dpi
- Preview PNG size: 2598 x 3348 px
- Preview PNG density: 300 dpi

## Order Check

Before placing the order:

- Confirm MOO does not add crop marks.
- Confirm the design fills the whole bleed area.
- Confirm no important text is outside the safe area.
- Confirm the QR code is not cropped or resized below about 1 inch on the card.
- Confirm `Streetlight.help` is readable on both card sides and the flyer.
- Confirm all meaningful text, QR codes, and streetlight lamps are inside MOO's
  safe area, especially with rounded business-card corners.
- Confirm the streetlight image appears in MOO preview, not a blank dark block.
- Confirm the PDFs preview as CMYK uploads; `pdfimages -list *-upload.pdf`
  should show `cmyk` for each embedded image.
- Pick matte, not gloss.
- Order a small test batch first.

Reference pages checked:

- MOO accepted file formats: https://support.moo.com/hc/en-gb/articles/202941190-Accepted-design-file-formats
- MOO design color settings: https://support.moo.com/hc/en-us/articles/202941410-Design-color-settings
- MOO business card support: https://support.moo.com/hc/en-us/articles/360036559991-Business-Cards
- MOO flyer support: https://support.moo.com/hc/en-us/articles/360036195472-Flyers
- MOO design quick tips: https://support.moo.com/hc/en-gb/articles/209324946-Design-quick-tips
- MOO downloadable template guidance: https://support.moo.com/hc/en-us/articles/202834204-How-to-use-downloadable-templates
- MOO crop marks guidance: https://support.moo.com/hc/en-us/articles/360035605571-Removing-crop-marks

After receiving the test batch:

- Scan the QR code with at least 3 phones.
- Check the QR code in low light.
- Check whether the dark image prints muddy.
- Check whether the warm light prints too orange.
- Check whether the tiny trust language remains readable.
