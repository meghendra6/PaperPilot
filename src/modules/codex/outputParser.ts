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
  if (event.role !== undefined && event.role !== "assistant") return [];

  if (eventType === "error") return [];

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

  if (itemRecord.role !== undefined && itemRecord.role !== "assistant")
    return [];
  return extractText(itemRecord);
}

function extractErrorEventText(event: Record<string, unknown>) {
  return event.type === "error" ? extractText(event.message) : [];
}

export function parseCodexOutput(rawOutput: string) {
  const lines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  const rawTextLines: string[] = [];
  const errorChunks: string[] = [];
  let latestEventType = "unknown";
  let structuredOutput = false;
  let failed = false;
  let sessionID: string | undefined;
  let completedAssistantText: string | undefined;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      structuredOutput = true;
      if (
        parsed.type === "thread.started" &&
        typeof parsed.thread_id === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,199}$/.test(parsed.thread_id)
      )
        sessionID = parsed.thread_id;
      if (typeof parsed.type === "string") {
        latestEventType = parsed.type;
      }
      if (parsed.type === "turn.failed") {
        failed = true;
        errorChunks.push(...extractText(parsed.error));
      }
      errorChunks.push(...extractErrorEventText(parsed));
      const assistantChunks = extractAssistantEventText(parsed);
      chunks.push(...assistantChunks);
      // Completed agent messages replace commentary and earlier snapshots.
      // Concatenating them corrupts a final structured chat answer.
      if (parsed.type === "item.completed" && assistantChunks.length)
        completedAssistantText = assistantChunks.join("\n").trim();
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
    text:
      completedAssistantText ?? (text || (!structuredOutput ? rawText : "")),
    rawText,
    errorText: errorChunks
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .join("\n")
      .trim(),
    structuredOutput,
    failed,
    sessionID,
    latestEventType,
  };
}

export function parseCodexOutputText(rawOutput: string) {
  return parseCodexOutput(rawOutput).text;
}
