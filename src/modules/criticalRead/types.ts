import type { DiscoveryResult } from "../discovery/types";

export type CriticalReadStepID = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CriticalReadStepStatus =
  | "locked"
  | "ready"
  | "running"
  | "complete";

export interface CriticalReadAgentOutput {
  summary: string;
  items: string[];
  sourceLocators: string[];
  limitations: string[];
  methodChecks?: Array<{
    area: string;
    status: "supported" | "concern" | "unclear" | "not_applicable";
    finding: string;
    sourceLocator?: string;
  }>;
  provenance?: Array<{
    source: "paper_claim" | "agent_inference";
    text: string;
    sourceLocator?: string;
  }>;
  alternatives?: Array<{
    explanation: string;
    explainedResult: string;
    challengedAssumption: string;
    discriminatingExperiment: string;
    addressedByPaper: "yes" | "partly" | "no" | "unclear";
    sourceLocator?: string;
  }>;
}

export interface CriticalReadStepState {
  id: CriticalReadStepID;
  title: string;
  instruction: string;
  requiresReaderInput: boolean;
  status: CriticalReadStepStatus;
  readerInput?: string;
  output?: CriticalReadAgentOutput;
  discovery?: DiscoveryResult;
  completedAt?: string;
  staleReason?: string;
  orientation?: {
    extractionMode: "structured-captions" | "caption-text" | "text-only";
    notice: string;
    abstract?: string;
    sourceLocations: string[];
    captions: string[];
  };
}

export interface CriticalReadState {
  schemaVersion: 1;
  phase: "idle" | "active" | "complete";
  running: boolean;
  status: string;
  currentStep: CriticalReadStepID;
  steps: CriticalReadStepState[];
  reportMarkdown?: string;
  reportNoteItemID?: number;
  startedAt?: string;
  updatedAt: string;
}
