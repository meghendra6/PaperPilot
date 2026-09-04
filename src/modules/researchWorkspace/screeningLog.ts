import type {
  ResearchProject,
  ResearchWorkspaceCriterion,
  ResearchWorkspaceProjectMember,
  ResearchWorkspaceScreeningCriterionSnapshot,
  ResearchWorkspaceScreeningDecision,
  ResearchWorkspaceScreeningDecisionEvent,
  ResearchWorkspaceScreeningReasonCode,
  ResearchWorkspaceScreeningSourceSnapshot,
  ResearchWorkspaceScreeningStage,
  ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";
import {
  normalizeIdentityDOI,
  normalizeIdentityTitle,
  stableHash,
} from "./identity";

export const RESEARCH_WORKSPACE_SCREENING_LOG_VERSION =
  "screening-log-v1" as const;

export interface ResearchWorkspaceScreeningIssue {
  issueID: string;
  kind: "duplicate" | "missing-pdf";
  sourceIDs: string[];
  detail: string;
}

export interface ResearchWorkspaceScreeningLogRow {
  sourceID: string;
  title: string;
  current?: ResearchWorkspaceScreeningDecisionEvent;
  legacyDecision?: ResearchWorkspaceScreeningDecision;
  issues: ResearchWorkspaceScreeningIssue[];
  history: ResearchWorkspaceScreeningDecisionEvent[];
}

export interface ResearchWorkspaceScreeningLog {
  schemaVersion: 1;
  kind: "research-workspace-review-log";
  version: typeof RESEARCH_WORKSPACE_SCREENING_LOG_VERSION;
  projectID: string;
  generatedAt: string;
  protocol: {
    fingerprint: string;
    inclusionCriteria: ResearchWorkspaceCriterion[];
    exclusionCriteria: ResearchWorkspaceCriterion[];
  };
  sourceSnapshot: Array<{
    sourceID: string;
    contentFingerprint?: string;
  }>;
  rows: ResearchWorkspaceScreeningLogRow[];
  issues: ResearchWorkspaceScreeningIssue[];
  summary: {
    total: number;
    unreviewed: number;
    include: number;
    exclude: number;
    maybe: number;
    decisions: number;
    duplicateSignals: number;
    missingPDFSignals: number;
  };
  limitations: string[];
}

export interface RecordResearchWorkspaceScreeningDecisionInput {
  projectID: string;
  sourceID: string;
  stage: ResearchWorkspaceScreeningStage;
  decision: ResearchWorkspaceScreeningDecision;
  reasonCode?: ResearchWorkspaceScreeningReasonCode;
  reason?: string;
  criterionIDs?: string[];
  note?: string;
  submissionID: string;
  expectedProjectRevision: number;
  expectedMembersRevision: number;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedCriterionLines(lines: readonly string[]) {
  const seen = new Set<string>();
  return lines
    .map(normalizeWhitespace)
    .filter((line) => {
      const key = line.toLocaleLowerCase();
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

export function reconcileScreeningCriteria(params: {
  existing: readonly ResearchWorkspaceCriterion[];
  lines: readonly string[];
  kind: "inclusion" | "exclusion";
  acceptedAt: string;
}) {
  const byText = new Map(
    params.existing.map((criterion) => [
      normalizeWhitespace(criterion.text).toLocaleLowerCase(),
      criterion,
    ]),
  );
  const used = new Set(
    params.existing.map((criterion) => criterion.criterionID),
  );
  return normalizedCriterionLines(params.lines).map((line, index) => {
    const prior = byText.get(line.toLocaleLowerCase());
    if (prior) {
      used.add(prior.criterionID);
      return { ...prior, text: line };
    }
    const base = `criterion-${params.kind}-${stableHash(line.toLocaleLowerCase())}`;
    let criterionID = base;
    let suffix = index + 1;
    while (used.has(criterionID)) criterionID = `${base}-${suffix++}`;
    used.add(criterionID);
    return {
      criterionID,
      text: line,
      enabled: true,
      createdBy: "user" as const,
      acceptedAt: params.acceptedAt,
    };
  });
}

export function screeningProtocolSnapshot(project: ResearchProject) {
  const inclusion = project.scope?.inclusionCriteria ?? [];
  const exclusion = project.scope?.exclusionCriteria ?? [];
  return [
    ...inclusion.map((criterion) => ({
      criterionID: criterion.criterionID,
      kind: "inclusion" as const,
      text: criterion.text,
    })),
    ...exclusion.map((criterion) => ({
      criterionID: criterion.criterionID,
      kind: "exclusion" as const,
      text: criterion.text,
    })),
  ];
}

export function screeningProtocolFingerprint(
  snapshot: readonly ResearchWorkspaceScreeningCriterionSnapshot[],
) {
  return `screening-protocol-${stableHash(
    JSON.stringify(
      snapshot.map((criterion) => ({
        criterionID: criterion.criterionID,
        kind: criterion.kind,
        text: normalizeWhitespace(criterion.text),
      })),
    ),
  )}`;
}

export function screeningSourceSnapshot(
  source: ResearchWorkspaceSourceRecord,
): ResearchWorkspaceScreeningSourceSnapshot {
  return {
    title: source.title,
    ...(source.doi ? { doi: source.doi } : {}),
    ...(source.year ? { year: source.year } : {}),
    availability: source.availability,
    ...(source.contentFingerprint?.value
      ? { contentFingerprint: source.contentFingerprint.value }
      : {}),
  };
}

export function screeningDecisionMatchesInput(
  event: ResearchWorkspaceScreeningDecisionEvent,
  input: RecordResearchWorkspaceScreeningDecisionInput,
) {
  const criteria = [...new Set(input.criterionIDs ?? [])].sort();
  const reason = normalizeWhitespace(input.reason ?? "");
  const expectedReasonCode =
    input.reasonCode || reason || criteria.length
      ? (input.reasonCode ?? "other")
      : "";
  return (
    event.sourceID === input.sourceID &&
    event.stage === input.stage &&
    event.decision === input.decision &&
    (event.reason?.code ?? "") === expectedReasonCode &&
    normalizeWhitespace(event.reason?.text ?? "") === reason &&
    JSON.stringify([...(event.reason?.criterionIDs ?? [])].sort()) ===
      JSON.stringify(criteria) &&
    normalizeWhitespace(event.note ?? "") ===
      normalizeWhitespace(input.note ?? "")
  );
}

export function createScreeningDecisionEvent(params: {
  input: RecordResearchWorkspaceScreeningDecisionInput;
  source: ResearchWorkspaceSourceRecord;
  project: ResearchProject;
  previous?: ResearchWorkspaceScreeningDecisionEvent;
  eventID: string;
  decidedAt: string;
}) {
  const reason = normalizeWhitespace(params.input.reason ?? "");
  const note = normalizeWhitespace(params.input.note ?? "");
  const criterionIDs = [...new Set(params.input.criterionIDs ?? [])].sort();
  if (params.input.decision === "exclude" && !reason) {
    throw new Error("An exclusion decision requires a reason.");
  }
  if (params.input.reasonCode && !reason) {
    throw new Error("A screening reason code requires explanatory text.");
  }
  if (params.input.reasonCode === "criterion" && !criterionIDs.length) {
    throw new Error("A criterion-based decision requires a criterion.");
  }
  if (criterionIDs.length && params.input.reasonCode !== "criterion") {
    throw new Error(
      "Selected criteria require the criterion screening reason code.",
    );
  }
  const protocolSnapshot = screeningProtocolSnapshot(params.project);
  return {
    eventID: params.eventID,
    submissionID: params.input.submissionID,
    sourceID: params.input.sourceID,
    stage: params.input.stage,
    decision: params.input.decision,
    ...(params.input.reasonCode || reason || criterionIDs.length
      ? {
          reason: {
            code: params.input.reasonCode ?? "other",
            text: reason,
            ...(criterionIDs.length ? { criterionIDs } : {}),
          },
        }
      : {}),
    ...(note ? { note } : {}),
    actor: "local-user",
    protocolFingerprint: screeningProtocolFingerprint(protocolSnapshot),
    protocolSnapshot,
    sourceSnapshot: screeningSourceSnapshot(params.source),
    decidedAt: params.decidedAt,
    ...(params.previous ? { supersedesEventID: params.previous.eventID } : {}),
  } satisfies ResearchWorkspaceScreeningDecisionEvent;
}

export function currentScreeningEvent(member: ResearchWorkspaceProjectMember) {
  return member.screeningEvents?.at(-1);
}

function legacyDecision(member: ResearchWorkspaceProjectMember) {
  if (member.reviewStatus === "included") return "include" as const;
  if (member.reviewStatus === "excluded") return "exclude" as const;
  if (member.reviewStatus === "maybe") return "maybe" as const;
  return undefined;
}

export function screeningReviewStatus(
  decision: ResearchWorkspaceScreeningDecision,
) {
  if (decision === "include") return "included" as const;
  if (decision === "exclude") return "excluded" as const;
  return "maybe" as const;
}

export function detectScreeningIssues(
  sources: readonly ResearchWorkspaceSourceRecord[],
) {
  const issues: ResearchWorkspaceScreeningIssue[] = [];
  const groups = new Map<string, ResearchWorkspaceSourceRecord[]>();
  for (const source of sources) {
    const doi = source.doi ? normalizeIdentityDOI(source.doi) : "";
    const title = normalizeIdentityTitle(source.title);
    const key = doi
      ? `doi:${doi}`
      : title && source.year
        ? `title-year:${title}:${source.year}`
        : "";
    if (key) groups.set(key, [...(groups.get(key) ?? []), source]);
    if (
      source.availability !== "ready" ||
      source.extractionQuality === "unavailable"
    ) {
      issues.push({
        issueID: `screening-issue-missing-${stableHash(source.sourceID)}`,
        kind: "missing-pdf",
        sourceIDs: [source.sourceID],
        detail: `Local PDF is ${source.availability}; full-text screening is unavailable.`,
      });
    }
  }
  for (const [key, entries] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceIDs = [
      ...new Set(entries.map((entry) => entry.sourceID)),
    ].sort();
    if (sourceIDs.length < 2) continue;
    issues.push({
      issueID: `screening-issue-duplicate-${stableHash(key)}`,
      kind: "duplicate",
      sourceIDs,
      detail: key.startsWith("doi:")
        ? "Exact normalized DOI match. Review before excluding either record."
        : "Exact normalized title and year match without DOI. Review before excluding either record.",
    });
  }
  return issues.sort((left, right) =>
    left.issueID.localeCompare(right.issueID),
  );
}

export function buildResearchWorkspaceScreeningLog(params: {
  project: ResearchProject;
  members: readonly ResearchWorkspaceProjectMember[];
  sources: readonly ResearchWorkspaceSourceRecord[];
  generatedAt: string;
}): ResearchWorkspaceScreeningLog {
  const sourceByID = new Map(
    params.sources.map((source) => [source.sourceID, source]),
  );
  const issues = detectScreeningIssues(params.sources);
  const protocolSnapshot = screeningProtocolSnapshot(params.project);
  const rows = [...params.members]
    .sort((left, right) => left.sourceID.localeCompare(right.sourceID))
    .map((member) => {
      const source = sourceByID.get(member.sourceID);
      const history = [...(member.screeningEvents ?? [])];
      const current = history.at(-1);
      return {
        sourceID: member.sourceID,
        title: source?.title ?? member.sourceID,
        ...(current ? { current } : {}),
        ...(!current && legacyDecision(member)
          ? { legacyDecision: legacyDecision(member) }
          : {}),
        issues: issues.filter((issue) =>
          issue.sourceIDs.includes(member.sourceID),
        ),
        history,
      };
    });
  const decisionFor = (row: ResearchWorkspaceScreeningLogRow) =>
    row.current?.decision ?? row.legacyDecision;
  return {
    schemaVersion: 1,
    kind: "research-workspace-review-log",
    version: RESEARCH_WORKSPACE_SCREENING_LOG_VERSION,
    projectID: params.project.projectID,
    generatedAt: params.generatedAt,
    protocol: {
      fingerprint: screeningProtocolFingerprint(protocolSnapshot),
      inclusionCriteria: [...(params.project.scope?.inclusionCriteria ?? [])],
      exclusionCriteria: [...(params.project.scope?.exclusionCriteria ?? [])],
    },
    sourceSnapshot: params.sources
      .map((source) => ({
        sourceID: source.sourceID,
        ...(source.contentFingerprint?.value
          ? { contentFingerprint: source.contentFingerprint.value }
          : {}),
      }))
      .sort((left, right) => left.sourceID.localeCompare(right.sourceID)),
    rows,
    issues,
    summary: {
      total: rows.length,
      unreviewed: rows.filter((row) => !decisionFor(row)).length,
      include: rows.filter((row) => decisionFor(row) === "include").length,
      exclude: rows.filter((row) => decisionFor(row) === "exclude").length,
      maybe: rows.filter((row) => decisionFor(row) === "maybe").length,
      decisions: rows.reduce((total, row) => total + row.history.length, 0),
      duplicateSignals: issues.filter((issue) => issue.kind === "duplicate")
        .length,
      missingPDFSignals: issues.filter((issue) => issue.kind === "missing-pdf")
        .length,
    },
    limitations: [
      "Duplicate and missing-PDF findings are local review signals; they never change a screening decision automatically.",
      "All decisions in this log are explicit local user actions; no paper text is sent to a model by this workflow.",
    ],
  };
}

function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeResearchWorkspaceScreeningLogCsv(
  log: ResearchWorkspaceScreeningLog,
) {
  const header = [
    "source_id",
    "title",
    "event_id",
    "current",
    "stage",
    "decision",
    "reason_code",
    "reason",
    "criterion_ids",
    "note",
    "decided_at",
    "protocol_fingerprint",
  ];
  const rows: unknown[][] = [];
  for (const row of log.rows) {
    for (const event of row.history) {
      rows.push([
        row.sourceID,
        event.sourceSnapshot.title,
        event.eventID,
        event.eventID === row.current?.eventID,
        event.stage,
        event.decision,
        event.reason?.code,
        event.reason?.text,
        event.reason?.criterionIDs?.join(";"),
        event.note,
        event.decidedAt,
        event.protocolFingerprint,
      ]);
    }
    if (!row.history.length) {
      rows.push([
        row.sourceID,
        row.title,
        "",
        true,
        "",
        row.legacyDecision ?? "unreviewed",
        "",
        "",
        "",
        "",
        "",
        log.protocol.fingerprint,
      ]);
    }
  }
  return `${[header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}
