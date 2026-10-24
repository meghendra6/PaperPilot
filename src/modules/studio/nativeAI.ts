import { getPref } from "../../utils/prefs";
import { buildCliCommandEnvironment } from "../ai/cliEnvironment";
import { captureExecutionSettings } from "../ai/executionSettings";
import { cliSupportsFlag } from "../ai/structuredOutput";
import { launchDetachedShellScript } from "../ai/launchScript";
import { resolveCodexExecutablePath } from "../codex/executable";
import { buildBackgroundCodexShellScript, shellEscape } from "../codex/shell";
import {
  createResearchWorkspaceStorage,
  getResearchWorkspaceStorageRoot,
} from "../researchWorkspace/storage";
import { StudioAIService } from "./aiService";
import { studioModelDefaults } from "./aiModels";
import { documentText } from "./documentText";
import { runStudioAI, cleanupStudioRunnerScope } from "./aiRunner";
import { stopNativeStudioJob } from "./nativeProcess";
import { researchProjectDirectory } from "../researchWorkspace/persistence/paths";
import type { StudioRepository } from "./repository";
import {
  extractStructuredPdf,
  ExtractorCleanupUnconfirmedError,
} from "../tools/paperWorkspaceContent";

/** The project's default engine wins over the reader's default mode. */
export function studioAIDefaults(projectEngineMode?: string) {
  return studioModelDefaults({
    engineMode: projectEngineMode ?? String(getPref("defaultMode") || ""),
    codexModel: captureExecutionSettings("codex_cli").model,
    claudeModel: captureExecutionSettings("claude_code").model,
    codexAllowed: String(getPref("codexAllowedModels") || ""),
    claudeAllowed: String(getPref("claudeAllowedModels") || ""),
  });
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
        let retain = false;
        try {
          await IOUtils.write(path, bytes);
          return (
            await extractStructuredPdf(path, signal, { outputRoot: directory })
          ).markdownText;
        } catch (error) {
          retain = error instanceof ExtractorCleanupUnconfirmedError;
          throw error;
        } finally {
          if (!retain)
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
          scope: `${root}/runtime/${projectID}/ai`,
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
            await files.writeTextAtomic(
              `${directory}/paperpilot-job-v1`,
              "prepared",
            );
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
            await files.writeTextAtomic(
              `${job.directory}/launch-intent`,
              "studio-ai",
            );
            const result = await launchDetachedShellScript(
              `cd ${shellEscape(job.directory)} && ${script}`,
              (executable, args) =>
                Zotero.Utilities.Internal.exec(executable, args),
            );
            if (!result.ok) throw new Error(result.error);
          },
          stop: stopNativeStudioJob,
        },
        signal,
      ),
  });
}

export async function quiesceNativeAI(projectID: string) {
  const root = getResearchWorkspaceStorageRoot();
  await StudioAIService.quiesceScope(
    `${researchProjectDirectory(root, projectID)}/studio-conversation-v1.json`,
  );
  await cleanupStudioRunnerScope(
    `${root}/runtime/${projectID}/ai`,
    stopNativeStudioJob,
  );
}
