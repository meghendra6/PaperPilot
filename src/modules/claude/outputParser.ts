export function parseClaudeOutput(stdout: string) {
  let sessionID: string | undefined;
  let structuredOutput = false;
  let failed = false;
  let finalText = "";
  let streamed = "";
  const messages: string[] = [];
  const errors: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !event ||
      typeof event !== "object" ||
      ![
        "system",
        "assistant",
        "stream_event",
        "result",
        "error",
        "user",
      ].includes(event.type)
    )
      continue;
    structuredOutput = true;
    if (
      ["system", "result"].includes(event.type) &&
      typeof event.session_id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,199}$/.test(event.session_id)
    )
      sessionID = event.session_id;
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      const text = event.message.content
        .filter(
          (block: any) =>
            block?.type === "text" && typeof block.text === "string",
        )
        .map((block: any) => block.text)
        .join("\n");
      if (text) messages.push(text);
      streamed = "";
    }
    if (
      event.type === "stream_event" &&
      event.event?.type === "content_block_delta" &&
      event.event.delta?.type === "text_delta" &&
      typeof event.event.delta.text === "string"
    )
      streamed += event.event.delta.text;
    if (event.type === "result") {
      failed = Boolean(event.is_error);
      if (event.is_error)
        errors.push(
          typeof event.result === "string"
            ? event.result
            : "Claude returned an error result.",
        );
      else if (
        event.structured_output &&
        typeof event.structured_output === "object"
      )
        finalText = JSON.stringify(event.structured_output);
      else if (typeof event.result === "string") finalText = event.result;
    }
    if (event.type === "error" && typeof event.error?.message === "string")
      errors.push(event.error.message);
  }
  return {
    text: structuredOutput
      ? finalText || [...messages, streamed].filter(Boolean).join("\n")
      : stdout.trim(),
    sessionID,
    structuredOutput,
    failed,
    errorText: errors.join("\n"),
  };
}
