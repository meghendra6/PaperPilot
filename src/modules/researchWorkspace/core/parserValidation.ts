export function enumValue<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: ReadonlySet<T>,
): T {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  const normalized = value.trim() as T;
  if (!allowed.has(normalized)) {
    throw new Error(`${fieldName} has unsupported value: ${normalized}`);
  }
  return normalized;
}

export function optionalUnitInterval(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return Math.max(0, Math.min(1, value));
}
