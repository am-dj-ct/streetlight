export function isOneOf<const TValue extends string>(
  allowedValues: readonly TValue[],
  value: null | string | undefined,
): value is TValue {
  return typeof value === "string" && allowedValues.includes(value as TValue);
}
