import type { ResearchWorkspacePaper } from "./paperSource";

export type CanonicalReaderCapability = "critical-read" | "paper-mastery";

export interface CanonicalReaderCapabilityDependencies {
  openReader: (attachmentID: number) => unknown | Promise<unknown>;
  findControl: (controlID: string) => { click: () => void } | undefined;
  wait: (milliseconds: number) => Promise<void>;
}

const CONTROL_IDS: Record<CanonicalReaderCapability, string> = {
  "critical-read": "chat-critical-read",
  "paper-mastery": "chat-paper-mastery",
};

function defaultDependencies(): CanonicalReaderCapabilityDependencies {
  const zotero = (globalThis as typeof globalThis & { Zotero?: any }).Zotero;
  return {
    openReader: async (attachmentID) => {
      if (!zotero?.Reader?.open) {
        throw new Error("Zotero PDF Reader is unavailable.");
      }
      await zotero.Reader.open(attachmentID, {});
    },
    findControl: (controlID) =>
      zotero?.getMainWindow?.()?.document?.getElementById?.(controlID) ??
      undefined,
    wait: (milliseconds) =>
      new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  };
}

export async function openCanonicalReaderCapability(params: {
  paper: Pick<ResearchWorkspacePaper, "attachmentID" | "sourceID">;
  capability: CanonicalReaderCapability;
  dependencies?: CanonicalReaderCapabilityDependencies;
}) {
  if (
    !Number.isInteger(params.paper.attachmentID) ||
    params.paper.attachmentID <= 0
  ) {
    throw new Error("The captured PDF attachment is unavailable.");
  }
  const dependencies = params.dependencies ?? defaultDependencies();
  await dependencies.openReader(params.paper.attachmentID);
  const controlID = CONTROL_IDS[params.capability];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const control = dependencies.findControl(controlID);
    if (control) {
      control.click();
      return {
        capability: params.capability,
        sourceID: params.paper.sourceID,
        attachmentID: params.paper.attachmentID,
        activated: true,
      } as const;
    }
    if (attempt < 7) await dependencies.wait(125);
  }
  return {
    capability: params.capability,
    sourceID: params.paper.sourceID,
    attachmentID: params.paper.attachmentID,
    activated: false,
  } as const;
}
