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

function isCodeFenceLine(line: string) {
  return line.startsWith("```");
}

function isPlainObjectShape(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lineLooksLikeSilentToolJson(line: string) {
  const trimmed = line.trim();
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
 * Only inspects assistant messages. Walks lines top-to-bottom and ignores
 * anything inside fenced code blocks so that legitimate JSON examples in chat
 * are not hidden.
 */
export function isLikelySilentToolMessage(record: MessageRecord): boolean {
  if (record.role !== "assistant") {
    return false;
  }

  let insideFence = false;
  for (const line of record.text.split(/\r?\n/)) {
    if (isCodeFenceLine(line.trim())) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) {
      continue;
    }
    if (lineLooksLikeSilentToolJson(line)) {
      return true;
    }
  }
  return false;
}
