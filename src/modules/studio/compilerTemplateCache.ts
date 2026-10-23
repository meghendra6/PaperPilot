import type { CompileJob } from "./compiler";
import type { ResearchWorkspaceFileOps } from "../researchWorkspace/persistence/contracts";

/** Reuse only templates from this project's last successful immutable build. */
export function compilerTemplateCache(
  builds: string,
  files: ResearchWorkspaceFileOps,
  copyDirectory: (source: string, target: string) => Promise<void>,
) {
  const pointer = `${builds}/myst-template-cache.txt`;
  const templates = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new Error("Invalid MyST template cache reference.");
    return `${builds}/${id}/workspace/_build/templates`;
  };
  const jobID = (job: CompileJob) => {
    if (!job.directory.startsWith(`${builds}/`))
      throw new Error("The build does not belong to this project cache.");
    const id = job.directory.slice(builds.length + 1);
    templates(id);
    return id;
  };
  return {
    restore: async (job: CompileJob) => {
      const destination = templates(jobID(job));
      if (!(await files.exists(pointer))) return;
      const previous = await files.readText(pointer);
      if (!previous) return;
      const source = templates(previous);
      if (await files.exists(source)) await copyDirectory(source, destination);
    },
    retain: async (job: CompileJob) => {
      const id = jobID(job);
      if (await files.exists(templates(id)))
        await files.writeTextAtomic(pointer, id);
    },
  };
}
