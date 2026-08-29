export type ResearchWorkspaceAdmissionOwner =
  | { kind: "paper"; sourceID: string }
  | { kind: "project"; projectID: string };

interface AdmissionClaim {
  token: symbol;
  generation: number;
}

const claims = new Map<string, AdmissionClaim>();
let generation = 0;

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
  generation = 0;
}
