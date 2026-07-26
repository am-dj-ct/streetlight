// Server-side boundary-math and schema-edge checks via direct POST.
// Valid-shape cases need the mock server (production requires Turnstile);
// mock mode also means zero spend.
// Usage: node boundary.mjs [baseUrl]   (default http://localhost:3000)
const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

const b64 = (n) => "A".repeat(n);
const msg = (over = {}) => ({ id: "m1", role: "user", text: "hi", ...over });
const att = (len, mediaType = "image/jpeg") => ({ dataBase64: b64(len), mediaType });
const body = (messages) =>
  JSON.stringify({ entryId: "understand-letter-or-form", language: "en", messages });

async function post(payload) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });
  return res.status;
}

const cases = [
  // exact caps: accepted at the line, rejected one step over
  { name: "image-exactly-1500000", expect: 200, p: body([msg({ attachments: [att(1_500_000)] })]) },
  { name: "image-1500004-over", expect: 400, p: body([msg({ attachments: [att(1_500_004)] })]) },
  { name: "pdf-exactly-2800000", expect: 200, p: body([msg({ attachments: [att(2_800_000, "application/pdf")] })]) },
  { name: "pdf-2800004-over", expect: 400, p: body([msg({ attachments: [att(2_800_004, "application/pdf")] })]) },
  { name: "total-exactly-3000000", expect: 200, p: body([msg({ attachments: [att(1_500_000), att(1_500_000)] })]) },
  { name: "total-3000004-over", expect: 400, p: body([msg({ attachments: [att(1_500_000), att(1_500_004 - 4), att(8)] })]) },
  { name: "five-attachments-max", expect: 200, p: body([msg({ attachments: Array.from({ length: 5 }, () => att(400)) })]) },
  // schema edges
  { name: "mixed-4-images-plus-pdf", expect: 200, p: body([msg({ attachments: [att(400), att(400), att(400), att(400), att(400, "application/pdf")] })]) },
  { name: "webp-media-type", expect: 200, p: body([msg({ attachments: [att(400, "image/webp")] })]) },
  { name: "uppercase-media-type", expect: 400, p: body([msg({ attachments: [att(400, "IMAGE/JPEG")] })]) },
  { name: "jpeg-with-charset-suffix", expect: 400, p: body([msg({ attachments: [att(400, "image/jpeg; charset=utf-8")] })]) },
  { name: "empty-base64-string", expect: 400, p: body([msg({ attachments: [{ dataBase64: "", mediaType: "image/jpeg" }] })]) },
  { name: "base64-with-newlines", expect: 400, p: body([msg({ attachments: [{ dataBase64: "AAAA\nAAAA", mediaType: "image/jpeg" }] })]) },
  { name: "base64-with-spaces", expect: 400, p: body([msg({ attachments: [{ dataBase64: "AAAA AAAA", mediaType: "image/jpeg" }] })]) },
  { name: "base64url-alphabet-rejected", expect: 400, p: body([msg({ attachments: [{ dataBase64: "AA-_", mediaType: "image/jpeg" }] })]) },
  { name: "data-url-prefix-rejected", expect: 400, p: body([msg({ attachments: [{ dataBase64: "data:image/jpeg;base64,AAAA", mediaType: "image/jpeg" }] })]) },
  { name: "attachments-not-array", expect: 400, p: body([msg({ attachments: { 0: att(400) } })]) },
  { name: "attachment-null-entry", expect: 400, p: body([msg({ attachments: [null] })]) },
  { name: "extra-fields-on-attachment", expect: 200, note: "extra fields ignored by mapper; verify none reach provider", p: body([msg({ attachments: [{ dataBase64: "AAAA", mediaType: "image/jpeg", filename: "secret-name.jpg", path: "/home/x" }] })]) },
  // history + text interplay
  { name: "attachment-plus-8000-char-text", expect: 200, p: body([msg({ text: "x".repeat(8000), attachments: [att(400)] })]) },
  { name: "attachment-plus-8001-char-text", expect: 400, p: body([msg({ text: "x".repeat(8001), attachments: [att(400)] })]) },
  { name: "24-messages-attachment-on-last", expect: 200, p: body([
      ...Array.from({ length: 23 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", text: "t" })),
      { id: "m23", role: "user", text: "last", attachments: [att(400)] },
    ]) },
];

let failures = 0;
for (const c of cases) {
  const status = await post(c.p);
  const ok = status === c.expect;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name}: ${status} (want ${c.expect})${c.note ? ` [${c.note}]` : ""}`);
}

// concurrency: 8 simultaneous valid attachment turns
const burst = await Promise.all(
  Array.from({ length: 8 }, () => post(body([msg({ attachments: [att(200_000)] })]))),
);
const allOk = burst.every((s) => s === 200);
if (!allOk) failures += 1;
console.log(`${allOk ? "PASS" : "FAIL"} concurrent-8-valid-sends: ${JSON.stringify(burst)}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
