import type { ResearchWorkspacePaper } from "./paperSource";
import {
  activateReaderCapability,
  type ReaderCapabilityAction,
} from "../readerCapabilityBridge";

export type CanonicalReaderCapability = ReaderCapabilityAction;

export interface CanonicalReaderCapabilityDependencies {
  openReader: (attachmentID: number) => unknown | Promise<unknown>;
  activateCapability: (
    itemID: number,
    capability: CanonicalReaderCapability,
  ) => boolean | Promise<boolean>;
}

function defaultDependencies(): CanonicalReaderCapabilityDependencies {
  const zotero = (globalThis as typeof globalThis & { Zotero?: any }).Zotero;
  return {
    openReader: async (attachmentID) => {
      if (!zotero?.Reader?.open) {
        throw new Error("Zotero PDF Reader is unavailable.");
      }
      await zotero.Reader.open(attachmentID, {});
    },
    activateCapability: (itemID, capability) =>
      activateReaderCapability(itemID, capability),
  };
}

export async function openCanonicalReaderCapability(params: {
  paper: Pick<ResearchWorkspacePaper, "attachmentID" | "itemID" | "sourceID">;
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
  const activated = await dependencies.activateCapability(
    params.paper.itemID,
    params.capability,
  );
  return {
    capability: params.capability,
    sourceID: params.paper.sourceID,
    attachmentID: params.paper.attachmentID,
    activated,
  } as const;
}
