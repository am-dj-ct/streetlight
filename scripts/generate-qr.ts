import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

const URL = 'https://streetlight.help';
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'assets', 'qr');
const ERROR_CORRECTION: 'Q' = 'Q'; // 25% damage recovery
const QUIET_ZONE = 4; // modules of whitespace around the code

const PNG_SIZES = [
  { name: 'streetlight-qr-300.png', width: 300 },   // ~1 inch at 300 DPI (business cards)
  { name: 'streetlight-qr-600.png', width: 600 },   // ~2 inches at 300 DPI (flyers)
  { name: 'streetlight-qr-1200.png', width: 1200 }, // ~4 inches at 300 DPI (posters)
];

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const svg = await QRCode.toString(URL, {
    type: 'svg',
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  await fs.writeFile(path.join(OUTPUT_DIR, 'streetlight-qr.svg'), svg);
  console.log('Wrote streetlight-qr.svg');

  for (const { name, width } of PNG_SIZES) {
    await QRCode.toFile(path.join(OUTPUT_DIR, name), URL, {
      type: 'png',
      errorCorrectionLevel: ERROR_CORRECTION,
      margin: QUIET_ZONE,
      width,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    console.log(`Wrote ${name}`);
  }

  console.log(`\nDone. Encoded URL: ${URL}`);
  console.log(`Error correction: Level ${ERROR_CORRECTION} (~25% damage recovery)`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
