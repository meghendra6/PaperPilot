import {
  assertRequestContextCurrent,
  type RequestContextSnapshot,
} from "../context/requestContext";
import {
  extractPdfTextPages,
  matchQuoteInPages,
} from "../autoHighlight/pdfMatch";
import type { PDFPageText } from "../autoHighlight/types";
import {
  ResearchWorkspaceEvidenceVerifier,
  type EvidenceVerificationDependencies,
} from "../researchWorkspace/evidenceVerification";
import {
  openVerifiedResearchWorkspaceEvidence,
  type EvidenceNavigationDependencies,
} from "../researchWorkspace/evidenceNavigation";
import {
  normalizeChatCitationCandidates,
  type ChatCitationCandidate,
} from "./chatAnswer";
import type { ChatCitation } from "./chatTypes";

export interface ChatCitationDependencies
  extends EvidenceVerificationDependencies {
  assertCurrent?: (snapshot: RequestContextSnapshot) => Promise<void>;
  navigation?: EvidenceNavigationDependencies;
}

export async function verifyChatCitations(
  candidates: ChatCitationCandidate[],
  snapshot: RequestContextSnapshot,
  dependencies: ChatCitationDependencies = {},
): Promise<ChatCitation[]> {
  const admitted = normalizeChatCitationCandidates(
    candidates,
    new Set([snapshot.sourceID]),
  );
  const base = (candidate: ChatCitationCandidate): ChatCitation => ({
    ...candidate,
    sourceFingerprint: snapshot.contentFingerprint,
    status: "unverified",
  });
  const assertCurrent =
    dependencies.assertCurrent ?? assertRequestContextCurrent;
  try {
    await assertCurrent(snapshot);
  } catch {
    return admitted.map((candidate) => ({
      ...base(candidate),
      status: "stale",
    }));
  }
  let extractedPages: PDFPageText[] | undefined;
  const verifier = new ResearchWorkspaceEvidenceVerifier(
    [
      {
        sourceID: snapshot.sourceID,
        libraryID: snapshot.source.libraryID,
        attachmentKey: snapshot.source.attachmentKey,
        attachmentID: snapshot.attachmentID,
        contentFingerprint: snapshot.contentFingerprint,
      },
    ],
    {
      ...dependencies,
      extractPages: async (path) => {
        extractedPages = await (
          dependencies.extractPages ?? extractPdfTextPages
        )(path);
        return extractedPages;
      },
    },
  );
  const citations: ChatCitation[] = [];
  for (const candidate of admitted) {
    let reference = await verifier.verify({
      ...candidate,
      quote: candidate.quote,
      libraryID: snapshot.source.libraryID,
      attachmentKey: snapshot.source.attachmentKey,
    });
    // The shared verifier accepts older 1200-character references. A longer chat
    // quote must match in full, never inherit verification from only its prefix.
    if (
      reference?.verification.status === "verified" &&
      candidate.quote.length > 1200
    ) {
      const fullMatch =
        extractedPages && matchQuoteInPages(candidate.quote, extractedPages);
      if (
        !fullMatch ||
        (candidate.pageIndex !== undefined &&
          fullMatch.pageIndex !== candidate.pageIndex)
      ) {
        reference = {
          ...reference,
          verification: { status: "not-found", method: "pdf-exact-quote" },
        };
      } else
        reference = {
          ...reference,
          exactQuote: fullMatch.quote,
          pageIndex: fullMatch.pageIndex,
          pageLabel: fullMatch.pageLabel,
          boundingBoxes: fullMatch.rects.map((rect) => ({
            pageIndex: fullMatch.pageIndex,
            rect: rect.slice(0, 4) as [number, number, number, number],
          })),
        };
    }
    citations.push({
      ...base(candidate),
      status: reference?.verification.status ?? "unverified",
      ...(reference ? { reference } : {}),
    });
  }
  try {
    await assertCurrent(snapshot);
  } catch {
    return citations.map((citation) => ({
      ...citation,
      status: "stale",
      reference: undefined,
    }));
  }
  return citations;
}

export async function openChatCitation(
  citation: ChatCitation,
  snapshot: RequestContextSnapshot,
  dependencies: ChatCitationDependencies = {},
) {
  if (
    citation.sourceID !== snapshot.sourceID ||
    citation.sourceFingerprint !== snapshot.contentFingerprint
  )
    throw new Error(
      "The source has changed. Verify the quote against the current PDF first.",
    );
  const [current] = await verifyChatCitations(
    [
      {
        id: citation.id,
        sourceID: citation.sourceID,
        quote: citation.quote,
        ...(citation.pageIndex === undefined
          ? {}
          : { pageIndex: citation.pageIndex }),
      },
    ],
    snapshot,
    dependencies,
  );
  if (!current?.reference || current.status !== "verified")
    throw new Error("The quote cannot be verified in the current PDF.");
  await openVerifiedResearchWorkspaceEvidence(
    current.reference,
    dependencies.navigation,
  );
}

export function chatCitationLabel(citation: ChatCitation) {
  return citation.status === "verified"
    ? "PDF passage matched"
    : citation.status === "stale"
      ? "Source changed"
      : citation.status === "source-unavailable"
        ? "PDF unavailable"
        : "Location unverified";
}
