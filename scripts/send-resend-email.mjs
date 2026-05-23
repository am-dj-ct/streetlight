import { readFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESOURCE_REVIEW_EMAIL_FROM;
const to = process.env.RESOURCE_REVIEW_EMAIL_TO;

if (!args.body || !args.subject) {
  throw new Error("--body and --subject are required.");
}

if (!apiKey) {
  throw new Error("RESEND_API_KEY is required.");
}

if (!from) {
  throw new Error("RESOURCE_REVIEW_EMAIL_FROM is required.");
}

if (!to) {
  throw new Error("RESOURCE_REVIEW_EMAIL_TO is required.");
}

const text = await readFile(args.body, "utf8");
const payload = {
  from,
  to: to
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean),
  subject: args.subject,
  text,
};

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Resend email failed: ${response.status} ${detail}`);
}

const result = await response.json();
console.log(`Sent Resend email ${result.id ?? "(unknown id)"}`);

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];

    if (!name.startsWith("--")) {
      continue;
    }

    const value = values[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }

    parsed[name.slice(2)] = value;
    index += 1;
  }

  return parsed;
}
