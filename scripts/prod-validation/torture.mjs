// Adversarial UI torture suite for the attachment pipeline, driven through
// the real composer against the local mock server. Every case asserts at
// the wire level (intercepted /api/chat POST) or at the visible-UX level.
//
// Usage: node torture.mjs [baseUrl]   (default http://localhost:3000)
import { chromium } from "playwright-core";
import path from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const ASSETS = new URL("./assets/", import.meta.url).pathname;
const EVIL = new URL("./evil/", import.meta.url).pathname;
const a = (f) => path.join(ASSETS, f);
const e = (f) => path.join(EVIL, f);

const COPY = {
  tooLarge: "That file is too big to send",
  unsupported: "That file type does not work here",
  failed: "That file could not be read here",
  limit: "You can send up to 5 files at a time",
};

// ---------- wire helpers ----------
function jpegDims(buf) {
  // scan segments for SOF0/SOF2
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function analyzeWireImage(b64) {
  const buf = Buffer.from(b64, "base64");
  return {
    isJpeg: buf[0] === 0xff && buf[1] === 0xd8,
    hasExif: buf.includes(Buffer.from("Exif\0\0", "ascii")),
    hasGpsAscii: buf.includes(Buffer.from("GPS", "ascii")),
    hasApp1: (() => {
      let i = 2;
      while (i < buf.length - 4 && buf[i] === 0xff && buf[i + 1] !== 0xda) {
        if (buf[i + 1] === 0xe1) return true;
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return false;
    })(),
    dims: jpegDims(buf),
    bytes: buf.length,
  };
}

// ---------- harness ----------
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium",
});
const results = [];

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const posts = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/chat") && req.method() === "POST")
      posts.push(req.postData() ?? "");
  });
  await page.goto(`${BASE}/conversation/understand-letter-or-form`, {
    waitUntil: "load",
    timeout: 90_000,
  });
  await page.locator("#conversation-input").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1500); // hydration
  try {
    return await fn(page, posts);
  } finally {
    await context.close();
  }
}

const picker = (page) => page.locator('input[type="file"][multiple]');
const send = (page) => page.locator('form button[type="submit"]');

async function attach(page, files) {
  await picker(page).setInputFiles(files);
}

async function waitSendEnabled(page, timeout = 20_000) {
  await page.waitForFunction(
    () => !document.querySelector('form button[type="submit"]')?.hasAttribute("disabled"),
    null,
    { timeout },
  );
}

async function waitReplyDone(page, baseline) {
  await page.waitForFunction(
    (b) =>
      document.querySelector("section[aria-live]")?.getAttribute("aria-busy") === "false" &&
      (document.querySelector("section[aria-live]")?.textContent?.length ?? 0) > b + 40,
    baseline,
    { timeout: 60_000 },
  );
}

async function threadLen(page) {
  return page.evaluate(
    () => document.querySelector("section[aria-live]")?.textContent?.length ?? 0,
  );
}

async function bodyHas(page, text, timeout = 15_000) {
  return page
    .waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
    .then(() => true)
    .catch(() => false);
}

async function sendAndCapture(page, posts, text) {
  const before = posts.length;
  const baseline = await threadLen(page);
  if (text) await page.locator("#conversation-input").fill(text);
  await send(page).click();
  await page.waitForFunction(() => true, null, { timeout: 100 }).catch(() => {});
  const deadline = Date.now() + 20_000;
  while (posts.length <= before && Date.now() < deadline) await page.waitForTimeout(200);
  if (posts.length <= before) throw new Error("no POST fired");
  await waitReplyDone(page, baseline);
  return JSON.parse(posts[posts.length - 1]);
}

function lastAttachments(body) {
  return body.messages.at(-1).attachments ?? [];
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function run(name, fn) {
  try {
    await fn();
  } catch (error) {
    record(name, false, String(error).slice(0, 250));
  }
}

// ================= TIER 1: privacy claims =================

await run("exif-gps-stripped", () =>
  withPage(async (page, posts) => {
    await attach(page, e("gps-photo-jane-doe-eviction.jpg"));
    await waitSendEnabled(page);
    const body = await sendAndCapture(page, posts, "what is this");
    const att = lastAttachments(body);
    const info = analyzeWireImage(att[0].dataBase64);
    const raw = posts[posts.length - 1];
    const nameLeak = raw.includes("jane-doe") || raw.includes("gps-photo") || raw.includes("eviction");
    record(
      "exif-gps-stripped",
      att.length === 1 && info.isJpeg && !info.hasExif && !info.hasGpsAscii && !info.hasApp1 && !nameLeak,
      `exif=${info.hasExif} gpsAscii=${info.hasGpsAscii} app1=${info.hasApp1} filenameLeak=${nameLeak}`,
    );
  }),
);

await run("filename-never-on-wire", () =>
  withPage(async (page, posts) => {
    await attach(page, e("actually-a-pdf.jpg"));
    await waitSendEnabled(page);
    await sendAndCapture(page, posts, "check");
    const raw = posts[posts.length - 1];
    const leak = raw.includes("actually-a-pdf") || raw.includes(".jpg") || raw.includes("filename");
    record("filename-never-on-wire", !leak, leak ? "filename material found in body" : "clean");
  }),
);

await run("history-bytes-never-resent", () =>
  withPage(async (page, posts) => {
    await attach(page, a("letter-page-1.jpg"));
    await waitSendEnabled(page);
    const first = await sendAndCapture(page, posts, "first turn with photo");
    const firstB64 = lastAttachments(first)[0].dataBase64;
    const second = await sendAndCapture(page, posts, "second turn, text only");
    const raw2 = posts[posts.length - 1];
    const resent = raw2.includes("dataBase64") || raw2.includes(firstB64.slice(0, 80));
    const attachmentless = second.messages.every((m) => m.attachments === undefined);
    record(
      "history-bytes-never-resent",
      !resent && attachmentless,
      `resentBytes=${resent} historyClean=${attachmentless} turn2Bytes=${raw2.length}`,
    );
  }),
);

await run("exif-orientation-honored", () =>
  withPage(async (page, posts) => {
    // source is 780x1000 with orientation=6; a decoder that honors EXIF
    // yields 1000x780 upright pixels, one that ignores it keeps 780x1000
    await attach(page, e("orient6-gps.jpg"));
    await waitSendEnabled(page);
    const body = await sendAndCapture(page, posts, "orientation check");
    const info = analyzeWireImage(lastAttachments(body)[0].dataBase64);
    const honored = info.dims && info.dims.width === 1000 && info.dims.height === 780;
    const ignored = info.dims && info.dims.width === 780 && info.dims.height === 1000;
    record(
      "exif-orientation-honored",
      Boolean(honored),
      `wire dims=${info.dims?.width}x${info.dims?.height} ${ignored ? "(EXIF rotation IGNORED — portrait photos would arrive sideways)" : ""}`,
    );
  }),
);

// ================= TIER 2: malformed & disguised files =================

const rejectionCases = [
  { name: "reject-heic-stub", file: "photo.heic", expect: COPY.unsupported },
  { name: "reject-zero-byte", file: "zero-byte.jpg", expect: COPY.failed },
  { name: "reject-eight-bytes", file: "eight-bytes.jpg", expect: COPY.failed },
  { name: "reject-truncated-jpeg", file: "truncated.jpg", expect: null /* either failed or decodes partially */ },
  { name: "reject-garbage-jpg", file: "garbage.jpg", expect: COPY.failed },
];

for (const rc of rejectionCases) {
  await run(rc.name, () =>
    withPage(async (page) => {
      await attach(page, e(rc.file));
      if (rc.expect) {
        const shown = await bodyHas(page, rc.expect);
        const sendStillDisabled = await send(page).isDisabled();
        record(rc.name, shown && sendStillDisabled, `notice=${shown} sendDisabled=${sendStillDisabled}`);
      } else {
        // Accept either outcome, but require SOME deterministic state within 15s:
        // error notice shown, or a preview appears (partial decode)
        const outcome = await Promise.race([
          bodyHas(page, COPY.failed).then((v) => (v ? "error-notice" : null)),
          page
            .waitForFunction(() => !document.querySelector('form button[type="submit"]')?.hasAttribute("disabled"), null, { timeout: 15_000 })
            .then(() => "decoded-and-attachable")
            .catch(() => null),
        ]);
        record(rc.name, outcome !== null, `outcome=${outcome ?? "hung (no error, never attachable)"}`);
      }
    }),
  );
}

await run("error-then-recover", () =>
  withPage(async (page, posts) => {
    await attach(page, e("garbage.jpg"));
    const errShown = await bodyHas(page, COPY.failed);
    await attach(page, a("letter-page-2.jpg"));
    await waitSendEnabled(page);
    const body = await sendAndCapture(page, posts, "recovered");
    record(
      "error-then-recover",
      errShown && lastAttachments(body).length === 1,
      `errorShown=${errShown} attachmentsAfterRecovery=${lastAttachments(body).length}`,
    );
  }),
);

await run("sniff-beats-extension-pdf-as-jpg", () =>
  withPage(async (page, posts) => {
    await attach(page, e("actually-a-pdf.jpg"));
    await waitSendEnabled(page);
    const body = await sendAndCapture(page, posts, "what is this file");
    const att = lastAttachments(body);
    record(
      "sniff-beats-extension-pdf-as-jpg",
      att.length === 1 && att[0].mediaType === "application/pdf",
      `wire mediaType=${att[0]?.mediaType}`,
    );
  }),
);

await run("sniff-beats-extension-jpg-as-pdf", () =>
  withPage(async (page, posts) => {
    await attach(page, e("actually-a-jpeg.pdf"));
    await waitSendEnabled(page);
    const body = await sendAndCapture(page, posts, "and this one");
    const att = lastAttachments(body);
    const info = analyzeWireImage(att[0].dataBase64);
    record(
      "sniff-beats-extension-jpg-as-pdf",
      att.length === 1 && att[0].mediaType === "image/jpeg" && info.isJpeg,
      `wire mediaType=${att[0]?.mediaType} reencodedJpeg=${info.isJpeg}`,
    );
  }),
);

await run("transparent-png-white-background", () =>
  withPage(async (page, posts) => {
    await attach(page, e("transparent-text.png"));
    await waitSendEnabled(page);
    const body = await sendAndCapture(page, posts, "read this");
    const b64 = lastAttachments(body)[0].dataBase64;
    // Decode wire JPEG in-browser and sample a background pixel
    const corner = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(5, 5, 1, 1).data;
      return [d[0], d[1], d[2]];
    }, b64);
    const white = corner.every((v) => v > 240);
    record(
      "transparent-png-white-background",
      white,
      `corner rgb=${corner.join(",")} ${white ? "(white)" : "(NOT white — dark text could vanish on black)"}`,
    );
  }),
);

await run("downscale-dims-and-edges", () =>
  withPage(async (page, posts) => {
    await attach(page, [e("one-pixel.png"), e("panorama.jpg"), e("huge-8000.jpg")]);
    await waitSendEnabled(page, 40_000);
    const body = await sendAndCapture(page, posts, "three odd images");
    const infos = lastAttachments(body).map((x) => analyzeWireImage(x.dataBase64));
    const [px, pano, huge] = infos;
    const pxOk = px.dims?.width === 1 && px.dims?.height === 1; // no upscale
    const panoOk = pano.dims?.width === 2000 && pano.dims?.height >= 1 && pano.dims?.height <= 60;
    const hugeOk = huge.dims?.width === 2000 && huge.dims?.height === 2000;
    record(
      "downscale-dims-and-edges",
      Boolean(pxOk && panoOk && hugeOk),
      `1x1→${px.dims?.width}x${px.dims?.height}, 6000x60→${pano.dims?.width}x${pano.dims?.height}, 8000²→${huge.dims?.width}x${huge.dims?.height}`,
    );
  }),
);

await run("six-file-limit-and-partial-add", () =>
  withPage(async (page) => {
    const six = [1, 2, 3, 4].map((n) => a(`letter-page-${n}.jpg`)).concat([a("letter-page-1.png"), a("letter-page-2.png")]);
    await attach(page, six);
    const limitShown = await bodyHas(page, COPY.limit);
    const stillDisabled = await send(page).isDisabled();
    // now 3 + 3 (second batch must be refused wholesale, 3 remain)
    await attach(page, [1, 2, 3].map((n) => a(`letter-page-${n}.jpg`)));
    await waitSendEnabled(page);
    await attach(page, [a("letter-page-4.jpg"), a("letter-page-1.png"), a("letter-page-2.png")]);
    const limitShown2 = await bodyHas(page, COPY.limit);
    const previews = await page.locator('button[aria-label="Remove this file"]').count();
    record(
      "six-file-limit-and-partial-add",
      limitShown && stillDisabled && limitShown2 && previews === 3,
      `6-at-once: notice=${limitShown} blocked=${stillDisabled}; 3+3: notice=${limitShown2} kept=${previews}`,
    );
  }),
);

await run("remove-middle-preserves-order", () =>
  withPage(async (page, posts) => {
    // measure page-2's solo wire size first for identification
    await attach(page, a("letter-page-2.jpg"));
    await waitSendEnabled(page);
    const solo = await sendAndCapture(page, posts, "calibrate");
    const page2Len = lastAttachments(solo)[0].dataBase64.length;
    // fresh turn: attach 1,2,3 then remove the middle preview. Suggestions
    // and the classifier note render asynchronously after the reply and
    // shift the composer; wait for the button's position to stabilize so
    // the coordinate click lands (humans get this settling for free).
    await attach(page, [a("letter-page-1.jpg"), a("letter-page-2.jpg"), a("letter-page-3.jpg")]);
    await waitSendEnabled(page);
    let lastY = -1;
    for (let i = 0; i < 20; i += 1) {
      await page.waitForTimeout(300);
      const y = await page.evaluate(
        () =>
          document
            .querySelectorAll('button[aria-label="Remove this file"]')[1]
            ?.getBoundingClientRect().y ?? -2,
      );
      if (y === lastY) break;
      lastY = y;
    }
    await page.locator('button[aria-label="Remove this file"]').nth(1).click();
    await page.waitForTimeout(300);
    const body = await sendAndCapture(page, posts, "two left");
    const att = lastAttachments(body);
    const middleGone = att.every((x) => x.dataBase64.length !== page2Len);
    record(
      "remove-middle-preserves-order",
      att.length === 2 && middleGone,
      `count=${att.length} sizes=${att.map((x) => x.dataBase64.length).join(",")} (page2 solo=${page2Len})`,
    );
  }),
);

await run("double-click-single-post", () =>
  withPage(async (page, posts) => {
    await attach(page, a("letter-page-3.jpg"));
    await waitSendEnabled(page);
    await page.locator("#conversation-input").fill("double click test");
    const before = posts.length;
    const btn = send(page);
    await btn.click();
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(4000);
    const fired = posts.length - before;
    record("double-click-single-post", fired === 1, `POSTs fired=${fired}`);
  }),
);

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} torture cases passed against ${BASE}`);
process.exit(passed === results.length ? 0 : 1);
