// Generates SYNTHETIC test documents (fake benefits letter pages) as
// PNG/JPEG images and a multi-page PDF, using the preinstalled Chromium.
// No real user content — everything is invented, per the repo fixture rule.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const outDir = new URL("./assets/", import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });

function letterPage(pageNumber, totalPages) {
  const bodies = [
    `<p><strong>NOTICE OF MID-CERTIFICATION REVIEW — BASIC FOOD ASSISTANCE</strong></p>
     <p>Case name: RIVER TESTCASE<br>Client ID: 000-TEST-0000<br>Case number: TEST-123456</p>
     <p>Our records show your Basic Food benefits are due for a mid-certification review.
     You must return the enclosed review form and proof of income by <strong>August 15, 2026</strong>
     or your benefits will stop on <strong>August 31, 2026</strong>.</p>`,
    `<p><strong>WHAT YOU MUST SEND</strong></p>
     <ul><li>Proof of all income received in July 2026 (pay stubs, statement from employer, or a signed note).</li>
     <li>Proof of rent or shelter costs (lease, landlord statement, or shelter letter).</li>
     <li>The signed review form, page 4 of this packet.</li></ul>
     <p>If you cannot get these documents, call us and we will help you decide what else can work.</p>`,
    `<p><strong>YOUR RIGHTS</strong></p>
     <p>If you disagree with this decision you may ask for a fair hearing within 90 days.
     You may keep getting benefits while you wait for the hearing if you ask before the change takes effect.
     Free legal help may be available.</p>`,
    `<p><strong>REVIEW FORM — SIGN AND RETURN</strong></p>
     <p>I certify the information I am reporting is true.</p>
     <p>Signature: ______________________&nbsp;&nbsp;&nbsp;Date: ____________</p>
     <p>Return by mail, fax, online, or in person by <strong>August 15, 2026</strong>.</p>`,
  ];

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, serif; width: 700px; margin: 40px; color: #111; }
    .hd { border-bottom: 3px double #333; padding-bottom: 12px; margin-bottom: 20px; }
    .hd h1 { font-size: 20px; margin: 0; } .hd p { margin: 4px 0 0; font-size: 13px; }
    .bd { font-size: 15px; line-height: 1.6; } .pg { margin-top: 30px; font-size: 12px; color: #555; }
  </style></head><body>
    <div class="hd"><h1>STATE DEPARTMENT OF SYNTHETIC SERVICES</h1>
    <p>This is a SYNTHETIC TEST DOCUMENT for software testing. Not a real notice.</p></div>
    <div class="bd">${bodies[pageNumber - 1]}</div>
    <div class="pg">Page ${pageNumber} of ${totalPages} — TEST DOCUMENT</div>
  </body></html>`;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium",
  headless: process.env.HEADED !== "1",
});
const page = await browser.newPage({ viewport: { width: 780, height: 1000 } });

for (let n = 1; n <= 4; n += 1) {
  await page.setContent(letterPage(n, 4));
  await page.screenshot({
    path: path.join(outDir, `letter-page-${n}.png`),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(outDir, `letter-page-${n}.jpg`),
    type: "jpeg",
    quality: 85,
    fullPage: true,
  });
}

// Multi-page PDF (all four pages)
await page.setContent(
  [1, 2, 3, 4]
    .map(
      (n) =>
        `<div style="page-break-after: always;">${letterPage(n, 4)
          .replace(/<\/?(!doctype |html|head|body)[^>]*>/g, "")
          .replace(/<meta[^>]*>/g, "")}</div>`,
    )
    .join(""),
);
await page.pdf({ path: path.join(outDir, "letter-4pages.pdf"), format: "Letter" });

await browser.close();

for (const f of fs.readdirSync(outDir)) {
  const { size } = fs.statSync(path.join(outDir, f));
  console.log(`${f}: ${(size / 1024).toFixed(0)} KB`);
}
