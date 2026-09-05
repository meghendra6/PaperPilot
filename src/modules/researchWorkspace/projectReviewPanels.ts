import { getPref } from "../../utils/prefs";
import { copyTextToClipboard } from "../components/ChatMessage";
import { renderResearchWorkspaceArtifactEnvelope } from "./artifactRenderer";
import type {
  ContradictionClassification,
  ContradictionGapDashboard,
} from "./contradictionGap";
import { element } from "./dom";
import { openVerifiedResearchWorkspaceEvidence } from "./evidenceNavigation";
import type { EvidenceReferenceV2 } from "./evidenceVerification";
import {
  checkResearchWorkspaceChanges,
  exportResearchWorkspaceScreeningLog,
  recordResearchWorkspaceScreeningDecision,
  refreshResearchWorkspaceSource,
  resolveResearchWorkspaceChange,
  reviewResearchWorkspaceContradictionGap,
  runResearchWorkspaceCitationHealth,
  runResearchWorkspaceContradictionGapDashboard,
  updateResearchWorkspaceMember,
  updateResearchWorkspaceScreeningProtocol,
} from "./facade";
import { readResearchWorkspaceArtifact } from "./legacyCapabilityAdapters";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceChangeInboxFile } from "./persistence/contracts";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import {
  button,
  markTemplateRecommendation,
  metric,
  setMessage,
  textArea,
  textInput,
  type ProjectNavigation,
} from "./projectSurfaceShared";
import {
  buildResearchWorkspaceScreeningLog,
  currentScreeningEvent,
} from "./screeningLog";
export function renderCitationHealthPanel(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-citation-health-panel",
  );
  section.append(
    element(doc, "h3", "", "Citation & Reference Health"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Builds a deterministic local review checklist from current saved citation, methodology, and reproducibility artifacts plus local Zotero metadata. It does not create an aggregate truth score, call a model, or use the network.",
    ),
  );
  markTemplateRecommendation(
    doc,
    section,
    details,
    "citation-reference-health",
  );
  const eligibleTypes = new Set([
    "citation-context",
    "citation-stance",
    "methodology-audit",
    "reproducibility",
  ]);
  const hasCurrentInput = details.artifacts.some(
    (artifact) =>
      artifact.status === "complete" && eligibleTypes.has(artifact.type),
  );
  const hasIncludedSource = details.members.some(
    (member) => member.reviewStatus !== "excluded",
  );

  const draftName = element(doc, "input", "pprw-input");
  draftName.type = "text";
  draftName.placeholder = "Imported draft name (optional)";
  const draftText = textArea(
    doc,
    "Optional imported or pasted draft text. Only a bounded fingerprint and bounded excerpt are saved.",
  );
  const draftFile = element(doc, "input", "pprw-input");
  draftFile.type = "file";
  draftFile.accept = ".txt,.md,.markdown,text/plain,text/markdown";
  draftFile.setAttribute("aria-label", "Import a local draft text file");
  draftFile.addEventListener("change", () => {
    void (async () => {
      const file = draftFile.files?.[0];
      if (!file) return;
      try {
        // Bound the UI read as defense in depth. The report builder applies a
        // second, smaller source and persisted-excerpt bound.
        draftText.value = await file.slice(0, 500_000).text();
        draftName.value = file.name;
        setMessage(
          root,
          file.size > 500_000
            ? "Imported the first bounded portion of the draft."
            : "Imported the local draft text.",
          "success",
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    })();
  });
  section.append(
    element(doc, "label", "pprw-muted", "Optional local draft (.txt or .md)"),
    draftFile,
    draftName,
    draftText,
  );

  const build = button(
    doc,
    "Build / refresh citation health checklist",
    async () => {
      try {
        setMessage(root, "Building the local citation health checklist…");
        await runResearchWorkspaceCitationHealth({
          projectID: details.project.projectID,
          ...(draftText.value.trim()
            ? {
                draft: {
                  ...(draftName.value.trim()
                    ? { name: draftName.value.trim() }
                    : {}),
                  text: draftText.value,
                },
              }
            : {}),
          onStatus: (status) => setMessage(root, status),
        });
        await navigation.renderProject(
          root,
          details.project.projectID,
          capturedPapers,
          generation,
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
    true,
  );
  build.disabled = !hasIncludedSource || !hasCurrentInput;
  section.append(build);
  if (!hasIncludedSource) {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "Include or retain at least one project source before building this checklist.",
      ),
    );
  } else if (!hasCurrentInput) {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "Create a current Citation Context, Citation Stance, Methodology Audit, or Reproducibility artifact first.",
      ),
    );
  }

  const latest = details.artifacts.find(
    (artifact) => artifact.type === "citation-health",
  );
  if (!latest) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No citation health checklist has been saved for this project yet.",
      ),
    );
    return section;
  }
  const payload = latest.payload as {
    findings?: unknown[];
    coverage?: {
      citationContexts?: number;
      localMetadataSignals?: number;
      unsupportedDraftCandidates?: number;
    };
  };
  const metrics = element(doc, "div", "pprw-home-metrics");
  metrics.append(
    metric(doc, payload.findings?.length ?? 0, "review findings"),
    metric(doc, payload.coverage?.citationContexts ?? 0, "citation contexts"),
    metric(
      doc,
      payload.coverage?.localMetadataSignals ?? 0,
      "local metadata signals",
    ),
    metric(
      doc,
      payload.coverage?.unsupportedDraftCandidates ?? 0,
      "draft coverage candidates",
    ),
  );
  section.append(metrics);
  if (latest.status !== "complete") {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        `This checklist is ${latest.status}. Refresh it before relying on its review signals.`,
      ),
    );
  }
  return section;
}

export function livingReviewStateLabel(
  state: ResearchWorkspaceChangeInboxFile["changes"][number]["after"],
) {
  const fingerprint = state.contentFingerprint
    ? ` · PDF ${state.contentFingerprint.slice(0, 18)}${state.contentFingerprint.length > 18 ? "…" : ""}`
    : "";
  const annotations = state.annotationFingerprint
    ? ` · annotations ${state.annotationFingerprint.slice(0, 14)}${state.annotationFingerprint.length > 14 ? "…" : ""}`
    : "";
  return `${state.availability}${fingerprint}${annotations}`;
}

export function renderLivingReviewPanel(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  inbox: ResearchWorkspaceChangeInboxFile,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-living-review-panel",
  );
  const pending = inbox.changes.filter((change) => !change.resolution).length;
  section.append(
    element(doc, "h3", "", `Living review · ${pending} pending`),
    element(
      doc,
      "p",
      "pprw-muted",
      "Checks local Zotero attachment and annotation metadata only. It does not read PDF or annotation text, call a model or CLI, or use the network.",
    ),
  );
  markTemplateRecommendation(doc, section, details, "living-review");
  const actions = element(doc, "div", "pprw-row");
  actions.append(
    button(
      doc,
      "Check now",
      async () => {
        try {
          setMessage(root, "Checking local Zotero changes…");
          await checkResearchWorkspaceChanges(details.project.projectID);
          await navigation.renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      },
      true,
    ),
    element(
      doc,
      "span",
      "pprw-muted",
      inbox.lastCheckedAt
        ? `Last checked ${new Date(inbox.lastCheckedAt).toLocaleString()}`
        : "Not checked yet — the first check records a baseline without alerts.",
    ),
  );
  section.append(actions);

  const filter = element(doc, "select", "pprw-select");
  filter.setAttribute("aria-label", "Filter living-review changes");
  for (const [value, label] of [
    ["pending", "Pending"],
    ["all", "All changes"],
    ["reviewed", "Reviewed"],
    ["dismissed", "Dismissed"],
  ] as const) {
    const option = element(doc, "option", "", label);
    option.value = value;
    filter.append(option);
  }
  section.append(filter);
  const sourceByID = new Map(
    details.sources.map((source) => [source.sourceID, source]),
  );
  const list = element(doc, "div", "pprw-artifact-history");
  for (const change of [...inbox.changes].reverse()) {
    const status = change.resolution?.action ?? "pending";
    const card = element(doc, "article", "pprw-artifact-card");
    card.dataset.livingReviewStatus = status;
    card.hidden = status !== "pending";
    const kind = change.kind.replace(/-/g, " ");
    card.append(
      element(
        doc,
        "strong",
        "",
        sourceByID.get(change.sourceID)?.title ?? change.sourceID,
      ),
      element(doc, "span", "pprw-artifact-status", `${kind} · ${status}`),
      element(
        doc,
        "p",
        "pprw-muted",
        `${livingReviewStateLabel(change.before)} → ${livingReviewStateLabel(change.after)}`,
      ),
      element(
        doc,
        "p",
        "pprw-muted",
        `Detected ${new Date(change.detectedAt).toLocaleString()}`,
      ),
    );
    if (!change.resolution) {
      const changeActions = element(doc, "div", "pprw-row");
      const resolve = async (action: "reviewed" | "dismissed") => {
        try {
          await resolveResearchWorkspaceChange({
            projectID: details.project.projectID,
            changeID: change.changeID,
            action,
            submissionID: `living-review-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            expectedRevision: inbox.revision,
          });
          await navigation.renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      };
      changeActions.append(
        button(doc, "Mark reviewed", () => resolve("reviewed"), true),
        button(doc, "Dismiss", () => resolve("dismissed")),
        button(doc, "Refresh source", async () => {
          try {
            setMessage(root, "Refreshing the local source snapshot…");
            await refreshResearchWorkspaceSource({
              projectID: details.project.projectID,
              sourceID: change.sourceID,
            });
            await navigation.renderProject(
              root,
              details.project.projectID,
              capturedPapers,
              generation,
            );
          } catch (error) {
            setMessage(
              root,
              error instanceof Error ? error.message : String(error),
              "error",
            );
          }
        }),
      );
      card.append(changeActions);
    }
    list.append(card);
  }
  filter.addEventListener("change", () => {
    for (const card of Array.from(list.children) as HTMLElement[]) {
      const status = card.dataset.livingReviewStatus;
      card.hidden = filter.value !== "all" && status !== filter.value;
    }
  });
  if (!inbox.changes.length) {
    list.append(
      element(
        doc,
        "p",
        "pprw-muted",
        inbox.initializedAt
          ? "No changes have been detected since the local baseline."
          : "Run Check now to establish a local baseline.",
      ),
    );
  }
  section.append(list);
  return section;
}

export function renderContradictionGapPanel(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-contradiction-gap-panel",
  );
  section.append(
    element(doc, "h3", "", "Contradictions & Evidence Gaps"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Local evidence map, not a truth verdict. It reads current saved artifacts only—no PDF extraction, model, CLI, or network request.",
    ),
  );
  markTemplateRecommendation(
    doc,
    section,
    details,
    "contradiction-gap-dashboard",
  );
  const includedSources = details.members.filter(
    (member) => member.reviewStatus !== "excluded",
  );
  const eligibleTypes = new Set([
    "claim-ledger",
    "evidence-matrix",
    "synthesis",
    "methodology-audit",
    "reproducibility",
  ]);
  const hasCurrentInput = details.artifacts.some(
    (artifact) =>
      artifact.status === "complete" && eligibleTypes.has(artifact.type),
  );
  const build = button(
    doc,
    "Build / refresh local dashboard",
    async () => {
      try {
        setMessage(root, "Building the local contradiction and gap map…");
        await runResearchWorkspaceContradictionGapDashboard({
          projectID: details.project.projectID,
          onStatus: (status) => setMessage(root, status),
        });
        await navigation.renderProject(
          root,
          details.project.projectID,
          capturedPapers,
          generation,
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
    true,
  );
  build.disabled = !includedSources.length || !hasCurrentInput;
  section.append(build);
  if (!includedSources.length) {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "Include or retain at least one project source before building this dashboard.",
      ),
    );
  } else if (!hasCurrentInput) {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "Create a current Claim Ledger, Evidence Matrix, Synthesis, Methodology Audit, or Reproducibility artifact first.",
      ),
    );
  }

  const latest = details.artifacts.find(
    (artifact) => artifact.type === "contradiction-gap-dashboard",
  );
  if (!latest) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No dashboard has been saved for this project yet.",
      ),
    );
    return section;
  }
  const dashboard = latest.payload as ContradictionGapDashboard;
  if (dashboard.kind !== "research-workspace-contradiction-gap-dashboard") {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "The latest dashboard is unreadable.",
      ),
    );
    return section;
  }
  const metrics = element(doc, "div", "pprw-home-metrics");
  metrics.append(
    metric(doc, dashboard.coverage.multiSourceSupport, "multi-source support"),
    metric(
      doc,
      dashboard.coverage.directContradictions,
      "rule contradiction candidates",
    ),
    metric(doc, dashboard.coverage.nonComparable, "rule non-comparable"),
    metric(doc, dashboard.coverage.uncertain, "rule uncertain"),
    metric(doc, dashboard.coverage.gaps, "evidence gaps"),
  );
  section.append(metrics);
  if (latest.status !== "complete") {
    section.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        `This dashboard is ${latest.status}. Refresh it before recording further reviews.`,
      ),
    );
  }
  if (!dashboard.relationships.length) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No comparable contradiction candidates were found in the current verified evidence-linked assertions. Review the evidence gaps below in the saved artifact.",
      ),
    );
    return section;
  }
  const reviewList = element(doc, "div", "pprw-artifact-history");
  for (const relationship of dashboard.relationships.slice(0, 50)) {
    const card = element(doc, "article", "pprw-artifact-card");
    const effective =
      relationship.userClassification ?? relationship.classification;
    card.append(
      element(doc, "strong", "", relationship.topic),
      element(
        doc,
        "p",
        "pprw-muted",
        `Rule result: ${relationship.classification} · Effective: ${effective} · Review: ${relationship.reviewState}`,
      ),
    );
    const classification = element(doc, "select", "pprw-select");
    for (const value of [
      "direct-contradiction",
      "non-comparable",
      "uncertain",
    ] as ContradictionClassification[]) {
      const option = element(doc, "option", "", value);
      option.value = value;
      option.selected = value === effective;
      classification.append(option);
    }
    const reason = textInput(doc, "Reason required for reclassify or dismiss");
    let submissionID: string | undefined;
    const resetSubmission = () => {
      submissionID = undefined;
    };
    classification.addEventListener("change", resetSubmission);
    reason.addEventListener("input", resetSubmission);
    const submit = async (action: "confirm" | "reclassify" | "dismiss") => {
      submissionID ??= `gap-review-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      try {
        setMessage(root, `Saving ${action} review…`);
        await reviewResearchWorkspaceContradictionGap({
          projectID: details.project.projectID,
          artifactID: latest.artifactID,
          relationshipID: relationship.relationshipID,
          action,
          ...(action === "reclassify"
            ? {
                toClassification:
                  classification.value as ContradictionClassification,
              }
            : {}),
          ...(reason.value.trim() ? { reason: reason.value.trim() } : {}),
          submissionID,
          expectedDashboardRevision: dashboard.revision,
        });
        await navigation.renderProject(
          root,
          details.project.projectID,
          capturedPapers,
          generation,
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };
    const actions = element(doc, "div", "pprw-row");
    const confirm = button(doc, "Confirm rule result", () => submit("confirm"));
    const reclassify = button(doc, "Save reclassification", () =>
      submit("reclassify"),
    );
    const dismiss = button(doc, "Dismiss candidate", () => submit("dismiss"));
    confirm.disabled = latest.status !== "complete";
    reclassify.disabled = latest.status !== "complete";
    dismiss.disabled = latest.status !== "complete";
    actions.append(confirm, reclassify, dismiss);
    card.append(classification, reason, actions);
    reviewList.append(card);
  }
  section.append(element(doc, "h4", "", "Reviewable comparisons"), reviewList);
  return section;
}

export function renderScreeningLog(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const section = element(doc, "section", "pprw-project-panel pprw-screening");
  section.append(
    element(doc, "h3", "", "Screening & exclusion log"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Abstract and full-text decisions are explicit local user actions. Duplicate and missing-PDF checks are signals only; this workflow sends no paper text to a model.",
    ),
  );
  markTemplateRecommendation(doc, section, details, "screening-log");
  const log = buildResearchWorkspaceScreeningLog({
    project: details.project,
    members: details.members,
    sources: details.sources,
    generatedAt: new Date().toISOString(),
  });
  const metrics = element(doc, "div", "pprw-home-metrics");
  metrics.append(
    metric(doc, log.summary.include, "included"),
    metric(doc, log.summary.exclude, "excluded"),
    metric(doc, log.summary.maybe, "maybe"),
    metric(doc, log.summary.unreviewed, "unreviewed"),
    metric(
      doc,
      log.summary.duplicateSignals + log.summary.missingPDFSignals,
      "local signals",
    ),
  );
  section.append(metrics);

  const protocol = element(doc, "details", "pprw-screening-protocol");
  protocol.append(element(doc, "summary", "", "Screening protocol"));
  const protocolForm = element(doc, "div", "pprw-screening-protocol-grid");
  const inclusionLabel = element(doc, "label", "pprw-field");
  inclusionLabel.append(element(doc, "span", "", "Inclusion criteria"));
  const inclusion = element(
    doc,
    "textarea",
    "pprw-input pprw-screening-textarea",
  );
  inclusion.value = (details.project.scope?.inclusionCriteria ?? [])
    .map((criterion) => criterion.text)
    .join("\n");
  inclusion.setAttribute("aria-label", "Inclusion criteria, one per line");
  inclusionLabel.append(inclusion);
  const exclusionLabel = element(doc, "label", "pprw-field");
  exclusionLabel.append(element(doc, "span", "", "Exclusion criteria"));
  const exclusion = element(
    doc,
    "textarea",
    "pprw-input pprw-screening-textarea",
  );
  exclusion.value = (details.project.scope?.exclusionCriteria ?? [])
    .map((criterion) => criterion.text)
    .join("\n");
  exclusion.setAttribute("aria-label", "Exclusion criteria, one per line");
  exclusionLabel.append(exclusion);
  protocolForm.append(inclusionLabel, exclusionLabel);
  protocol.append(
    protocolForm,
    button(doc, "Save screening protocol", async () => {
      try {
        setMessage(root, "Saving screening protocol…");
        await updateResearchWorkspaceScreeningProtocol({
          projectID: details.project.projectID,
          expectedProjectRevision: details.projectRevision,
          inclusionCriteria: inclusion.value.split(/\r?\n/),
          exclusionCriteria: exclusion.value.split(/\r?\n/),
        });
        await navigation.renderProject(
          root,
          details.project.projectID,
          capturedPapers,
          generation,
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    }),
  );
  section.append(protocol);

  const actions = element(doc, "div", "pprw-row");
  const filter = element(doc, "select", "pprw-select");
  filter.setAttribute("aria-label", "Filter screening rows");
  for (const [value, label] of [
    ["all", "All papers"],
    ["unreviewed", "Unreviewed"],
    ["include", "Included"],
    ["exclude", "Excluded"],
    ["maybe", "Maybe"],
    ["issues", "Local signals"],
  ]) {
    const option = element(doc, "option", "", label);
    option.value = value;
    filter.append(option);
  }
  actions.append(
    filter,
    button(doc, "Export screening JSON + CSV", async () => {
      try {
        setMessage(root, "Exporting screening log…");
        const exported = await exportResearchWorkspaceScreeningLog(
          details.project.projectID,
        );
        setMessage(
          root,
          `Exported to ${exported.jsonPath} and ${exported.csvPath}.`,
          "success",
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    }),
  );
  section.append(actions);

  const sourceByID = new Map(
    details.sources.map((source) => [source.sourceID, source]),
  );
  const list = element(doc, "div", "pprw-screening-list");
  const criteria = [
    ...(details.project.scope?.inclusionCriteria ?? []).map((criterion) => ({
      ...criterion,
      kind: "Inclusion",
    })),
    ...(details.project.scope?.exclusionCriteria ?? []).map((criterion) => ({
      ...criterion,
      kind: "Exclusion",
    })),
  ].filter((criterion) => criterion.enabled);
  for (const rowView of log.rows) {
    const member = details.members.find(
      (candidate) => candidate.sourceID === rowView.sourceID,
    )!;
    const source = sourceByID.get(rowView.sourceID);
    const current = currentScreeningEvent(member);
    const row = element(doc, "article", "pprw-screening-row");
    row.dataset.screeningDecision =
      current?.decision ?? rowView.legacyDecision ?? "unreviewed";
    row.dataset.screeningIssues = rowView.issues.length ? "true" : "false";
    const heading = element(doc, "div", "pprw-screening-heading");
    heading.append(
      element(doc, "strong", "", rowView.title),
      element(
        doc,
        "span",
        "pprw-muted",
        current
          ? `${current.stage} · ${current.decision} · ${current.decidedAt}`
          : rowView.legacyDecision
            ? `Legacy ${rowView.legacyDecision} state · no event history`
            : "Not screened",
      ),
    );
    const badges = element(doc, "div", "pprw-row");
    for (const issue of rowView.issues) {
      badges.append(
        element(
          doc,
          "span",
          "pprw-render-badge pprw-render-badge--warning",
          issue.kind === "duplicate" ? "Possible duplicate" : "Missing PDF",
        ),
      );
    }
    heading.append(badges);

    const form = element(doc, "div", "pprw-screening-controls");
    const stage = element(doc, "select", "pprw-select");
    stage.setAttribute("aria-label", `Screening stage for ${rowView.title}`);
    for (const [value, label] of [
      ["abstract", "Abstract"],
      ["full-text", "Full text"],
    ]) {
      const option = element(doc, "option", "", label);
      option.value = value;
      option.selected = (current?.stage ?? "abstract") === value;
      if (value === "full-text" && source?.availability !== "ready") {
        option.disabled = true;
      }
      stage.append(option);
    }
    const decision = element(doc, "select", "pprw-select");
    decision.setAttribute(
      "aria-label",
      `Screening decision for ${rowView.title}`,
    );
    for (const [value, label] of [
      ["maybe", "Maybe"],
      ["include", "Include"],
      ["exclude", "Exclude"],
    ]) {
      const option = element(doc, "option", "", label);
      option.value = value;
      option.selected =
        (current?.decision ?? rowView.legacyDecision ?? "maybe") === value;
      decision.append(option);
    }
    const reasonCode = element(doc, "select", "pprw-select");
    reasonCode.setAttribute("aria-label", `Reason type for ${rowView.title}`);
    for (const [value, label] of [
      ["other", "Other reason"],
      ["criterion", "Protocol criterion"],
      ["duplicate", "Duplicate"],
      ["missing-pdf", "Missing PDF"],
    ]) {
      const option = element(doc, "option", "", label);
      option.value = value;
      option.selected = (current?.reason?.code ?? "other") === value;
      reasonCode.append(option);
    }
    const criterion = element(doc, "select", "pprw-select");
    criterion.setAttribute(
      "aria-label",
      `Protocol criterion for ${rowView.title}`,
    );
    criterion.append(element(doc, "option", "", "No criterion selected"));
    for (const entry of criteria) {
      const option = element(doc, "option", "", `${entry.kind}: ${entry.text}`);
      option.value = entry.criterionID;
      option.selected =
        current?.reason?.criterionIDs?.includes(entry.criterionID) ?? false;
      criterion.append(option);
    }
    const reason = textInput(
      doc,
      "Reason (required for exclusion)",
      current?.reason?.text ?? "",
    );
    reason.setAttribute("aria-label", `Screening reason for ${rowView.title}`);
    const note = textInput(doc, "Optional reviewer note", current?.note ?? "");
    note.setAttribute("aria-label", `Reviewer note for ${rowView.title}`);
    let submissionID: string | undefined;
    const recordButton = button(
      doc,
      "Record decision",
      async () => {
        try {
          submissionID ??= `screening-submission-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
          setMessage(root, `Recording decision for ${rowView.title}…`);
          await recordResearchWorkspaceScreeningDecision({
            projectID: details.project.projectID,
            sourceID: rowView.sourceID,
            stage: stage.value as "abstract" | "full-text",
            decision: decision.value as "include" | "exclude" | "maybe",
            ...(reason.value.trim()
              ? {
                  reasonCode: reasonCode.value as
                    | "criterion"
                    | "duplicate"
                    | "missing-pdf"
                    | "other",
                  reason: reason.value,
                }
              : {}),
            ...(reasonCode.value === "criterion" && criterion.value
              ? { criterionIDs: [criterion.value] }
              : {}),
            ...(note.value.trim() ? { note: note.value } : {}),
            submissionID,
            expectedProjectRevision: details.projectRevision,
            expectedMembersRevision: details.membersRevision,
          });
          submissionID = undefined;
          await navigation.renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      },
      true,
    );
    form.append(
      stage,
      decision,
      reasonCode,
      criterion,
      reason,
      note,
      recordButton,
    );
    row.append(heading, form);
    if (rowView.history.length) {
      const history = element(doc, "details", "pprw-screening-history");
      history.append(
        element(
          doc,
          "summary",
          "",
          `${rowView.history.length} immutable decision event${rowView.history.length === 1 ? "" : "s"}`,
        ),
      );
      const historyList = element(doc, "ol", "");
      for (const event of [...rowView.history].reverse()) {
        historyList.append(
          element(
            doc,
            "li",
            "",
            `${event.decidedAt} · ${event.stage} · ${event.decision}${
              event.reason?.text ? ` · ${event.reason.text}` : ""
            }`,
          ),
        );
      }
      history.append(historyList);
      row.append(history);
    }
    list.append(row);
  }
  filter.addEventListener("change", () => {
    for (const row of Array.from(list.children) as HTMLElement[]) {
      row.hidden =
        filter.value !== "all" &&
        (filter.value === "issues"
          ? row.dataset.screeningIssues !== "true"
          : row.dataset.screeningDecision !== filter.value);
    }
  });
  if (!log.rows.length) {
    list.append(
      element(doc, "p", "pprw-muted", "Add papers to begin screening."),
    );
  }
  section.append(list);
  return section;
}

export function renderProjectPapers(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(element(doc, "h3", "", `Papers · ${details.members.length}`));
  if (!details.members.length) {
    section.append(
      element(doc, "p", "pprw-muted", "This project has no papers yet."),
    );
    return section;
  }
  const sourceByID = new Map(
    details.sources.map((source) => [source.sourceID, source]),
  );
  const list = element(doc, "div", "pprw-project-paper-list");
  for (const member of details.members) {
    const source = sourceByID.get(member.sourceID);
    const row = element(doc, "div", "pprw-project-paper-row");
    const label = element(doc, "div", "pprw-project-paper-label");
    label.append(
      element(doc, "strong", "", source?.title ?? member.sourceID),
      element(
        doc,
        "span",
        "pprw-muted",
        `${source?.availability ?? "missing"} · ${source?.identity.attachmentKey ?? "detached"}`,
      ),
    );
    const select = element(doc, "select", "pprw-select");
    const progressStatuses = [
      "unreviewed",
      "up-next",
      "skimmed",
      "read",
      "understood",
    ] as const;
    if (!progressStatuses.includes(member.reviewStatus as any)) {
      const current = element(
        doc,
        "option",
        "",
        `Screened: ${member.reviewStatus}`,
      );
      current.value = member.reviewStatus;
      current.selected = true;
      select.append(current);
    }
    for (const status of progressStatuses) {
      const option = element(doc, "option", "", status);
      option.value = status;
      option.selected = member.reviewStatus === status;
      select.append(option);
    }
    select.setAttribute(
      "aria-label",
      `Reading progress for ${source?.title ?? member.sourceID}`,
    );
    if (
      member.screeningEvents?.length ||
      !progressStatuses.includes(member.reviewStatus as any)
    ) {
      select.disabled = true;
      select.title = "Use Screening & exclusion log to change this decision.";
    }
    select.addEventListener("change", () => {
      void (async () => {
        try {
          await updateResearchWorkspaceMember({
            projectID: details.project.projectID,
            sourceID: member.sourceID,
            reviewStatus: select.value as any,
          });
          await navigation.renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      })();
    });
    row.append(label, select);
    list.append(row);
  }
  section.append(list);
  return section;
}

export function renderArtifactHistory(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(
    element(doc, "h3", "", `Artifacts · ${details.artifacts.length}`),
  );
  if (!details.artifacts.length) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No artifacts yet. Running an explicit operation creates a versioned artifact and run record.",
      ),
    );
    return section;
  }
  const list = element(doc, "div", "pprw-artifact-history");
  for (const storedArtifact of details.artifacts) {
    const readable = readResearchWorkspaceArtifact(storedArtifact);
    const artifact = readable.artifact;
    const item = element(doc, "details", "pprw-artifact-card");
    const summary = element(doc, "summary", "pprw-artifact-summary");
    summary.append(
      element(doc, "strong", "", artifact.title),
      ...(readable.legacy
        ? [element(doc, "span", "pprw-artifact-status", "legacy · read only")]
        : []),
      element(
        doc,
        "span",
        `pprw-artifact-status pprw-artifact-status--${artifact.status}`,
        `v${artifact.version} · ${artifact.status}`,
      ),
    );
    const meta = element(
      doc,
      "p",
      "pprw-muted",
      `${artifact.sourceIDs.length} source${artifact.sourceIDs.length === 1 ? "" : "s"} · ${new Date(artifact.updatedAt).toLocaleString()}`,
    );
    item.append(summary, meta);
    if (artifact.staleReasons?.length) {
      item.append(
        element(
          doc,
          "p",
          "pprw-project-warning",
          `Stale: ${artifact.staleReasons.join(", ")}`,
        ),
      );
    }
    item.append(
      renderResearchWorkspaceArtifactEnvelope(doc, artifact, {
        responseLanguage: String(getPref("responseLanguage") || "English"),
        onCopyText: (text) => copyTextToClipboard(text, doc),
        onOpenEvidence: async (reference) => {
          try {
            await openVerifiedResearchWorkspaceEvidence(
              reference as unknown as EvidenceReferenceV2,
            );
          } catch (error) {
            setMessage(
              root,
              error instanceof Error ? error.message : String(error),
              "error",
            );
          }
        },
      }),
    );
    list.append(item);
  }
  section.append(list);
  return section;
}
