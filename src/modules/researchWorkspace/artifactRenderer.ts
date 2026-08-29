import { formatEvidenceLocator } from "./core/evidence/types";
import type {
  ResearchWorkspaceArtifactType,
  ResearchWorkspaceArtifact,
} from "./persistence/contracts";

const HTML_NS = "http://www.w3.org/1999/xhtml";

type UnknownRecord = Record<string, unknown>;

export interface ResearchWorkspaceEvidenceView {
  reference: UnknownRecord;
  locator: string;
  status: string;
}

export interface ResearchWorkspaceMatrixCellView {
  columnID: string;
  value: string;
  status: string;
  confidence?: number;
  evidence: ResearchWorkspaceEvidenceView[];
}

export interface ResearchWorkspaceMatrixView {
  kind: "matrix";
  columns: Array<{ id: string; label: string }>;
  rows: Array<{
    sourceID: string;
    title: string;
    cells: ResearchWorkspaceMatrixCellView[];
  }>;
  coverage?: {
    extraction?: number;
    evidence?: number;
    requiredEvidence?: number;
  };
}

export interface ResearchWorkspaceGraphView {
  kind: "graph";
  nodeCount: number;
  edgeCount: number;
  verifiedEdgeCount: number;
  inferredEdgeCount: number;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relationship: string;
    provenance: string;
    confidence?: number;
    evidence: ResearchWorkspaceEvidenceView[];
  }>;
}

export interface ResearchWorkspaceSynthesisView {
  kind: "synthesis";
  answer: string;
  groups: Array<{
    title: string;
    entries: Array<{
      statement: string;
      support: string;
      sourceIDs: string[];
      uncertainty?: string;
      evidence: ResearchWorkspaceEvidenceView[];
    }>;
  }>;
  unresolvedUncertainty: string[];
  freshnessWarnings: string[];
  coverage?: {
    analyzedSources?: number;
    totalProjectSources?: number;
    excludedSources?: number;
    insufficient?: boolean;
  };
}

export interface ResearchWorkspaceGenericView {
  kind: "generic";
  value: unknown;
}

export type ResearchWorkspaceArtifactView =
  | ResearchWorkspaceMatrixView
  | ResearchWorkspaceGraphView
  | ResearchWorkspaceSynthesisView
  | ResearchWorkspaceGenericView;

export interface ResearchWorkspaceArtifactRendererOptions {
  artifactType?: ResearchWorkspaceArtifactType;
  onOpenEvidence?: (reference: UnknownRecord) => void | Promise<void>;
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.map((entry) => text(entry, "")).join("; ");
  if (typeof value === "object") return fallback;
  return String(value);
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function isEvidence(value: unknown): value is UnknownRecord {
  const candidate = record(value);
  return Boolean(
    candidate &&
      typeof candidate.attachmentKey === "string" &&
      (candidate.pageIndex !== undefined ||
        candidate.pageLabel !== undefined ||
        candidate.sectionPath !== undefined ||
        candidate.quote !== undefined ||
        candidate.exactQuote !== undefined ||
        candidate.elementId !== undefined),
  );
}

function evidenceViews(value: unknown): ResearchWorkspaceEvidenceView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEvidence).map((reference) => ({
    reference,
    locator: formatEvidenceLocator(reference),
    status: text(record(reference.verification)?.status, "unverified"),
  }));
}

function matrixView(
  value: UnknownRecord,
): ResearchWorkspaceMatrixView | undefined {
  const matrix = record(value.matrix) ?? value;
  if (!Array.isArray(matrix.columns) || !Array.isArray(matrix.rows)) {
    return undefined;
  }
  const columns = matrix.columns
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      id: text(entry.id, ""),
      label: text(entry.label ?? entry.id, "Column"),
    }))
    .filter((entry) => entry.id);
  if (!columns.length) return undefined;
  const rows = matrix.rows
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      sourceID: text(entry.paperKey ?? entry.sourceID, ""),
      title: text(entry.title, text(entry.paperKey, "Paper")),
      cells: (Array.isArray(entry.cells) ? entry.cells : [])
        .map((cell) => record(cell))
        .filter((cell): cell is UnknownRecord => Boolean(cell))
        .map((cell) => ({
          columnID: text(cell.columnId ?? cell.columnID, ""),
          value: text(cell.displayValue ?? cell.value),
          status: text(cell.status, "unknown"),
          confidence: finite(cell.confidence),
          evidence: evidenceViews(cell.evidence),
        })),
    }));
  const coverage = record(value.coverage);
  return {
    kind: "matrix",
    columns,
    rows,
    ...(coverage
      ? {
          coverage: {
            extraction: finite(
              coverage.extractionCoverage ?? coverage.coverage,
            ),
            evidence: finite(coverage.evidenceCoverage),
            requiredEvidence: finite(coverage.requiredEvidenceCoverage),
          },
        }
      : {}),
  };
}

function graphView(
  value: UnknownRecord,
): ResearchWorkspaceGraphView | undefined {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return undefined;
  }
  const labels = new Map<string, string>();
  for (const candidate of value.nodes) {
    const node = record(candidate);
    if (!node) continue;
    labels.set(text(node.id, ""), text(node.label ?? node.id, "Unknown node"));
  }
  const edges = value.edges
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      id: text(entry.id, ""),
      source: labels.get(text(entry.source, "")) ?? text(entry.source),
      target: labels.get(text(entry.target, "")) ?? text(entry.target),
      relationship: text(entry.kind ?? entry.type, "related"),
      provenance: text(
        entry.provenance ??
          entry.verificationState ??
          (entry.verified === true ? "verified" : "inferred"),
        "inferred",
      ),
      confidence: finite(entry.confidence),
      evidence: evidenceViews(entry.evidence),
    }));
  const verifiedEdgeCount = edges.filter((edge) =>
    ["verified", "local-evidence", "bibliographic"].includes(edge.provenance),
  ).length;
  return {
    kind: "graph",
    nodeCount: labels.size,
    edgeCount: edges.length,
    verifiedEdgeCount,
    inferredEdgeCount: edges.length - verifiedEdgeCount,
    edges,
  };
}

function synthesisEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry))
    .map((entry) => ({
      statement: text(entry.statement ?? entry.claim, "Unlabelled statement"),
      support: text(
        entry.support ??
          (entry.paperSupported === true ? "verified" : "inferred"),
        "inferred",
      ),
      sourceIDs: Array.isArray(entry.sourceIDs)
        ? entry.sourceIDs.map((sourceID) => text(sourceID, "")).filter(Boolean)
        : [],
      ...(typeof entry.uncertainty === "string" && entry.uncertainty.trim()
        ? { uncertainty: entry.uncertainty.trim() }
        : {}),
      evidence: evidenceViews(entry.evidence),
    }));
}

function synthesisView(
  value: UnknownRecord,
): ResearchWorkspaceSynthesisView | undefined {
  if (typeof value.answer !== "string" || !Array.isArray(value.claims)) {
    return undefined;
  }
  const coverage = record(value.coverage);
  const contextCoverage = record(coverage?.contextPlan);
  const excludedSources = Array.isArray(coverage?.excludedSources)
    ? coverage.excludedSources.length
    : undefined;
  return {
    kind: "synthesis",
    answer: value.answer.trim(),
    groups: [
      { title: "Claims", entries: synthesisEntries(value.claims) },
      { title: "Agreements", entries: synthesisEntries(value.agreements) },
      {
        title: "Contradictions",
        entries: synthesisEntries(value.contradictions),
      },
    ].filter((group) => group.entries.length),
    unresolvedUncertainty: Array.isArray(value.unresolvedUncertainty)
      ? value.unresolvedUncertainty
          .map((entry) => text(entry, ""))
          .filter(Boolean)
      : [],
    freshnessWarnings: Array.isArray(value.freshnessWarnings)
      ? value.freshnessWarnings.map((entry) => text(entry, "")).filter(Boolean)
      : [],
    ...(coverage
      ? {
          coverage: {
            analyzedSources: finite(coverage.analyzedSources),
            totalProjectSources: finite(coverage.totalProjectSources),
            excludedSources,
            insufficient:
              contextCoverage?.insufficientCoverage === true ||
              coverage.insufficientCoverage === true,
          },
        }
      : {}),
  };
}

export function createResearchWorkspaceArtifactView(
  value: unknown,
  artifactType?: ResearchWorkspaceArtifactType,
): ResearchWorkspaceArtifactView {
  const candidate = record(value);
  if (!candidate) return { kind: "generic", value };
  if (artifactType === "evidence-matrix" || candidate.matrix) {
    const matrix = matrixView(candidate);
    if (matrix) return matrix;
  }
  if (
    artifactType === "relationship-graph" ||
    (candidate.nodes && candidate.edges)
  ) {
    const graph = graphView(candidate);
    if (graph) return graph;
  }
  if (artifactType === "synthesis" || (candidate.answer && candidate.claims)) {
    const synthesis = synthesisView(candidate);
    if (synthesis) return synthesis;
  }
  return { kind: "generic", value };
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  contents?: string,
) {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (contents !== undefined) node.textContent = contents;
  return node;
}

function percentage(value: number | undefined) {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function badge(doc: Document, label: string, tone = "") {
  return element(
    doc,
    "span",
    `pprw-render-badge${tone ? ` pprw-render-badge--${tone}` : ""}`,
    label,
  );
}

function renderEvidence(
  doc: Document,
  evidence: ResearchWorkspaceEvidenceView[],
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const group = element(doc, "div", "pprw-render-evidence");
  for (const item of evidence) {
    const verified = item.status === "verified";
    if (verified && options.onOpenEvidence) {
      const control = element(
        doc,
        "button",
        "pprw-render-evidence-link",
        `Verified · ${item.locator}`,
      );
      control.type = "button";
      control.addEventListener("click", () => {
        void options.onOpenEvidence?.(item.reference);
      });
      group.append(control);
    } else {
      group.append(
        element(
          doc,
          "span",
          `pprw-render-evidence-link pprw-render-evidence-link--${
            verified ? "verified" : "unverified"
          }`,
          `${humanize(item.status)} · ${item.locator}`,
        ),
      );
    }
  }
  return group;
}

function metric(doc: Document, label: string, value: string) {
  const node = element(doc, "div", "pprw-render-metric");
  node.append(
    element(doc, "strong", "", value),
    element(doc, "span", "", label),
  );
  return node;
}

function renderMatrix(
  doc: Document,
  view: ResearchWorkspaceMatrixView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--matrix");
  if (view.coverage) {
    const metrics = element(doc, "div", "pprw-render-metrics");
    metrics.append(
      metric(doc, "Extraction", percentage(view.coverage.extraction)),
      metric(doc, "Evidence", percentage(view.coverage.evidence)),
      metric(
        doc,
        "Required evidence",
        percentage(view.coverage.requiredEvidence),
      ),
      metric(doc, "Papers", String(view.rows.length)),
    );
    root.append(metrics);
  }
  const scroller = element(doc, "div", "pprw-matrix-scroll");
  const table = element(doc, "table", "pprw-matrix-table");
  table.append(element(doc, "caption", "", "Evidence Matrix"));
  const head = element(doc, "thead");
  const headRow = element(doc, "tr");
  headRow.append(element(doc, "th", "", "Paper"));
  for (const column of view.columns) {
    headRow.append(element(doc, "th", "", column.label));
  }
  head.append(headRow);
  table.append(head);
  const body = element(doc, "tbody");
  for (const row of view.rows) {
    const tableRow = element(doc, "tr");
    const paperCell = element(doc, "th", "pprw-matrix-paper", row.title);
    paperCell.scope = "row";
    tableRow.append(paperCell);
    const cells = new Map(row.cells.map((cell) => [cell.columnID, cell]));
    for (const column of view.columns) {
      const cell = cells.get(column.id);
      const tableCell = element(doc, "td");
      if (!cell) {
        tableCell.append(badge(doc, "Pending", "warning"));
      } else {
        const value = element(doc, "div", "pprw-matrix-value", cell.value);
        const meta = element(doc, "div", "pprw-render-inline");
        meta.append(
          badge(
            doc,
            humanize(cell.status),
            cell.status === "extracted" ? "success" : "warning",
          ),
        );
        if (cell.confidence !== undefined) {
          meta.append(badge(doc, `Confidence ${percentage(cell.confidence)}`));
        }
        tableCell.append(value, meta);
        if (cell.evidence.length) {
          tableCell.append(renderEvidence(doc, cell.evidence, options));
        }
      }
      tableRow.append(tableCell);
    }
    body.append(tableRow);
  }
  table.append(body);
  scroller.append(table);
  root.append(scroller);
  return root;
}

function renderGraph(
  doc: Document,
  view: ResearchWorkspaceGraphView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--graph");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Nodes", String(view.nodeCount)),
    metric(doc, "Relationships", String(view.edgeCount)),
    metric(doc, "Verified", String(view.verifiedEdgeCount)),
    metric(doc, "Inferred", String(view.inferredEdgeCount)),
  );
  root.append(metrics);
  const list = element(doc, "div", "pprw-graph-list");
  for (const edge of view.edges) {
    const card = element(doc, "article", "pprw-render-card");
    const relationship = element(doc, "div", "pprw-graph-relationship");
    relationship.append(
      element(doc, "strong", "", edge.source),
      badge(doc, humanize(edge.relationship), "accent"),
      element(doc, "strong", "", edge.target),
    );
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(edge.provenance),
        edge.provenance === "inferred" ? "warning" : "success",
      ),
    );
    if (edge.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(edge.confidence)}`));
    }
    card.append(relationship, metadata);
    if (edge.evidence.length) {
      card.append(renderEvidence(doc, edge.evidence, options));
    }
    list.append(card);
  }
  if (!view.edges.length) {
    list.append(
      element(doc, "p", "pprw-muted", "No relationships were produced."),
    );
  }
  root.append(list);
  return root;
}

function renderStringList(doc: Document, title: string, entries: string[]) {
  const section = element(doc, "section", "pprw-render-section");
  section.append(element(doc, "h4", "", title));
  const list = element(doc, "ul", "pprw-render-list");
  for (const entry of entries) list.append(element(doc, "li", "", entry));
  section.append(list);
  return section;
}

function renderSynthesis(
  doc: Document,
  view: ResearchWorkspaceSynthesisView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--synthesis");
  root.append(element(doc, "p", "pprw-synthesis-answer", view.answer));
  if (view.coverage) {
    const metrics = element(doc, "div", "pprw-render-metrics");
    metrics.append(
      metric(doc, "Analyzed", String(view.coverage.analyzedSources ?? "—")),
      metric(
        doc,
        "Project sources",
        String(view.coverage.totalProjectSources ?? "—"),
      ),
      metric(doc, "Excluded", String(view.coverage.excludedSources ?? "—")),
      metric(
        doc,
        "Coverage",
        view.coverage.insufficient ? "Limited" : "Sufficient",
      ),
    );
    root.append(metrics);
  }
  for (const group of view.groups) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", group.title));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const entry of group.entries) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "p", "pprw-render-statement", entry.statement));
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(
          doc,
          humanize(entry.support),
          entry.support === "verified" ? "success" : "warning",
        ),
        badge(
          doc,
          `${entry.sourceIDs.length} source${
            entry.sourceIDs.length === 1 ? "" : "s"
          }`,
        ),
      );
      card.append(metadata);
      if (entry.uncertainty) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Uncertainty: ${entry.uncertainty}`,
          ),
        );
      }
      if (entry.evidence.length) {
        card.append(renderEvidence(doc, entry.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.unresolvedUncertainty.length) {
    root.append(
      renderStringList(
        doc,
        "Unresolved uncertainty",
        view.unresolvedUncertainty,
      ),
    );
  }
  if (view.freshnessWarnings.length) {
    const warnings = renderStringList(
      doc,
      "Freshness and coverage warnings",
      view.freshnessWarnings,
    );
    warnings.classList.add("pprw-render-section--warning");
    root.append(warnings);
  }
  return root;
}

const HIDDEN_TECHNICAL_FIELDS = new Set([
  "id",
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "contentFingerprint",
  "projectionFingerprint",
]);

function renderContextPlan(doc: Document, value: UnknownRecord) {
  const section = element(doc, "section", "pprw-render-section");
  section.append(element(doc, "h4", "", "Context coverage"));
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Budget", text(value.requestedBudget)),
    metric(doc, "Used", text(value.usedCharacters)),
    metric(doc, "Omitted", text(value.omittedCharacters)),
    metric(
      doc,
      "Sources",
      String(Array.isArray(value.projections) ? value.projections.length : "—"),
    ),
  );
  section.append(metrics);
  if (value.insufficientCoverage === true) {
    section.append(
      element(
        doc,
        "p",
        "pprw-render-note pprw-render-note--warning",
        "One or more sources had limited bounded coverage.",
      ),
    );
  }
  return section;
}

function renderGenericValue(
  doc: Document,
  value: unknown,
  options: ResearchWorkspaceArtifactRendererOptions,
  depth = 0,
  label?: string,
): HTMLElement {
  if (isEvidence(value)) {
    return renderEvidence(doc, evidenceViews([value]), options);
  }
  if (value === null || value === undefined) {
    return element(doc, "span", "pprw-render-empty", "Not reported");
  }
  if (typeof value !== "object") {
    return element(doc, "span", "pprw-render-scalar", text(value));
  }
  if (depth >= 5) {
    return element(
      doc,
      "span",
      "pprw-render-empty",
      "Additional detail hidden",
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return element(doc, "span", "pprw-render-empty", "None");
    const list = element(doc, "div", "pprw-render-card-list");
    for (const entry of value.slice(0, 80)) {
      const item = element(doc, "article", "pprw-render-card");
      item.append(renderGenericValue(doc, entry, options, depth + 1));
      list.append(item);
    }
    return list;
  }
  const candidate = value as UnknownRecord;
  if (label === "contextPlan") return renderContextPlan(doc, candidate);
  const container = element(doc, "div", "pprw-render-fields");
  for (const [key, entry] of Object.entries(candidate)) {
    if (HIDDEN_TECHNICAL_FIELDS.has(key)) continue;
    if (key === "evidence") {
      const evidence = evidenceViews(entry);
      if (evidence.length)
        container.append(renderEvidence(doc, evidence, options));
      continue;
    }
    if (key === "contextPlan" && record(entry)) {
      container.append(renderContextPlan(doc, record(entry)!));
      continue;
    }
    const field = element(doc, "section", "pprw-render-field");
    field.append(element(doc, "h5", "", humanize(key)));
    field.append(renderGenericValue(doc, entry, options, depth + 1, key));
    container.append(field);
  }
  if (!container.childElementCount) {
    container.append(element(doc, "span", "pprw-render-empty", "No details"));
  }
  return container;
}

export function renderResearchWorkspaceArtifactValue(
  doc: Document,
  value: unknown,
  options: ResearchWorkspaceArtifactRendererOptions = {},
) {
  const view = createResearchWorkspaceArtifactView(value, options.artifactType);
  if (view.kind === "matrix") return renderMatrix(doc, view, options);
  if (view.kind === "graph") return renderGraph(doc, view, options);
  if (view.kind === "synthesis") return renderSynthesis(doc, view, options);
  const root = element(doc, "div", "pprw-render pprw-render--generic");
  root.append(renderGenericValue(doc, view.value, options));
  return root;
}

export function renderResearchWorkspaceArtifactEnvelope(
  doc: Document,
  artifact: ResearchWorkspaceArtifact,
  options: Omit<ResearchWorkspaceArtifactRendererOptions, "artifactType"> = {},
) {
  const root = element(doc, "div", "pprw-render-envelope");
  const lineage = element(doc, "div", "pprw-render-inline");
  lineage.append(
    badge(doc, humanize(artifact.lineage.operation), "accent"),
    badge(doc, artifact.lineage.operationVersion),
    badge(doc, humanize(artifact.lineage.providerMode)),
    badge(
      doc,
      `${artifact.sourceIDs.length} source${
        artifact.sourceIDs.length === 1 ? "" : "s"
      }`,
    ),
  );
  root.append(lineage);
  if (artifact.checkpoint) {
    const progress = element(doc, "div", "pprw-render-metrics");
    progress.append(
      metric(
        doc,
        "Completed",
        String(artifact.checkpoint.completedUnits.length),
      ),
      metric(doc, "Failed", String(artifact.checkpoint.failedUnits.length)),
      metric(doc, "Pending", String(artifact.checkpoint.pendingUnits.length)),
    );
    root.append(progress);
  }
  root.append(
    renderResearchWorkspaceArtifactValue(doc, artifact.payload, {
      ...options,
      artifactType: artifact.type,
    }),
  );
  return root;
}
