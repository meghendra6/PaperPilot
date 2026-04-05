import { getPref } from "../../utils/prefs";
import { buildPaperWorkspacePath } from "../workspace/pathBuilder";
import type { CodexLoginState } from "./status";

declare const addon: any;

export type CodexRunStatus =
  | "idle"
  | "checking"
  | "ready"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "login_required";

export interface CodexRunState {
  processId?: string;
  workspacePath: string;
  workspaceWritable?: boolean;
  model: string;
  reasoningEffort?: string;
  loginState: CodexLoginState;
  runStatus: CodexRunStatus;
  latestEventType: string;
}

export function deriveCodexRunState(params: {
  workspaceRoot: string;
  model: string;
  itemID: number;
  title: string;
  loginState: CodexLoginState;
  workspaceWritable?: boolean;
  reasoningEffort?: string;
}) {
  const state: CodexRunState = {
    workspacePath: buildPaperWorkspacePath({
      root: params.workspaceRoot,
      itemID: params.itemID,
      title: params.title,
    }),
    model: params.model,
    reasoningEffort: params.reasoningEffort,
    loginState: params.loginState,
    runStatus:
      params.loginState === "ready"
        ? "ready"
        : params.loginState === "login_required"
          ? "login_required"
          : "checking",
    latestEventType: "bootstrap",
  };

  if (typeof params.workspaceWritable === "boolean") {
    state.workspaceWritable = params.workspaceWritable;
  }

  return state;
}

export function buildCodexRunState(params: {
  itemID: number;
  title: string;
  loginState: CodexLoginState;
  workspaceWritable?: boolean;
}) {
  const workspaceRoot = String(
    getPref("codexWorkspaceRoot") || "/tmp/zotero-paper-ai",
  );
  const model = String(getPref("codexDefaultModel") || "gpt-5-codex");
  const reasoningEffort = String(getPref("codexReasoningEffort") || "").trim();

  return deriveCodexRunState({
    workspaceRoot,
    model,
    reasoningEffort: reasoningEffort || undefined,
    itemID: params.itemID,
    title: params.title,
    loginState: params.loginState,
    workspaceWritable: params.workspaceWritable,
  });
}

export function setCodexRunStateForItem(itemID: number, state: CodexRunState) {
  addon.data.codexRunStates?.set(itemID, state);
}

export function getCodexRunStateForItem(itemID: number) {
  return addon.data.codexRunStates?.get(itemID);
}

export function clearCodexRunStateForItem(itemID: number) {
  addon.data.codexRunStates?.delete(itemID);
}
