import { config } from "../../../package.json";
import { getPref } from "../../utils/prefs";
import { launchDetachedShellScript } from "../ai/launchScript";
import { stopNativeStudioJob } from "./nativeProcess";
import { buildBackgroundCodexShellScript } from "../codex/shell";
import {
  createResearchWorkspaceStorage,
  getResearchWorkspaceStorageRoot,
} from "../researchWorkspace/storage";
import { assertDocumentName } from "./contracts";
import { assertRuntimeSnapshotPaths } from "./documentIdentity";
import { KernelBroker } from "./kernelBroker";
import type { StudioRepository } from "./repository";
import type { ExecutionReceipt } from "./outputProvenance";
import { documentHash } from "./documentHash";

export function nativeKernel(
  projectID: string,
  repository: StudioRepository,
  win: Window,
) {
  const files = createResearchWorkspaceStorage();
  const read = async (path: string) =>
    (await files.exists(path)) ? files.readText(path) : undefined;
  return new KernelBroker({
    scope: `${getResearchWorkspaceStorageRoot()}/runtime/${projectID}`,
    id: () => win.crypto.randomUUID(),
    read,
    write: (path, contents) => files.writeTextAtomic(path, contents),
    delay: (ms) => Zotero.Promise.delay(ms),
    createJob: async (documentID) => {
      const current = await repository.read(projectID, documentID);
      if (current.document.archived)
        throw new Error("Restore this notebook before running it.");
      const documents = (await repository.list(projectID)).documents.filter(
        (doc) => !doc.archived,
      );
      assertRuntimeSnapshotPaths(documents.map((document) => document.name));
      const directory = `${getResearchWorkspaceStorageRoot()}/runtime/${projectID}/${documentID}/${win.crypto.randomUUID()}`;
      await IOUtils.makeDirectory(`${directory}/workspace`, {
        createAncestors: true,
      });
      let total = 0;
      const inputs: ExecutionReceipt["inputs"] = [];
      for (const document of documents) {
        assertDocumentName(document.name);
        const saved = await repository.read(
          projectID,
          document.id,
          document.versions.at(-1)!.revision,
        );
        inputs.push({
          id: document.id,
          name: document.name,
          revision: document.revision,
          sha256:
            saved.version.sha256 ??
            (await documentHash(saved.base64, win.crypto.subtle)),
        });
        const bytes = Uint8Array.from(win.atob(saved.base64), (c) =>
          c.charCodeAt(0),
        );
        total += bytes.byteLength;
        if (total > 100 * 1024 * 1024)
          throw new Error(
            "This project exceeds the 100 MiB runtime snapshot limit.",
          );
        const path = `${directory}/workspace/${document.name}`;
        await IOUtils.makeDirectory(path.slice(0, path.lastIndexOf("/")), {
          createAncestors: true,
          ignoreExisting: true,
        });
        await IOUtils.write(path, bytes);
      }
      await files.writeTextAtomic(
        `${directory}/inputs.json`,
        JSON.stringify(inputs),
      );
      const source = await Zotero.File.getContentsFromURLAsync(
        `chrome://${config.addonRef}/content/studio/kernel_worker.py`,
      );
      await files.writeTextAtomic(
        `${directory}/kernel_worker.py`,
        String(source),
      );
      await files.writeTextAtomic(`${directory}/paperpilot-job-v1`, "prepared");
      return directory;
    },
    launch: async (directory, kernel) => {
      await files.writeTextAtomic(`${directory}/input.txt`, "");
      const script = buildBackgroundCodexShellScript({
        promptPath: `${directory}/input.txt`,
        outputPath: `${directory}/stdout.txt`,
        stderrPath: `${directory}/stderr.txt`,
        exitCodePath: `${directory}/exit-code`,
        pidPath: `${directory}/pid`,
        command: [
          String(getPref("studioPythonPath") || "python3"),
          `${directory}/kernel_worker.py`,
          directory,
          kernel,
        ],
      });
      await files.writeTextAtomic(`${directory}/launch-intent`, "kernel");
      const launched = await launchDetachedShellScript(
        script,
        (executable, args) => Zotero.Utilities.Internal.exec(executable, args),
      );
      if (!launched.ok) throw new Error(launched.error);
    },
    kill: stopNativeKernel,
  });
}

async function stopNativeKernel(directory: string) {
  const files = createResearchWorkspaceStorage();
  await files.writeTextAtomic(`${directory}/shutdown`, "shutdown");
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      (await files.exists(`${directory}/stopped.json`)) ||
      (await files.exists(`${directory}/exit-code`))
    )
      return stopNativeStudioJob({ directory });
    await Zotero.Promise.delay(100);
  }
  await stopNativeStudioJob({ directory });
}

export function quiesceNativeKernels(projectID: string) {
  return KernelBroker.closeScope(
    `${getResearchWorkspaceStorageRoot()}/runtime/${projectID}`,
    stopNativeKernel,
  );
}
