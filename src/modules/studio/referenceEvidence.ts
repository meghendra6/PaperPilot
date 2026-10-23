import { buildContradictionGapDashboard } from "../researchWorkspace/contradictionGap";
import type { ResearchWorkspaceProjectDetails } from "../researchWorkspace/projectController";
import type { EvidenceReferenceV2 } from "../researchWorkspace/evidenceVerification";

export interface ReferencePassage {
  atomID: string;
  evidenceIndex: number;
  statement: string;
  quote: string;
  page: string;
  reference: EvidenceReferenceV2;
}

/** Reuse the workspace's source scope, exclusion, fingerprint and verifier gates. */
export function referencePassages(
  details: ResearchWorkspaceProjectDetails,
  citationKey: string,
): ReferencePassage[] {
  const sourceIDs = new Set(
    details.sources
      .filter(
        (source) =>
          citationKey ===
          `pp_${source.identity.libraryID}_${source.identity.itemKey}`,
      )
      .map((source) => source.sourceID),
  );
  if (!sourceIDs.size) return [];
  const dashboard = buildContradictionGapDashboard({
    details,
    generatedAt: new Date().toISOString(),
  });
  return dashboard.atoms
    .filter((atom) => sourceIDs.has(atom.sourceID))
    .flatMap((atom) =>
      atom.evidence.flatMap((reference, evidenceIndex) =>
        reference.exactQuote
          ? [
              {
                atomID: atom.atomID,
                evidenceIndex,
                statement: atom.statement,
                quote: reference.exactQuote,
                page:
                  reference.pageLabel ??
                  (reference.pageIndex === undefined
                    ? "unknown page"
                    : String(reference.pageIndex + 1)),
                reference,
              },
            ]
          : [],
      ),
    );
}
