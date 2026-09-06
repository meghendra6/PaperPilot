import type { ResearchWorkspaceProjectMember } from "./persistence/contracts";

/** Screening decisions are independent of reading and learning progress. */
export function memberScreeningDecision(
  member: ResearchWorkspaceProjectMember,
) {
  const event = member.screeningEvents?.at(-1);
  if (event) return event.decision;
  if (member.reviewStatus === "included") return "include" as const;
  if (member.reviewStatus === "excluded") return "exclude" as const;
  if (member.reviewStatus === "maybe") return "maybe" as const;
  return undefined;
}

export function isResearchWorkspaceMemberExcluded(
  member: ResearchWorkspaceProjectMember,
) {
  return memberScreeningDecision(member) === "exclude";
}

export function memberReadingProgress(member: ResearchWorkspaceProjectMember) {
  if (member.readingProgress) return member.readingProgress;
  const legacy = member.reviewStatus;
  return legacy === "up-next" || legacy === "skimmed" || legacy === "read"
    ? legacy
    : "unreviewed";
}

export function memberUnderstanding(member: ResearchWorkspaceProjectMember) {
  return (
    member.understanding ??
    (member.reviewStatus === "understood" ? "understood" : "unknown")
  );
}
