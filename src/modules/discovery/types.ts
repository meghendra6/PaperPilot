export type DiscoveryIntent = "prior_work" | "novelty_check" | "mixed";

export type ResearchConcernOrigin =
  | "current_paper"
  | "selection"
  | "limitation"
  | "follow_up"
  | "user_text";

export interface ResearchConcern {
  text: string;
  origin: ResearchConcernOrigin;
  sourceLocator?: string;
}

export interface DiscoveryRequest {
  schemaVersion: 1;
  itemID: number;
  sessionID: string;
  concern: ResearchConcern;
  intent: DiscoveryIntent;
  responseLanguage: string;
  createdAt: string;
}

export type LeadingVenueJudgment =
  | "leading"
  | "plausibly_leading"
  | "not_leading"
  | "unknown";

export interface LeadingVenueAssessment {
  venueName: string;
  venueAcronym?: string;
  fields: string[];
  judgment: LeadingVenueJudgment;
  confidence: "high" | "medium" | "low";
  basis: string;
}

export interface DiscoveryQuery {
  query: string;
  family: string;
  rationale: string;
  venueTarget?: string;
  freshness?: "archival" | "recent";
}

export interface AgentSearchPlan {
  concernSummary: string;
  primaryField: string;
  adjacentFields: string[];
  venues: LeadingVenueAssessment[];
  queries: DiscoveryQuery[];
  scopeSummary: string;
}

export type PublicationEvidenceType =
  | "official_proceedings"
  | "official_program"
  | "official_decision"
  | "publisher_proceedings"
  | "official_anthology"
  | "scholarly_index"
  | "author_claim"
  | "search_result";

export type PublicationEvidenceSupport =
  | "identity"
  | "published"
  | "accepted"
  | "main_track"
  | "reviews_available";

export interface PublicationEvidence {
  type: PublicationEvidenceType;
  sourceName: string;
  url: string;
  observedTitle?: string;
  observedVenue?: string;
  observedTrack?: string;
  observedDecision?: string;
  checkedAt: string;
  supports: PublicationEvidenceSupport[];
}

export type PublicationClass =
  | "verified_main"
  | "verified_workshop"
  | "verified_findings"
  | "verified_demo"
  | "verified_industry"
  | "verified_shared_task"
  | "verified_tutorial_or_abstract"
  | "verified_journal"
  | "published_track_unknown"
  | "preprint_only"
  | "under_review_or_submission"
  | "rejected_or_withdrawn"
  | "unverified";

export type EvidenceConfidence = "high" | "medium" | "low" | "none";
export type RelationshipStrength = "direct" | "strong" | "adjacent";

export type NoveltyRelationship =
  | "same_problem_same_core_method"
  | "same_problem_different_method"
  | "same_method_different_setting"
  | "extends_or_generalizes"
  | "contradicts_or_challenges"
  | "background_or_foundational"
  | "no_material_collision"
  | "unclear";

export interface PublicReviewInsight {
  sourceURLs: string[];
  valuedStrengths: string[];
  concerns: string[];
  reviewerPriorities: string[];
  disagreements: string[];
  authorResponseContext?: string;
  decisionContext?: string;
  limitations: string[];
  generatedAt: string;
}

export interface DiscoveredPaper {
  candidateID: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  urls: string[];
  providerIDs: Record<string, string>;
  venueName?: string;
  venueAcronym?: string;
  track?: string;
  publicationClass: PublicationClass;
  publicationEvidence: PublicationEvidence[];
  evidenceConfidence: EvidenceConfidence;
  leadingVenueAssessment: LeadingVenueAssessment;
  relationship: RelationshipStrength;
  relevanceReason: string;
  keyDifference?: string;
  noveltyRelationship: NoveltyRelationship;
  reviewURL?: string;
  reviewInsight?: PublicReviewInsight;
  existingItemID?: number;
}

export interface ExcludedDiscoveryCandidate {
  title: string;
  reason:
    | "duplicate"
    | "identity_mismatch"
    | "rejected_or_withdrawn"
    | "insufficient_relevance"
    | "unsupported_claim"
    | "result_limit";
}

export interface DiscoveryResult {
  schemaVersion: 1;
  plan: AgentSearchPlan;
  verifiedMain: DiscoveredPaper[];
  otherPeerReviewed: DiscoveredPaper[];
  noveltyRadar: DiscoveredPaper[];
  excluded: ExcludedDiscoveryCandidate[];
  limitations: string[];
  parseWarnings: string[];
  completedAt: string;
}

export interface DiscoveryCapabilities {
  agentWebSearch: boolean;
  structuredCandidateSearch: boolean;
  officialEvidenceFetch: boolean;
}

export interface DiscoveryProviderCandidate {
  provider: string;
  providerID: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  venueName?: string;
  urls: string[];
}
