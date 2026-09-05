import type { MasterySession } from "./core/comprehensionCheck/v2/types";
import type { HybridIndex } from "./core/context/hybrid/types";
import type {
  CitationContext,
  ClaimLedger,
  EvidenceMatrix,
  LiteratureGraph,
} from "./core/contracts";
import type {
  CrossPaperAttempt,
  CrossPaperQuestion,
  CrossPaperSession,
} from "./core/crossPaperMastery/types";
import type {
  ResearchWorkspaceCorePaperState,
  ResearchWorkspaceCoreState,
} from "./core/researchWorkspace/state";
import type { ResearchWorkspacePaper } from "./paperSource";

/** Validated analysis state; legacy storage remains unknown until admitted by the facade. */
export interface ResearchWorkspaceAnalysisState
  extends Omit<
    ResearchWorkspaceCoreState,
    | "papers"
    | "matrices"
    | "graphs"
    | "crossPaperMastery"
    | "crossPaperQuestions"
    | "crossPaperAttempts"
    | "citationContexts"
    | "citationResults"
  > {
  papers: Record<
    string,
    ResearchWorkspaceCorePaperState &
      Partial<ResearchWorkspacePaper> & {
        mastery?: MasterySession;
        claimLedger?: ClaimLedger;
        sourceStaleAt?: string;
        sourceStaleReason?: string;
        criticalReads: ReturnType<
          typeof import("./core/criticalRead/profiled/parser").parseProfiledCriticalReadResponse
        >[];
        reproducibilityReports: ReturnType<
          typeof import("./core/reproducibility/parser").parseReproducibilityResponse
        >[];
        paperToCodeReports: ReturnType<
          typeof import("./core/paperToCode/parser").parsePaperToCodeResponse
        >[];
      }
  >;
  matrices: EvidenceMatrix[];
  graphs: LiteratureGraph[];
  crossPaperMastery: CrossPaperSession[];
  crossPaperQuestions: CrossPaperQuestion[];
  crossPaperAttempts: CrossPaperAttempt[];
  citationContexts: CitationContext[];
  citationResults: ReturnType<
    typeof import("./core/citationStance/parser").parseCitationStanceResponse
  >;
}
export interface CachedHybridIndex {
  source: string;
  index: HybridIndex;
}
