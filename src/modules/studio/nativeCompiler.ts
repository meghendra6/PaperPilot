import { getPref } from "../../utils/prefs";
import { launchDetachedShellScript } from "../ai/launchScript";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { buildBackgroundCodexShellScript, shellEscape } from "../codex/shell";
import { buildCliCommandEnvironment } from "../ai/cliEnvironment";
import {
  createResearchWorkspaceStorage,
  getResearchWorkspaceStorageRoot,
} from "../researchWorkspace/storage";
import { StudioCompilerService } from "./compiler";
import { compilerTemplateCache } from "./compilerTemplateCache";
import { MAX_DOCUMENT_BYTES } from "./contracts";
import type { StudioRepository } from "./repository";

export function nativeCompiler(
  projectID: string,
  repository: StudioRepository,
  win: Window,
) {
  const files = createResearchWorkspaceStorage();
  const builds = `${getResearchWorkspaceStorageRoot()}/runtime/builds/${projectID}`;
  const read = async (path: string) =>
    (await files.exists(path)) ? files.readText(path) : undefined;
  return new StudioCompilerService(projectID, repository, {
    scope: builds,
    id: () => win.crypto.randomUUID(),
    read,
    write: (path, text) => files.writeTextAtomic(path, text),
    templates: compilerTemplateCache(builds, files, async (source, target) => {
      await IOUtils.makeDirectory(target.slice(0, target.lastIndexOf("/")), {
        createAncestors: true,
        ignoreExisting: true,
      });
      await IOUtils.copy(source, target, {
        recursive: true,
        noOverwrite: true,
      });
    }),
    delay: (ms) => Zotero.Promise.delay(ms),
    prepare: async (compiler) => {
      const directory = `${builds}/${win.crypto.randomUUID()}`;
      await IOUtils.makeDirectory(`${directory}/workspace`, {
        createAncestors: true,
      });
      await IOUtils.makeDirectory(`${directory}/output`, {
        createAncestors: true,
      });
      const executable = String(
        getPref(
          compiler === "tectonic"
            ? "studioTectonicPath"
            : compiler === "typst"
              ? "studioTypstPath"
              : "studioMystPath",
        ) || compiler,
      );
      // MyST invokes Typst by name. Respect its configured executable directory.
      const typst = String(getPref("studioTypstPath") || "");
      const environment = buildCliCommandEnvironment(executable);
      return {
        directory,
        executable,
        environment: {
          ...environment,
          TECTONIC_UNTRUSTED_MODE: "1",
          ...(typst.includes("/")
            ? {
                PATH: `${typst.slice(0, typst.lastIndexOf("/"))}:${environment.PATH || ""}`,
              }
            : {}),
        },
      };
    },
    writeBase64: async (path, base64) => {
      await IOUtils.makeDirectory(path.slice(0, path.lastIndexOf("/")), {
        createAncestors: true,
        ignoreExisting: true,
      });
      await IOUtils.write(
        path,
        Uint8Array.from(win.atob(base64), (c) => c.charCodeAt(0)),
      );
    },
    readBase64: async (path) => {
      const size = (await IOUtils.stat(path)).size;
      if (size === undefined || size > MAX_DOCUMENT_BYTES)
        throw new Error("The built PDF exceeds 50 MiB.");
      const bytes = await IOUtils.read(path);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 32768),
        );
      return win.btoa(binary);
    },
    log: async (path) => {
      if (!(await files.exists(path))) return "";
      const size = (await IOUtils.stat(path)).size;
      const bytes = await IOUtils.read(path, { maxBytes: 65536 });
      return (
        new TextDecoder().decode(bytes) +
        (size === undefined || size > bytes.length
          ? "\n[Log display limited to 64 KiB.]"
          : "")
      );
    },
    launch: async (job, command) => {
      await files.writeTextAtomic(`${job.directory}/input.txt`, "");
      const script =
        `cd ${shellEscape(`${job.directory}/workspace`)} && ` +
        buildBackgroundCodexShellScript({
          promptPath: `${job.directory}/input.txt`,
          outputPath: `${job.directory}/stdout.txt`,
          stderrPath: `${job.directory}/stderr.txt`,
          exitCodePath: `${job.directory}/exit-code`,
          pidPath: `${job.directory}/pid`,
          command,
          environment: job.environment,
        });
      const launched = await launchDetachedShellScript(script, (exe, args) =>
        Zotero.Utilities.Internal.exec(exe, args),
      );
      if (!launched.ok) throw new Error(launched.error);
    },
    stop: async (job) => {
      if (await files.exists(`${job.directory}/exit-code`)) return;
      await stopDetachedRunProcess(
        (await read(`${job.directory}/pid`))?.trim(),
        { requireProcessId: true },
      );
    },
  });
}
