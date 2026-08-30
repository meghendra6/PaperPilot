import {
  RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
  assertResearchWorkspaceID,
  type ResearchWorkspaceChangeInboxFile,
  type ResearchWorkspaceLivingReviewChange,
  type ResearchWorkspaceLivingReviewChangeKind,
  type ResearchWorkspaceLivingReviewSnapshot,
  type ResearchWorkspaceLivingReviewState,
  type ResearchWorkspaceSourceAvailability,
} from "./persistence/contracts";

/**
 * The inbox is deliberately bounded so repeated local Zotero notifications
 * cannot grow a project file without limit.
 */
export const RESEARCH_WORKSPACE_LIVING_REVIEW_HISTORY_LIMIT = 500;

/**
 * A scanner may omit observedAt and let reconciliation use the check time.
 * Omitted fingerprints mean "not observed in this check", not that a known
 * fingerprint was erased.
 */
export type ResearchWorkspaceLivingReviewObservation = Omit<
  ResearchWorkspaceLivingReviewSnapshot,
  "observedAt"
> & {
  observedAt?: string;
};

export interface ResolveResearchWorkspaceLivingReviewChangeInput {
  changeID: string;
  action: "reviewed" | "dismissed";
  submissionID: string;
  actedAt: string;
}

const AVAILABILITIES = new Set<ResearchWorkspaceSourceAvailability>([
  "ready",
  "missing-file",
  "unreadable",
  "detached",
]);

function requireText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > 1_000) {
    throw new Error(`${label} is too long.`);
  }
  return normalized;
}

function requireISODate(value: string, label: string) {
  const normalized = requireText(value, label);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO date.`);
  }
  return normalized;
}

function optionalFingerprint(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  return requireText(value, label);
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function semanticState(state: ResearchWorkspaceLivingReviewState) {
  return {
    availability: state.availability,
    ...(state.contentFingerprint
      ? { contentFingerprint: state.contentFingerprint }
      : {}),
    ...(state.annotationFingerprint
      ? { annotationFingerprint: state.annotationFingerprint }
      : {}),
  } satisfies ResearchWorkspaceLivingReviewState;
}

function stateKey(state: ResearchWorkspaceLivingReviewState) {
  return JSON.stringify(semanticState(state));
}

function statesEqual(
  left: ResearchWorkspaceLivingReviewState,
  right: ResearchWorkspaceLivingReviewState,
) {
  return stateKey(left) === stateKey(right);
}

function changeIdentity(params: {
  sourceID: string;
  kind: ResearchWorkspaceLivingReviewChangeKind;
  before: ResearchWorkspaceLivingReviewState;
  after: ResearchWorkspaceLivingReviewState;
}) {
  const semantic = JSON.stringify({
    sourceID: params.sourceID,
    kind: params.kind,
    before: semanticState(params.before),
    after: semanticState(params.after),
  });
  const digest = `${fnv1a(semantic, 2166136261)}${fnv1a(
    semantic,
    2246822519,
  )}${semantic.length.toString(16).padStart(4, "0")}`;
  return {
    dedupeKey: `living-review-v1:${digest}`,
    changeID: `living-review-change-${digest}`,
  };
}

function normalizeObservation(
  observation: ResearchWorkspaceLivingReviewObservation,
  previous: ResearchWorkspaceLivingReviewSnapshot | undefined,
  checkedAt: string,
): ResearchWorkspaceLivingReviewSnapshot {
  const sourceID = requireText(observation.sourceID, "Living Review sourceID");
  if (!AVAILABILITIES.has(observation.availability)) {
    throw new Error(
      `Living Review source ${sourceID} has unsupported availability: ${String(
        observation.availability,
      )}.`,
    );
  }
  const contentFingerprint =
    optionalFingerprint(
      observation.contentFingerprint,
      "Living Review content fingerprint",
    ) ?? previous?.contentFingerprint;
  const explicitAnnotationFingerprint = optionalFingerprint(
    observation.annotationFingerprint,
    "Living Review annotation fingerprint",
  );
  const annotationFingerprint = observation.annotation
    ? requireText(
        observation.annotation.value,
        "Living Review annotation fingerprint",
      )
    : explicitAnnotationFingerprint;
  if (
    observation.annotation &&
    explicitAnnotationFingerprint &&
    observation.annotation.value.trim() !== explicitAnnotationFingerprint
  ) {
    throw new Error(
      `Living Review source ${sourceID} has inconsistent annotation fingerprints.`,
    );
  }
  if (observation.annotation) {
    if (
      observation.annotation.algorithm !==
      "zotero-annotation-keys-version-date-v1"
    ) {
      throw new Error(
        `Living Review source ${sourceID} has an unsupported annotation fingerprint algorithm.`,
      );
    }
    if (
      !Number.isInteger(observation.annotation.count) ||
      observation.annotation.count < 0
    ) {
      throw new Error(
        `Living Review source ${sourceID} annotation count must be a non-negative integer.`,
      );
    }
  }
  const effectiveAnnotationFingerprint =
    annotationFingerprint ?? previous?.annotationFingerprint;
  const observedAt = observation.observedAt
    ? requireISODate(observation.observedAt, "Living Review observedAt")
    : checkedAt;
  const canReusePreviousAnnotation =
    previous?.annotation &&
    previous.annotationFingerprint === effectiveAnnotationFingerprint;
  return {
    sourceID,
    availability: observation.availability,
    ...(contentFingerprint ? { contentFingerprint } : {}),
    ...(effectiveAnnotationFingerprint
      ? { annotationFingerprint: effectiveAnnotationFingerprint }
      : {}),
    ...(observation.annotation
      ? { annotation: { ...observation.annotation } }
      : canReusePreviousAnnotation
        ? { annotation: { ...previous.annotation! } }
        : {}),
    observedAt,
  };
}

function transitionKinds(
  before: ResearchWorkspaceLivingReviewState,
  after: ResearchWorkspaceLivingReviewState,
) {
  const kinds: ResearchWorkspaceLivingReviewChangeKind[] = [];
  if (before.availability === "ready" && after.availability !== "ready") {
    kinds.push("source-unavailable");
  } else if (
    before.availability !== "ready" &&
    after.availability === "ready"
  ) {
    kinds.push("source-restored");
  }
  if (
    before.contentFingerprint &&
    after.contentFingerprint &&
    before.contentFingerprint !== after.contentFingerprint
  ) {
    kinds.push("pdf-content-changed");
  }
  if (
    before.annotationFingerprint &&
    after.annotationFingerprint &&
    before.annotationFingerprint !== after.annotationFingerprint
  ) {
    kinds.push("annotations-changed");
  }
  return kinds;
}

export function createResearchWorkspaceChangeInbox(
  projectID: string,
): ResearchWorkspaceChangeInboxFile {
  return {
    schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
    revision: 0,
    projectID: assertResearchWorkspaceID(projectID, "projectID"),
    snapshots: [],
    changes: [],
  };
}

/**
 * Reconciles a complete project observation set. Sources without an existing
 * snapshot are baselined silently: adding a paper or enabling observation must
 * never fabricate a change. An unavailable source must therefore be supplied
 * explicitly with its availability; omission means it is no longer in the
 * project observation set.
 */
export function reconcileResearchWorkspaceLivingReview(
  inbox: ResearchWorkspaceChangeInboxFile,
  observations: readonly ResearchWorkspaceLivingReviewObservation[],
  checkedAtValue: string,
): ResearchWorkspaceChangeInboxFile {
  const checkedAt = requireISODate(checkedAtValue, "Living Review checkedAt");
  if (
    inbox.lastCheckedAt &&
    Date.parse(checkedAt) < Date.parse(inbox.lastCheckedAt)
  ) {
    throw new Error("Living Review checkedAt cannot move backwards.");
  }
  const previousBySourceID = new Map(
    inbox.snapshots.map((snapshot) => [snapshot.sourceID, snapshot]),
  );
  const observationBySourceID = new Map<
    string,
    ResearchWorkspaceLivingReviewObservation
  >();
  for (const observation of observations) {
    const sourceID = requireText(
      observation.sourceID,
      "Living Review sourceID",
    );
    if (observationBySourceID.has(sourceID)) {
      throw new Error(
        `Living Review observations contain duplicate source ${sourceID}.`,
      );
    }
    observationBySourceID.set(sourceID, observation);
  }

  const snapshots: ResearchWorkspaceLivingReviewSnapshot[] = [];
  const detected: ResearchWorkspaceLivingReviewChange[] = [];
  const knownDedupeKeys = new Set(
    inbox.changes.map((change) => change.dedupeKey),
  );
  for (const sourceID of [...observationBySourceID.keys()].sort()) {
    const previous = previousBySourceID.get(sourceID);
    const snapshot = normalizeObservation(
      observationBySourceID.get(sourceID)!,
      previous,
      checkedAt,
    );
    snapshots.push(snapshot);
    if (!previous) {
      if (inbox.initializedAt) {
        const state = semanticState(snapshot);
        const kind = "project-source-added" as const;
        const identity = changeIdentity({
          sourceID,
          kind,
          before: state,
          after: state,
        });
        if (!knownDedupeKeys.has(identity.dedupeKey)) {
          knownDedupeKeys.add(identity.dedupeKey);
          detected.push({
            ...identity,
            sourceID,
            kind,
            before: state,
            after: state,
            detectedAt: checkedAt,
          });
        }
      }
      continue;
    }
    const before = semanticState(previous);
    const after = semanticState(snapshot);
    if (statesEqual(before, after)) continue;
    for (const kind of transitionKinds(before, after)) {
      const identity = changeIdentity({ sourceID, kind, before, after });
      if (knownDedupeKeys.has(identity.dedupeKey)) continue;
      knownDedupeKeys.add(identity.dedupeKey);
      detected.push({
        ...identity,
        sourceID,
        kind,
        before,
        after,
        detectedAt: checkedAt,
      });
    }
  }

  const changes = [...inbox.changes, ...detected].slice(
    -RESEARCH_WORKSPACE_LIVING_REVIEW_HISTORY_LIMIT,
  );
  const candidate: ResearchWorkspaceChangeInboxFile = {
    ...inbox,
    revision: inbox.revision + 1,
    initializedAt: inbox.initializedAt ?? checkedAt,
    lastCheckedAt: checkedAt,
    snapshots,
    changes,
  };
  const unchanged =
    inbox.initializedAt === candidate.initializedAt &&
    inbox.lastCheckedAt === candidate.lastCheckedAt &&
    JSON.stringify(inbox.snapshots) === JSON.stringify(candidate.snapshots) &&
    JSON.stringify(inbox.changes) === JSON.stringify(candidate.changes);
  return unchanged ? inbox : candidate;
}

export function resolveResearchWorkspaceLivingReviewChange(
  inbox: ResearchWorkspaceChangeInboxFile,
  input: ResolveResearchWorkspaceLivingReviewChangeInput,
): ResearchWorkspaceChangeInboxFile {
  const changeID = requireText(input.changeID, "Living Review changeID");
  const submissionID = requireText(
    input.submissionID,
    "Living Review submissionID",
  );
  const actedAt = requireISODate(input.actedAt, "Living Review actedAt");
  if (input.action !== "reviewed" && input.action !== "dismissed") {
    throw new Error(
      `Living Review resolution action is unsupported: ${String(
        input.action,
      )}.`,
    );
  }

  const priorSubmission = inbox.changes.find(
    (change) => change.resolution?.submissionID === submissionID,
  );
  if (priorSubmission) {
    if (
      priorSubmission.changeID === changeID &&
      priorSubmission.resolution?.action === input.action
    ) {
      return inbox;
    }
    throw new Error(
      `Living Review submission ${submissionID} has an idempotency conflict.`,
    );
  }

  const targetIndex = inbox.changes.findIndex(
    (change) => change.changeID === changeID,
  );
  if (targetIndex < 0) {
    throw new Error(`Living Review change ${changeID} was not found.`);
  }
  const target = inbox.changes[targetIndex];
  if (target.resolution) {
    throw new Error(
      `Living Review change ${changeID} is already resolved as ${target.resolution.action}.`,
    );
  }
  if (Date.parse(actedAt) < Date.parse(target.detectedAt)) {
    throw new Error(
      "Living Review actedAt cannot precede the detected change.",
    );
  }
  const changes = inbox.changes.map((change, index) =>
    index === targetIndex
      ? {
          ...change,
          resolution: {
            action: input.action,
            submissionID,
            actedAt,
          },
        }
      : change,
  );
  return {
    ...inbox,
    revision: inbox.revision + 1,
    changes,
  };
}
