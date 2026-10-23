import { buildCodexExecCommand } from "../codex/commandBuilder";
import { parseCodexOutput } from "../codex/outputParser";
import { parseClaudeOutput } from "../claude/outputParser";
import {
  STUDIO_AI_SCHEMA,
  validateAIConfig,
  type StudioAIConfig,
} from "./aiContracts";

export interface StudioCLIJob {
  directory: string;
  executable: string;
  environment?: Record<string, string | undefined>;
}
export interface StudioRunnerPorts {
  createAbortController?(): AbortController;
  prepare(provider: "codex" | "claude"): Promise<StudioCLIJob>;
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string | undefined>;
  launch(job: StudioCLIJob, command: string[]): Promise<void>;
  stop(job: StudioCLIJob): Promise<void>;
  delay(ms: number): Promise<void>;
  fetch: typeof fetch;
}

export function studioCLICommand(config: StudioAIConfig, job: StudioCLIJob) {
  if (config.provider === "codex") {
    const command = buildCodexExecCommand(
      {
        cd: job.directory,
        model: config.model,
        sandbox: "read-only",
        approvalMode: "never",
        skipGitRepoCheck: true,
        outputSchemaPath: `${job.directory}/schema.json`,
      },
      job.executable,
    );
    command.splice(
      command.length - 1,
      0,
      "--ignore-user-config",
      "--ephemeral",
    );
    // This workflow proposes edits from supplied context; it needs no host,
    // browser, connector, image, or delegation tools.
    for (const feature of [
      "shell_tool",
      "unified_exec",
      "apps",
      "browser_use",
      "computer_use",
      "multi_agent",
      "view_image",
      "tool_suggest",
      "skill_search",
    ])
      command.splice(command.length - 1, 0, "-c", `features.${feature}=false`);
    command.splice(command.length - 1, 0, "-c", 'web_search="disabled"');
    return command;
  }
  if (config.provider !== "claude")
    throw new Error("This provider is not a local CLI.");
  return [
    job.executable,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    config.model,
    "--tools",
    "",
    "--safe-mode",
    "--permission-mode",
    "plan",
    "--disable-slash-commands",
    "--json-schema",
    JSON.stringify(STUDIO_AI_SCHEMA),
  ];
}

async function networkRun(
  config: StudioAIConfig,
  prompt: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const endpoint = `${config.endpoint!.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok)
    throw new Error(
      `Model endpoint returned HTTP ${response.status}. Check the provider, model, and credentials.`,
    );
  if (!response.body)
    throw new Error("Model endpoint returned no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4 * 1024 * 1024)
        throw new Error("Model response exceeds 4 MiB.");
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  const data = JSON.parse(text);
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new Error(
      "The model stopped at its output limit. Ask for a smaller change.",
    );
  const content = choice?.message?.content;
  if (typeof content !== "string")
    throw new Error("Model response has no assistant text.");
  return content.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/, "$1");
}

/** Detached file jobs use the same completion contract and cadence as paper runs. */
export async function runStudioAI(
  config: StudioAIConfig,
  prompt: string,
  ports: StudioRunnerPorts,
  signal: AbortSignal,
) {
  validateAIConfig(config);
  const timeout = ports.createAbortController?.() ?? new AbortController();
  const cancel = () => timeout.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const deadline = setTimeout(cancel, 240000);
  let job: StudioCLIJob | undefined;
  let launched = false;
  let complete = false;
  try {
    if (timeout.signal.aborted) throw new Error("AI run canceled.");
    if (config.provider === "local")
      return await networkRun(config, prompt, timeout.signal, ports.fetch);
    job = await ports.prepare(config.provider);
    await ports.write(`${job.directory}/prompt.txt`, prompt);
    await ports.write(
      `${job.directory}/schema.json`,
      JSON.stringify(STUDIO_AI_SCHEMA),
    );
    if (timeout.signal.aborted) throw new Error("AI run canceled.");
    // Mark before launch: a launch acknowledgment can fail after creating a process.
    launched = true;
    await ports.launch(job, studioCLICommand(config, job));
    while (!timeout.signal.aborted) {
      const code = await ports.read(`${job.directory}/exit-code`);
      if (code !== undefined) {
        complete = true;
        const stdout = (await ports.read(`${job.directory}/stdout.txt`)) ?? "";
        const parsed =
          config.provider === "codex"
            ? parseCodexOutput(stdout)
            : parseClaudeOutput(stdout);
        if (code.trim() !== "0" || parsed.failed || !parsed.text)
          throw new Error(
            parsed.errorText ||
              `The ${config.provider} CLI failed (exit ${code.trim()}). See the owned run's stderr.txt.`,
          );
        return parsed.text;
      }
      await ports.delay(800);
    }
    throw new Error(
      signal.aborted
        ? "AI run canceled."
        : "AI run exceeded four minutes and was stopped.",
    );
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", cancel);
    if (job && launched && !complete) await ports.stop(job);
  }
}
