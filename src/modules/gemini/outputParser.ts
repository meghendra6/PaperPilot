export function parseGeminiOutput(stdout: string) {
  let sessionID: string | undefined;
  let structuredOutput = false;
  let failed = false;
  let text = "";
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
        "init",
        "message",
        "tool_use",
        "tool_result",
        "result",
        "error",
      ].includes(event.type)
    )
      continue;
    structuredOutput = true;
    if (
      event.type === "init" &&
      typeof event.session_id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,199}$/.test(event.session_id)
    )
      sessionID = event.session_id;
    if (
      event.type === "message" &&
      event.role === "assistant" &&
      typeof event.content === "string"
    )
      text = event.delta ? text + event.content : event.content;
    if (event.type === "error")
      errors.push(
        String(
          event.message ??
            event.error?.message ??
            "Gemini returned an error event.",
        ),
      );
    if (event.type === "result") failed = event.status === "error";
    if (event.type === "result" && event.status === "error")
      errors.push(
        String(event.error?.message ?? "Gemini returned an error result."),
      );
  }
  return {
    text: structuredOutput ? text : stdout.trim(),
    sessionID,
    structuredOutput,
    failed,
    errorText: errors.join("\n"),
  };
}
