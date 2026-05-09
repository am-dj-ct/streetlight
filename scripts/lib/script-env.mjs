export function readOptionalPositiveIntegerEnv(name) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return null;
  }

  const trimmedValue = value.trim();

  if (!/^[1-9]\d*$/.test(trimmedValue)) {
    throw new Error(`${name} must be a positive integer when set.`);
  }

  return Number(trimmedValue);
}

export function readBooleanEnv(name) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return false;
  }

  const trimmedValue = value.trim();

  if (trimmedValue !== "true" && trimmedValue !== "false") {
    throw new Error(`${name} must be "true", "false", or empty.`);
  }

  return trimmedValue === "true";
}
