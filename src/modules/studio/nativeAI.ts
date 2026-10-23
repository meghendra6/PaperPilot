import { getPref } from "../../utils/prefs";
import { buildCliCommandEnvironment } from "../ai/cliEnvironment";
import { captureExecutionSettings } from "../ai/executionSettings";
import { cliSupportsFlag } from "../ai/structuredOutput";
import { launchDetachedShellScript } from "../ai/launchScript";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { resolveCodexExecutablePath } from "../codex/executable";
import { buildBackgroundCodexShellScript, shellEscape } from "../codex/shell";
import {
  createResearchWorkspaceStorage,
  getResearchWorkspaceStorageRoot,
} from "../researchWorkspace/storage";
import { StudioAIService } from "./aiService";
import { documentText } from "./documentText";
import { runStudioAI } from "./aiRunner";
import type { StudioRepository } from "./repository";
import { extractStructuredPdf } from "../tools/paperWorkspaceContent";

export function studioAIDefaults() {
  return {
    codex: captureExecutionSettings("codex_cli").model,
    claude: captureExecutionSettings("claude_code").model,
  };
}

export function nativeAI(
  projectID: string,
  repository: StudioRepository,
  win: Window,
) {
  const files = createResearchWorkspaceStorage();
  const root = getResearchWorkspaceStorageRoot();
  const read = async (path: string) =>
    (await files.exists(path)) ? files.readText(path) : undefined;
  return new StudioAIService(projectID, repository, {
    createAbortController: () => new win.AbortController(),
    root,
    files,
    id: () => win.crypto.randomUUID(),
    encode: (text) => {
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return win.btoa(binary);
    },
    text: async (name, base64, signal) => {
      const bytes = Uint8Array.from(win.atob(base64), (c) => c.charCodeAt(0));
      if (/\.pdf$/i.test(name)) {
        const directory = `${root}/runtime/context/${projectID}/${win.crypto.randomUUID()}`;
        await IOUtils.makeDirectory(directory, {
          createAncestors: true,
          ignoreExisting: true,
        });
        const path = `${directory}/document.pdf`;
        try {
          await IOUtils.write(path, bytes);
          return (await extractStructuredPdf(path, signal)).markdownText;
        } finally {
          await IOUtils.remove(directory, {
            recursive: true,
            ignoreAbsent: true,
          });
        }
      }
      return documentText(name, bytes, (xml) =>
        new win.DOMParser().parseFromString(xml, "application/xml"),
      );
    },
    run: (config, prompt, signal) =>
      runStudioAI(
        config,
        prompt,
        {
          createAbortController: () => new win.AbortController(),
          read,
          write: (path, text) => files.writeTextAtomic(path, text),
          delay: (ms) => Zotero.Promise.delay(ms),
          fetch: win.fetch.bind(win),
          prepare: async (provider) => {
            const executable =
              provider === "codex"
                ? await resolveCodexExecutablePath()
                : String(getPref("claudeExecutablePath") || "claude");
            const environment = buildCliCommandEnvironment(executable);
            for (const flag of provider === "codex"
              ? ["--ignore-user-config", "--ephemeral", "--output-schema"]
              : ["--safe-mode", "--tools", "--json-schema"]) {
              if (
                !(await cliSupportsFlag({
                  executablePath: executable,
                  helpArgs:
                    provider === "codex" ? ["exec", "--help"] : ["--help"],
                  flag,
                  environment,
                }))
              )
                throw new Error(
                  `Update ${provider}: project AI requires ${flag}.`,
                );
            }
            const directory = `${root}/runtime/${projectID}/ai/${win.crypto.randomUUID()}`;
            await IOUtils.makeDirectory(directory, {
              createAncestors: true,
              ignoreExisting: true,
            });
            return { executable, environment, directory };
          },
          launch: async (job, command) => {
            const script = buildBackgroundCodexShellScript({
              promptPath: `${job.directory}/prompt.txt`,
              outputPath: `${job.directory}/stdout.txt`,
              stderrPath: `${job.directory}/stderr.txt`,
              exitCodePath: `${job.directory}/exit-code`,
              pidPath: `${job.directory}/pid`,
              command,
              environment: job.environment,
            });
            const result = await launchDetachedShellScript(
              `cd ${shellEscape(job.directory)} && ${script}`,
              (executable, args) =>
                Zotero.Utilities.Internal.exec(executable, args),
            );
            if (!result.ok) throw new Error(result.error);
          },
          stop: async (job) => {
            for (let i = 0; i < 10; i++) {
              if (await files.exists(`${job.directory}/exit-code`)) return;
              const pid = (await read(`${job.directory}/pid`))?.trim();
              if (pid) {
                await stopDetachedRunProcess(pid, { requireProcessId: true });
                return;
              }
              await Zotero.Promise.delay(100);
            }
            throw new Error(
              `Could not confirm the AI process stopped. Inspect ${job.directory}.`,
            );
          },
        },
        signal,
      ),
  });
}
