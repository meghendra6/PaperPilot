export interface ResearchWorkspaceReceiptContract<TFile> {
  schemaVersion: 1;
  parse(value: unknown): TFile;
}

let contract: ResearchWorkspaceReceiptContract<unknown> | undefined;

export function registerResearchWorkspaceReceiptContract<TFile>(
  value: ResearchWorkspaceReceiptContract<TFile>,
) {
  contract = value as ResearchWorkspaceReceiptContract<unknown>;
}

export function getResearchWorkspaceReceiptContract<TFile>() {
  if (!contract) {
    throw new Error("Research Workspace receipt contract is not registered.");
  }
  return contract as ResearchWorkspaceReceiptContract<TFile>;
}
