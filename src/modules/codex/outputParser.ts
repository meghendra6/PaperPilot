function extractText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractText);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...extractText(record.text),
      ...extractText(record.content),
      ...extractText(record.message),
      ...extractText(record.delta),
      ...extractText(record.output_text),
    ];
  }

  return [];
}

function extractAssistantEventText(event: Record<string, unknown>) {
  const eventType = typeof event.type === "string" ? event.type : "unknown";

  if (eventType === "error") {
    return extractText(event.message);
  }

  if (
    eventType === "message" ||
    eventType === "delta" ||
    eventType.includes("output_text")
  ) {
    return extractText(event);
  }

  if (eventType !== "item.completed" && eventType !== "item.started") {
    return [];
  }

  const item = event.item;
  if (!item || typeof item !== "object") {
    return [];
  }

  const itemRecord = item as Record<string, unknown>;
  const itemType =
    typeof itemRecord.type === "string" ? itemRecord.type : "unknown";
  const assistantItemTypes = new Set([
    "agent_message",
    "assistant_message",
    "message",
    "output_text",
  ]);

  if (!assistantItemTypes.has(itemType)) {
    return [];
  }

  return extractText(itemRecord);
}

export function parseCodexOutput(rawOutput: string) {
  const lines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  const rawTextLines: string[] = [];
  let latestEventType = "unknown";
  let structuredOutput = false;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      structuredOutput = true;
      if (typeof parsed.type === "string") {
        latestEventType = parsed.type;
      }
      chunks.push(...extractAssistantEventText(parsed));
    } catch {
      rawTextLines.push(line);
    }
  }

  const text = chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  const rawText = rawTextLines.join("\n").trim();

  return {
    text: text || (!structuredOutput ? rawText : ""),
    rawText,
    structuredOutput,
    latestEventType,
  };
}

export function parseCodexOutputText(rawOutput: string) {
  return parseCodexOutput(rawOutput).text;
}
