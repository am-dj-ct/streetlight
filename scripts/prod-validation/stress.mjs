// No-spend stress + abuse-path checks for the attachment wire schema.
// Every request here is rejected during body/shape validation, BEFORE the
// Turnstile check and before any model call — safe to point at production.
//
// Usage: node stress.mjs [baseUrl] (default http://localhost:3000)
const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const URL_ = `${BASE}/api/chat`;

const b64 = (n) => "A".repeat(n);
const msg = (over = {}) => ({ id: "m1", role: "user", text: "hi", ...over });
const body = (messages) =>
  JSON.stringify({ entryId: "understand-letter-or-form", language: "en", messages });

async function post(payload, extraHeaders = {}) {
  const started = Date.now();
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: payload,
    });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - started, errorSnippet: text.slice(0, 120) };
  } catch (error) {
    return { status: "ERR", ms: Date.now() - started, errorSnippet: String(error).slice(0, 120) };
  }
}

const att = (len, mediaType = "image/jpeg") => ({ dataBase64: b64(len), mediaType });

const cases = [
  {
    name: "oversized-body-4.2MB",
    expect: [413],
    payload: body([msg({ attachments: [att(4_200_000)] })]),
  },
  {
    name: "way-oversized-body-6MB",
    expect: [413],
    payload: body([msg({ attachments: [att(6_000_000)] })]),
  },
  {
    name: "single-image-over-per-image-cap",
    expect: [400],
    payload: body([msg({ attachments: [att(1_600_000)] })]), // >1.5M per-image cap
  },
  {
    name: "total-attachments-over-3MB-cap",
    expect: [400],
    payload: body([
      msg({ attachments: [att(1_100_000), att(1_100_000), att(1_100_000)] }),
    ]),
  },
  {
    name: "six-attachments",
    expect: [400],
    payload: body([msg({ attachments: Array.from({ length: 6 }, () => att(1000)) })]),
  },
  {
    name: "bad-media-type-gif",
    expect: [400],
    payload: body([msg({ attachments: [att(1000, "image/gif")] })]),
  },
  {
    name: "svg-media-type",
    expect: [400],
    payload: body([msg({ attachments: [att(1000, "image/svg+xml")] })]),
  },
  {
    name: "attachment-on-earlier-message",
    expect: [400],
    payload: body([
      msg({ id: "m1", attachments: [att(1000)] }),
      { id: "m2", role: "assistant", text: "ok" },
      msg({ id: "m3" }),
    ]),
  },
  {
    name: "attachment-on-assistant-message",
    expect: [400],
    payload: body([
      msg(),
      { id: "m2", role: "assistant", text: "ok", attachments: [att(1000)] },
    ]),
  },
  {
    name: "non-base64-data",
    expect: [400],
    payload: body([msg({ attachments: [{ dataBase64: "not base64 !!!", mediaType: "image/jpeg" }] })]),
  },
  {
    name: "empty-attachments-array",
    expect: [400],
    payload: body([msg({ attachments: [] })]),
  },
  {
    name: "not-json",
    expect: [400],
    payload: "definitely not json",
  },
];

console.log(`Target: ${URL_}\n— sequential abuse cases —`);
let failures = 0;
for (const c of cases) {
  const r = await post(c.payload);
  const ok = c.expect.includes(r.status);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${c.name}: got ${r.status} in ${r.ms}ms (want ${c.expect.join("/")}) ${ok ? "" : r.errorSnippet}`,
  );
}

// Burst: concurrent near-cap bodies that all fail shape validation (bad
// media type) — exercises full-body read + parse under load, zero spend.
const BURST = Number(process.env.BURST ?? 12);
console.log(`\n— burst: ${BURST} concurrent ~3.4MB invalid bodies —`);
const burstPayload = body([
  msg({ attachments: [att(1_400_000, "image/gif"), att(1_400_000, "image/gif")] }),
]);
const burst = await Promise.all(
  Array.from({ length: BURST }, () => post(burstPayload)),
);
const times = burst.map((r) => r.ms).sort((x, y) => x - y);
const statuses = burst.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});
const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
console.log(`statuses: ${JSON.stringify(statuses)}`);
console.log(`latency ms — min ${times[0]}, p50 ${pct(50)}, p95 ${pct(95)}, max ${times.at(-1)}`);
const burstOk = burst.every((r) => r.status === 400 || r.status === 413 || r.status === 429);
if (!burstOk) failures += 1;
console.log(burstOk ? "PASS burst (all rejected safely)" : "FAIL burst (unexpected statuses)");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
