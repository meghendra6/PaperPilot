import { assertDocumentName, assertStudioID } from "./documentIdentity";
import type { StudioManifest } from "./contracts";
import { notebookText, type Notebook } from "./notebook";
import { documentHash } from "./documentHash";

export async function notebookOutputHash(output: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(output));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return documentHash(btoa(binary));
}

export interface ExecutionReceipt {
  schemaVersion: 1;
  id: string;
  sessionID: string;
  notebookID: string;
  kernel: "python3" | "ir";
  code: string;
  startedAt: string;
  completedAt: string;
  inputs: Array<{ id: string; name: string; revision: number; sha256: string }>;
}

export interface OutputOrigin {
  execution: ExecutionReceipt;
  cellID: string;
  outputIndex: number;
  outputHash: string;
}

export function assertExecutionReceipt(
  value: unknown,
): asserts value is ExecutionReceipt {
  const receipt = value as ExecutionReceipt;
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    !["python3", "ir"].includes(receipt.kernel) ||
    typeof receipt.code !== "string" ||
    receipt.code.length > 1024 * 1024 ||
    !Number.isFinite(Date.parse(receipt.startedAt)) ||
    !Number.isFinite(Date.parse(receipt.completedAt)) ||
    !Array.isArray(receipt.inputs) ||
    receipt.inputs.length > 10000
  )
    throw new Error("Invalid notebook execution receipt.");
  for (const id of [receipt.id, receipt.sessionID, receipt.notebookID])
    assertStudioID(id);
  const ids = new Set<string>();
  for (const input of receipt.inputs) {
    assertStudioID(input?.id);
    assertDocumentName(input.name);
    if (
      ids.has(input.id) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      !/^[a-f0-9]{64}$/.test(input.sha256)
    )
      throw new Error("Invalid runtime input snapshot.");
    ids.add(input.id);
  }
}

export function assertOutputOrigin(
  value: unknown,
): asserts value is OutputOrigin {
  const origin = value as OutputOrigin;
  if (
    !origin ||
    !Number.isSafeInteger(origin.outputIndex) ||
    origin.outputIndex < 0 ||
    !/^[a-f0-9]{64}$/.test(origin.outputHash)
  )
    throw new Error("Invalid output origin.");
  assertStudioID(origin.cellID);
  assertExecutionReceipt(origin.execution);
}

/** Snapshot comparison, not a claim to know every file the code actually read. */
export function outputFreshness(
  origin: OutputOrigin,
  manifest: StudioManifest,
  notebook?: Notebook,
  outputHash?: string,
) {
  assertOutputOrigin(origin);
  const reasons: string[] = [];
  const source = manifest.documents.find(
    (doc) => doc.id === origin.execution.notebookID,
  );
  if (!source || source.archived)
    reasons.push("Source notebook is missing or archived.");
  const cell = notebook?.cells.find((cell) => cell.id === origin.cellID);
  if (!cell) reasons.push("Source cell is unavailable.");
  else {
    const receipt = cell.metadata.paperpilotExecution as
      | ExecutionReceipt
      | undefined;
    if (receipt?.id !== origin.execution.id)
      reasons.push("Source cell was rerun or its execution record changed.");
    if (notebookText(cell.source) !== origin.execution.code)
      reasons.push("Source code changed after execution.");
    if (outputHash !== origin.outputHash)
      reasons.push("Source output changed or was removed.");
  }
  for (const input of origin.execution.inputs) {
    if (input.id === origin.execution.notebookID) continue;
    const current = manifest.documents.find((doc) => doc.id === input.id);
    if (
      !current ||
      current.archived ||
      current.name !== input.name ||
      current.versions.at(-1)?.sha256 !== input.sha256
    )
      reasons.push(`Captured input changed: ${input.name}`);
  }
  return reasons;
}
