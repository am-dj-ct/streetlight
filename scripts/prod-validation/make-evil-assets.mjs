// Crafts adversarial test files for the attachment pipeline. All synthetic.
// - JPEGs with hand-built EXIF APP1 segments (GPS coords, orientation)
// - truncated/zero/tiny files, HEIC stub, extension lies
// - canvas-generated edge-case images (transparent PNG, panorama, 1x1, huge)
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const ASSETS = new URL("./assets/", import.meta.url).pathname;
const EVIL = new URL("./evil/", import.meta.url).pathname;
fs.mkdirSync(EVIL, { recursive: true });

// ---------- EXIF builder (little-endian TIFF) ----------
function buildExifApp1({ orientation, withGps }) {
  // Layout: TIFF header (8) + IFD0 + [GPS IFD + rational data]
  const entries0 = [];
  if (orientation) entries0.push({ tag: 0x0112, type: 3, count: 1, value: orientation });
  const gpsPointerIndex = entries0.length;
  if (withGps) entries0.push({ tag: 0x8825, type: 4, count: 1, value: 0 /* patched */ });

  const ifd0Size = 2 + entries0.length * 12 + 4;
  const gpsOffset = 8 + ifd0Size;

  let gpsBytes = Buffer.alloc(0);
  if (withGps) {
    // GPS IFD: LatRef "N", Lat 47/1 36/1 30/1 (Seattle-ish), rationals inline after IFD
    const gpsEntries = 2;
    const gpsIfdSize = 2 + gpsEntries * 12 + 4;
    const ratOffset = gpsOffset + gpsIfdSize;
    const g = Buffer.alloc(gpsIfdSize + 24);
    let p = 0;
    g.writeUInt16LE(gpsEntries, p); p += 2;
    // GPSLatitudeRef: ASCII count 2 "N\0" stored inline
    g.writeUInt16LE(0x0001, p); g.writeUInt16LE(2, p + 2); g.writeUInt32LE(2, p + 4);
    g.write("N\0\0\0", p + 8, "ascii"); p += 12;
    // GPSLatitude: RATIONAL x3 at ratOffset
    g.writeUInt16LE(0x0002, p); g.writeUInt16LE(5, p + 2); g.writeUInt32LE(3, p + 4);
    g.writeUInt32LE(ratOffset, p + 8); p += 12;
    g.writeUInt32LE(0, p); p += 4; // next IFD
    const rats = [47, 1, 36, 1, 30, 1];
    rats.forEach((v, i) => g.writeUInt32LE(v, p + i * 4));
    gpsBytes = g;
    entries0[gpsPointerIndex].value = gpsOffset;
  }

  const ifd0 = Buffer.alloc(ifd0Size);
  let q = 0;
  ifd0.writeUInt16LE(entries0.length, q); q += 2;
  for (const e of entries0) {
    ifd0.writeUInt16LE(e.tag, q);
    ifd0.writeUInt16LE(e.type, q + 2);
    ifd0.writeUInt32LE(e.count, q + 4);
    if (e.type === 3) ifd0.writeUInt16LE(e.value, q + 8);
    else ifd0.writeUInt32LE(e.value, q + 8);
    q += 12;
  }
  ifd0.writeUInt32LE(0, q); // next IFD

  const tiff = Buffer.concat([
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    ifd0,
    gpsBytes,
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const app1 = Buffer.alloc(4 + payload.length);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  return app1;
}

function injectExif(jpegPath, outPath, opts) {
  const src = fs.readFileSync(jpegPath);
  if (src[0] !== 0xff || src[1] !== 0xd8) throw new Error("not a JPEG");
  const app1 = buildExifApp1(opts);
  fs.writeFileSync(outPath, Buffer.concat([src.subarray(0, 2), app1, src.subarray(2)]));
}

const baseJpeg = path.join(ASSETS, "letter-page-1.jpg");
injectExif(baseJpeg, path.join(EVIL, "gps-photo-jane-doe-eviction.jpg"), {
  orientation: 1,
  withGps: true,
});
injectExif(baseJpeg, path.join(EVIL, "orient6-gps.jpg"), {
  orientation: 6,
  withGps: true,
});

// ---------- malformed & disguised files ----------
const goodJpeg = fs.readFileSync(baseJpeg);
fs.writeFileSync(path.join(EVIL, "truncated.jpg"), goodJpeg.subarray(0, Math.floor(goodJpeg.length * 0.4)));
fs.writeFileSync(path.join(EVIL, "zero-byte.jpg"), Buffer.alloc(0));
fs.writeFileSync(path.join(EVIL, "eight-bytes.jpg"), Buffer.from("12345678"));
// HEIC stub: [size=24][ftyp][heic][minor][compat]
const heic = Buffer.alloc(24);
heic.writeUInt32BE(24, 0);
heic.write("ftypheic", 4, "ascii");
heic.write("mif1heic", 12, "ascii");
fs.writeFileSync(path.join(EVIL, "photo.heic"), heic);
// extension lies
fs.copyFileSync(path.join(ASSETS, "letter-4pages.pdf"), path.join(EVIL, "actually-a-pdf.jpg"));
fs.copyFileSync(path.join(ASSETS, "letter-page-2.jpg"), path.join(EVIL, "actually-a-jpeg.pdf"));
// garbage with jpeg extension and plausible size
fs.writeFileSync(path.join(EVIL, "garbage.jpg"), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256)));

// ---------- canvas-generated edge cases ----------
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
await page.goto("about:blank");

async function canvasFile(name, w, h, draw, type = "image/png") {
  const dataUrl = await page.evaluate(
    ([w, h, drawSrc, type]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      new Function("ctx", "w", "h", drawSrc)(ctx, w, h);
      return c.toDataURL(type, 0.9);
    },
    [w, h, draw, type],
  );
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  fs.writeFileSync(path.join(EVIL, name), Buffer.from(b64, "base64"));
}

// Transparent PNG: transparent background, dark text — re-encode must go white, not black
await canvasFile(
  "transparent-text.png",
  600,
  400,
  `ctx.clearRect(0,0,w,h); ctx.fillStyle="#111"; ctx.font="28px serif"; ctx.fillText("RENT DUE AUGUST 15", 40, 200);`,
);
// Panorama strip 6000x60
await canvasFile(
  "panorama.jpg",
  6000,
  60,
  `ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h); ctx.fillStyle="#000"; ctx.font="40px serif"; ctx.fillText("LONG RECEIPT STRIP", 20, 45);`,
  "image/jpeg",
);
// 1x1
await canvasFile("one-pixel.png", 1, 1, `ctx.fillStyle="#f00"; ctx.fillRect(0,0,1,1);`);
// 8000x8000 with text
await canvasFile(
  "huge-8000.jpg",
  8000,
  8000,
  `ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h); ctx.fillStyle="#000"; ctx.font="300px serif"; ctx.fillText("BIG SCAN", 400, 4000);`,
  "image/jpeg",
);
await browser.close();

for (const f of fs.readdirSync(EVIL).sort()) {
  const { size } = fs.statSync(path.join(EVIL, f));
  console.log(`${f}: ${size} bytes`);
}
