export function parseStrictIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed)) {
    return null;
  }

  const normalized = new Date(parsed).toISOString().slice(0, 10);

  return normalized === value ? parsed : null;
}
