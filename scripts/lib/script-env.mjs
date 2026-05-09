export function readOptionalPositiveIntegerEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return null;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer when set.`);
  }

  return Number(value);
}

export function readBooleanEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return false;
  }

  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be "true", "false", or empty.`);
  }

  return value === "true";
}
