export type ResearchWorkspaceAdmissionOwner =
  | { kind: "paper"; sourceID: string }
  | { kind: "project"; projectID: string };

interface AdmissionClaim {
  token: symbol;
  generation: number;
}

const claims = new Map<string, AdmissionClaim>();
const deletingProjects = new Set<string>();
const projectTasks = new Map<string, Set<Promise<unknown>>>();
let generation = 0;

/** Tracks the whole operation, including preparation and final persistence. */
export async function runResearchWorkspaceProjectTask<T>(
  projectRoot: string,
  action: () => Promise<T>,
): Promise<T> {
  if (deletingProjects.has(projectRoot)) {
    throw new Error(
      "This project is being deleted. Finish or retry project deletion before starting another operation.",
    );
  }
  const tasks = projectTasks.get(projectRoot) ?? new Set<Promise<unknown>>();
  projectTasks.set(projectRoot, tasks);
  const task = Promise.resolve().then(action);
  tasks.add(task);
  try {
    return await task;
  } finally {
    tasks.delete(task);
    if (!tasks.size) projectTasks.delete(projectRoot);
  }
}

export function isResearchWorkspaceProjectDeleting(projectRoot: string) {
  return deletingProjects.has(projectRoot);
}

/** The barrier survives failed cleanup and service/window replacement. */
export async function quiesceResearchWorkspaceProject(projectRoot: string) {
  deletingProjects.add(projectRoot);
  while (true) {
    const tasks = projectTasks.get(projectRoot);
    if (!tasks?.size) return;
    await Promise.allSettled([...tasks]);
  }
}

/** Only call after deletion has committed, so a quick project can be recreated. */
export function releaseResearchWorkspaceProjectDeletion(projectRoot: string) {
  if (projectTasks.get(projectRoot)?.size) {
    throw new Error("Project operations have not finished yet.");
  }
  deletingProjects.delete(projectRoot);
}

export function researchWorkspaceAdmissionKey(
  owner: ResearchWorkspaceAdmissionOwner,
) {
  return owner.kind === "project"
    ? `project:${owner.projectID}`
    : `paper:${owner.sourceID}`;
}

export function claimResearchWorkspaceOwner(
  owner: ResearchWorkspaceAdmissionOwner,
) {
  const key = researchWorkspaceAdmissionKey(owner);
  if (claims.has(key)) return undefined;
  const claim = {
    token: Symbol(key),
    generation: (generation += 1),
  };
  claims.set(key, claim);
  return claim;
}

export function isResearchWorkspaceOwnerClaimCurrent(
  owner: ResearchWorkspaceAdmissionOwner,
  claim: AdmissionClaim,
) {
  const current = claims.get(researchWorkspaceAdmissionKey(owner));
  return (
    current?.token === claim.token && current.generation === claim.generation
  );
}

export function releaseResearchWorkspaceOwner(
  owner: ResearchWorkspaceAdmissionOwner,
  claim: AdmissionClaim,
) {
  if (isResearchWorkspaceOwnerClaimCurrent(owner, claim)) {
    claims.delete(researchWorkspaceAdmissionKey(owner));
  }
}

export function isResearchWorkspaceOwnerActive(
  owner: ResearchWorkspaceAdmissionOwner,
) {
  return claims.has(researchWorkspaceAdmissionKey(owner));
}

export function resetResearchWorkspaceAdmissionsForTests() {
  claims.clear();
  deletingProjects.clear();
  projectTasks.clear();
  generation = 0;
}
