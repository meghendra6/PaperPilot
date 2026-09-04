import type { MessageRecord } from "../message/types";

const SILENT_TOOL_KEYS = new Set([
  "question",
  "topic",
  "difficulty",
  "understood",
  "confidence",
  "evaluation",
  "misunderstandings",
  "kind",
  "summary",
  "groups",
]);

function isPlainObjectShape(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textLooksLikeSilentToolJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }

  if (!isPlainObjectShape(parsed)) {
    return false;
  }

  let matches = 0;
  for (const key of Object.keys(parsed)) {
    if (SILENT_TOOL_KEYS.has(key)) {
      matches += 1;
      if (matches >= 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Best-effort detector for assistant messages produced by silent tool turns
 * (mastery, paper-workbench cards, related-recommendation requests) that were
 * persisted by versions before suppressMessage suppression existed.
 *
 * Only inspects assistant messages. Legacy tool JSON must constitute the full
 * message; prose containing an example object is kept. Fenced and indented
 * code is always treated as visible user-facing content.
 */
export function isLikelySilentToolMessage(record: MessageRecord): boolean {
  if (record.role !== "assistant") {
    return false;
  }

  const lines = record.text.split(/\r?\n/);
  if (
    lines.some(
      (line) =>
        /^(?:\s*)(?:`{3,}|~{3,})/.test(line) || /^(?: {4}|\t)/.test(line),
    )
  ) {
    return false;
  }
  return textLooksLikeSilentToolJson(record.text);
}
