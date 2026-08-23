export type RunProfile = "chat" | "analysis" | "discovery";

export function getRunWorkspaceTitle(title: string, profile: RunProfile) {
  return profile === "chat" ? title : `${title} ${profile} workflow`;
}

export function canResumeProviderSession(profile: RunProfile) {
  return profile === "chat";
}
