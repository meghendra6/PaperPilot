import type { CSL } from "@citation-js/core";

export type StudioReference = CSL & { id: string };
export const REFERENCE_KEY = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export function validateReferences(value: unknown): StudioReference[] {
  if (!Array.isArray(value) || value.length > 5000)
    throw new Error("A reference list must contain at most 5,000 CSL records.");
  const keys = new Set<string>();
  return value.map((record) => {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      !REFERENCE_KEY.test(record.id) ||
      keys.has(record.id) ||
      typeof record.type !== "string" ||
      !record.type ||
      typeof record.title !== "string" ||
      !record.title.trim()
    )
      throw new Error(
        "References need unique citation keys, types and titles. Edit the source to repair invalid entries.",
      );
    keys.add(record.id);
    return record as StudioReference;
  });
}
