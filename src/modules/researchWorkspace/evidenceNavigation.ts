import {
  ResearchWorkspaceEvidenceVerifier,
  type EvidenceReferenceV2,
  type EvidenceVerificationDependencies,
} from "./evidenceVerification";
import { parseZoteroSourceID } from "./sourceIdentity";

export interface EvidenceNavigationLocation {
  pageIndex: number;
  position: {
    pageIndex: number;
    rects: number[][];
  };
}

export interface EvidenceNavigationDependencies {
  getByLibraryAndKey?: (
    libraryID: number,
    attachmentKey: string,
  ) => unknown | Promise<unknown>;
  openReader?: (
    attachmentID: number,
    options: EvidenceNavigationLocation,
  ) => unknown | Promise<unknown>;
  extractPages?: EvidenceVerificationDependencies["extractPages"];
  /** Chat supplies its source-fingerprint-aware, click-time verifier. */
  verifyCurrent?: () => Promise<EvidenceReferenceV2 | null>;
}

function defaultDependencies(): EvidenceNavigationDependencies {
  const zotero = (globalThis as typeof globalThis & { Zotero?: any }).Zotero;
  return {
    getByLibraryAndKey: (libraryID, attachmentKey) =>
      zotero?.Items?.getByLibraryAndKey?.(libraryID, attachmentKey),
    openReader: zotero?.Reader?.open
      ? (attachmentID, options) => zotero.Reader.open(attachmentID, options)
      : undefined,
  };
}

export async function openVerifiedResearchWorkspaceEvidence(
  reference: EvidenceReferenceV2,
  dependencies: EvidenceNavigationDependencies = {},
) {
  dependencies = { ...defaultDependencies(), ...dependencies };
  if (reference?.verification?.status !== "verified") {
    throw new Error("Only locally verified evidence can be opened in the PDF.");
  }
  const identity = parseZoteroSourceID(reference.sourceID);
  if (
    !identity ||
    identity.libraryID !== reference.libraryID ||
    identity.attachmentKey !== reference.attachmentKey
  ) {
    throw new Error("The evidence source identity is invalid or stale.");
  }
  if (!dependencies.getByLibraryAndKey) {
    throw new Error("Library-scoped Zotero item lookup is unavailable.");
  }
  const attachment = (await Promise.resolve(
    dependencies.getByLibraryAndKey(
      reference.libraryID,
      reference.attachmentKey,
    ),
  )) as
    | {
        id?: number;
        key?: string;
        libraryID?: number;
        getFilePathAsync?: () => Promise<string | undefined>;
      }
    | undefined;
  if (
    !attachment ||
    Number(attachment.libraryID) !== reference.libraryID ||
    String(attachment.key || "") !== reference.attachmentKey ||
    !Number.isInteger(Number(attachment.id)) ||
    Number(attachment.id) <= 0
  ) {
    throw new Error("The exact Zotero evidence attachment is unavailable.");
  }
  const attachmentID = Number(attachment.id);
  const current = dependencies.verifyCurrent
    ? await dependencies.verifyCurrent()
    : await new ResearchWorkspaceEvidenceVerifier(
        [
          {
            sourceID: reference.sourceID,
            libraryID: reference.libraryID,
            attachmentKey: reference.attachmentKey,
            attachmentID,
          },
        ],
        {
          resolveAttachment: async () => attachment,
          extractPages: dependencies.extractPages,
        },
      ).verify(reference);
  if (
    current?.verification.status !== "verified" ||
    current.sourceID !== reference.sourceID ||
    current.libraryID !== reference.libraryID ||
    current.attachmentKey !== reference.attachmentKey ||
    !Number.isInteger(current.pageIndex) ||
    Number(current.pageIndex) < 0
  ) {
    throw new Error("The quote cannot be verified in the current PDF.");
  }
  const pageIndex = Number(current.pageIndex);
  const boxes = current.boundingBoxes;
  if (
    !boxes?.length ||
    boxes.some(
      (box) =>
        box.pageIndex !== pageIndex ||
        box.rect.length !== 4 ||
        !box.rect.every(Number.isFinite) ||
        box.rect[2] <= box.rect[0] ||
        box.rect[3] <= box.rect[1],
    )
  ) {
    throw new Error("The verified PDF passage geometry is unavailable.");
  }
  const options: EvidenceNavigationLocation = {
    pageIndex,
    position: { pageIndex, rects: boxes.map((box) => [...box.rect]) },
  };
  if (dependencies.openReader) {
    await dependencies.openReader(attachmentID, options);
    return;
  }
  throw new Error("Zotero PDF navigation is unavailable.");
}
