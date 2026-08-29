import {
  addPapersToResearchWorkspaceProject,
  archiveResearchWorkspaceProject,
  createResearchWorkspaceProject,
  deleteResearchWorkspaceProject,
  exportResearchWorkspaceScreeningLog,
  exportIntegratedResearchWorkspace,
  loadResearchWorkspaceHome,
  loadResearchWorkspaceProject,
  recordResearchWorkspaceScreeningDecision,
  reviewResearchWorkspaceContradictionGap,
  runResearchWorkspaceContradictionGapDashboard,
  updateResearchWorkspaceMember,
  updateResearchWorkspaceProject,
  updateResearchWorkspaceScreeningProtocol,
} from "./facade";
import { renderResearchWorkspaceArtifactEnvelope } from "./artifactRenderer";
import { openVerifiedResearchWorkspaceEvidence } from "./evidenceNavigation";
import type { EvidenceReferenceV2 } from "./evidenceVerification";
import { readResearchWorkspaceArtifact } from "./legacyCapabilityAdapters";
import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchWorkspaceProjectDetails,
  ResearchWorkspaceProjectHome,
} from "./projectController";
import {
  disposeResearchWorkspaceView,
  renderResearchWorkspaceView,
} from "./view";
import {
  buildResearchWorkspaceScreeningLog,
  currentScreeningEvent,
} from "./screeningLog";
import type {
  ContradictionClassification,
  ContradictionGapDashboard,
} from "./contradictionGap";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const generations = new WeakMap<HTMLElement, symbol>();
const activeOperationRoots = new WeakMap<HTMLElement, HTMLElement>();

function disposeOperations(root: HTMLElement) {
  const operations = activeOperationRoots.get(root);
  if (operations) disposeResearchWorkspaceView(operations);
  activeOperationRoots.delete(root);
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  text?: string,
) {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  doc: Document,
  label: string,
  action: () => void | Promise<void>,
  primary = false,
) {
  const node = element(
    doc,
    "button",
    `pprw-button pp-btn ${primary ? "pp-btn--primary" : "pp-btn--secondary"}`,
    label,
  );
  node.type = "button";
  node.addEventListener("click", () => void action());
  return node;
}

function textInput(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "input", "pprw-input");
  node.type = "text";
  node.placeholder = placeholder;
  node.value = value;
  return node;
}

function setMessage(root: HTMLElement, message: string, kind = "info") {
  const node = root.querySelector<HTMLElement>("[data-project-message]");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

function isCurrent(root: HTMLElement, generation: symbol) {
  return generations.get(root) === generation;
}

function metric(doc: Document, value: number, label: string) {
  const node = element(doc, "div", "pprw-home-metric");
  node.append(
    element(doc, "strong", "", value.toLocaleString()),
    element(doc, "span", "", label),
  );
  return node;
}

function renderSelectionReview(
  doc: Document,
  papers: readonly ResearchWorkspacePaper[],
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(
    element(doc, "h2", "", "Review captured selection"),
    element(
      doc,
      "p",
      "pprw-muted",
      `${papers.length} exact PDF${papers.length === 1 ? " is" : "s are"} ready. No analysis starts until you choose a project and an operation.`,
    ),
  );
  const list = element(doc, "div", "pprw-project-paper-list");
  for (const paper of papers) {
    const row = element(doc, "div", "pprw-project-paper-row");
    row.append(
      element(doc, "strong", "", paper.title),
      element(
        doc,
        "span",
        "pprw-muted",
        `Library ${paper.libraryID} · PDF ${paper.attachmentKey} · ${paper.extractionQuality}`,
      ),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

async function renderProject(
  root: HTMLElement,
  projectID: string,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const details = await loadResearchWorkspaceProject(projectID);
  if (!isCurrent(root, generation)) return;
  const doc = root.ownerDocument;
  disposeOperations(root);
  root.replaceChildren();

  const toolbar = element(doc, "div", "pprw-project-toolbar");
  toolbar.append(
    button(doc, "All projects", () =>
      renderResearchWorkspaceProjectSurface(root, { capturedPapers }),
    ),
    element(doc, "h2", "", details.project.name),
  );
  root.append(toolbar);

  const message = element(doc, "div", "pprw-status", "Project ready.");
  message.dataset.projectMessage = "true";
  message.dataset.kind = "success";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  root.append(message);

  const settings = element(doc, "section", "pprw-project-panel");
  settings.append(element(doc, "h3", "", "Project settings"));
  const name = textInput(doc, "Project name", details.project.name);
  const question = textInput(
    doc,
    "Research question",
    details.project.researchQuestion ?? "",
  );
  const settingsActions = element(doc, "div", "pprw-row");
  settingsActions.append(
    button(
      doc,
      "Save project",
      async () => {
        try {
          setMessage(root, "Saving project…");
          await updateResearchWorkspaceProject(projectID, {
            name: name.value,
            researchQuestion: question.value || undefined,
          });
          await renderProject(root, projectID, capturedPapers, generation);
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
    button(doc, "Export JSON + Markdown", async () => {
      try {
        setMessage(root, "Exporting this project…");
        const result = await exportIntegratedResearchWorkspace({ projectID });
        setMessage(
          root,
          `Exported to ${result.jsonPath} and ${result.markdownPath}.`,
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
    button(doc, "Archive", async () => {
      await archiveResearchWorkspaceProject(projectID);
      await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
    }),
    button(doc, "Delete", async () => {
      const confirmed =
        doc.defaultView?.confirm(
          `Delete “${details.project.name}” and its Paper Pilot artifacts? Zotero items and PDFs will not be deleted.`,
        ) ?? false;
      if (!confirmed) return;
      await deleteResearchWorkspaceProject(projectID);
      await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
    }),
  );
  settings.append(name, question, settingsActions);
  root.append(settings);

  if (capturedPapers.length) {
    const captured = element(doc, "section", "pprw-project-panel");
    captured.append(
      element(doc, "h3", "", "Captured papers"),
      element(
        doc,
        "p",
        "pprw-muted",
        `${capturedPapers.length} paper${capturedPapers.length === 1 ? "" : "s"} from this immutable selection can be analyzed in this project.`,
      ),
      button(
        doc,
        "Add captured papers",
        async () => {
          setMessage(root, "Adding captured papers…");
          await addPapersToResearchWorkspaceProject(projectID, capturedPapers);
          await renderProject(root, projectID, capturedPapers, generation);
        },
        true,
      ),
    );
    root.append(captured);
  }

  root.append(
    renderScreeningLog(doc, root, details, capturedPapers, generation),
    renderProjectPapers(doc, root, details, capturedPapers, generation),
  );
  root.append(
    renderContradictionGapPanel(doc, root, details, capturedPapers, generation),
  );
  root.append(renderArtifactHistory(doc, root, details));

  if (capturedPapers.length) {
    const operations = element(doc, "section", "pprw-project-operations");
    activeOperationRoots.set(root, operations);
    root.append(operations);
    await renderResearchWorkspaceView(operations, undefined, {
      preloadedPaper: capturedPapers[0],
      capturedPapers,
      standalone: true,
      projectID,
    });
  } else {
    const empty = element(doc, "section", "pprw-project-panel");
    empty.append(
      element(doc, "h3", "", "Run an analysis"),
      element(
        doc,
        "p",
        "pprw-muted",
        "Capture one or more Zotero PDFs with Start a new selection, then open this project and add them.",
      ),
    );
    root.append(empty);
  }
}

function renderContradictionGapPanel(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
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
        await renderProject(
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
      "direct contradictions",
    ),
    metric(doc, dashboard.coverage.nonComparable, "non-comparable"),
    metric(doc, dashboard.coverage.uncertain, "uncertain"),
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
        "No comparable contradiction candidates were found in the current verified facts. Review the evidence gaps below in the saved artifact.",
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
        await renderProject(
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

function renderScreeningLog(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
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
        await renderProject(
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
          await renderProject(
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

function renderProjectPapers(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
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
          await renderProject(
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

function renderArtifactHistory(
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

function renderHomeCards(
  doc: Document,
  root: HTMLElement,
  home: ResearchWorkspaceProjectHome,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(element(doc, "h2", "", "Recent projects"));
  if (!home.projects.length) {
    section.append(
      element(doc, "p", "pprw-muted", "Create the first research project."),
    );
    return section;
  }
  const grid = element(doc, "div", "pprw-project-grid");
  for (const project of home.projects) {
    const card = element(doc, "article", "pprw-project-card");
    card.append(
      element(doc, "h3", "", project.name),
      element(
        doc,
        "p",
        "pprw-muted",
        `${project.memberCount} papers · ${project.staleArtifactCount} stale · updated ${new Date(project.updatedAt).toLocaleDateString()}`,
      ),
    );
    const actions = element(doc, "div", "pprw-row");
    actions.append(
      button(doc, "Open", () =>
        renderProject(root, project.projectID, capturedPapers, generation),
      ),
    );
    if (capturedPapers.length) {
      actions.append(
        button(
          doc,
          "Add captured papers",
          async () => {
            await addPapersToResearchWorkspaceProject(
              project.projectID,
              capturedPapers,
            );
            await renderProject(
              root,
              project.projectID,
              capturedPapers,
              generation,
            );
          },
          true,
        ),
      );
    }
    card.append(actions);
    grid.append(card);
  }
  section.append(grid);
  return section;
}

export async function renderResearchWorkspaceProjectSurface(
  root: HTMLElement,
  options: { capturedPapers?: readonly ResearchWorkspacePaper[] } = {},
) {
  disposeOperations(root);
  const generation = Symbol("project-surface");
  generations.set(root, generation);
  const capturedPapers = options.capturedPapers ?? [];
  const doc = root.ownerDocument;
  root.replaceChildren(
    element(doc, "div", "pprw-window-loading", "Loading projects…"),
  );
  try {
    const home = await loadResearchWorkspaceHome();
    if (!isCurrent(root, generation)) return;
    root.replaceChildren();
    const intro = element(doc, "section", "pprw-home");
    intro.append(
      element(doc, "h2", "", "Workspace home"),
      element(
        doc,
        "p",
        "pprw-muted",
        "Projects retain exact Zotero sources, versioned artifacts, and run history independently of the current selection.",
      ),
    );
    const metrics = element(doc, "div", "pprw-home-metrics");
    metrics.append(
      metric(doc, home.projects.length, "Active projects"),
      metric(doc, home.dueMasteryReviews, "Mastery reviews due"),
      metric(doc, home.staleArtifacts, "Stale artifacts"),
    );
    intro.append(metrics);
    root.append(intro);
    if (capturedPapers.length) {
      root.append(renderSelectionReview(doc, capturedPapers));
    }

    const create = element(doc, "section", "pprw-project-panel");
    create.append(element(doc, "h2", "", "Create project"));
    const name = textInput(
      doc,
      "Project name",
      capturedPapers.length
        ? `Research set · ${new Date().toLocaleDateString()}`
        : "",
    );
    const question = textInput(doc, "Research question (optional)");
    create.append(
      name,
      question,
      button(
        doc,
        capturedPapers.length
          ? "Create with captured papers"
          : "Create empty project",
        async () => {
          try {
            const created = await createResearchWorkspaceProject({
              name: name.value,
              researchQuestion: question.value || undefined,
              papers: capturedPapers,
            });
            await renderProject(
              root,
              created.project.projectID,
              capturedPapers,
              generation,
            );
          } catch (error) {
            const message = element(
              doc,
              "p",
              "pprw-project-warning",
              error instanceof Error ? error.message : String(error),
            );
            create.append(message);
          }
        },
        true,
      ),
    );
    root.append(create);
    root.append(renderHomeCards(doc, root, home, capturedPapers, generation));
    if (home.archivedProjects.length) {
      const archived = element(doc, "details", "pprw-project-panel");
      archived.append(
        element(
          doc,
          "summary",
          "pprw-section-title",
          `Archived projects · ${home.archivedProjects.length}`,
        ),
      );
      const list = element(doc, "ul", "pprw-capture-list");
      for (const project of home.archivedProjects) {
        list.append(element(doc, "li", "", project.name));
      }
      archived.append(list);
      root.append(archived);
    }
  } catch (error) {
    if (!isCurrent(root, generation)) return;
    root.replaceChildren(
      element(
        doc,
        "div",
        "pprw-window-error",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

export function disposeResearchWorkspaceProjectSurface(root: HTMLElement) {
  disposeOperations(root);
  generations.delete(root);
}
