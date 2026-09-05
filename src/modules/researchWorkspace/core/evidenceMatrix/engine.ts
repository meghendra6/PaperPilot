import type {
  EvidenceMatrix,
  MatrixCell,
  MatrixColumn,
  MatrixPaper,
  MatrixRow,
  NamedArtifactInput,
} from "../contracts";
function display(value: unknown) {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
function normalizeColumn(column: MatrixColumn) {
  const extractionQuestion = (
    column.extractionQuestion ||
    column.question ||
    ""
  ).trim();
  if (!extractionQuestion)
    throw new Error(`Column ${column.id} requires an extraction question.`);
  return {
    ...column,
    extractionQuestion,
    question: extractionQuestion,
    enumValues: column.enumValues ? [...column.enumValues] : undefined,
  };
}
function createEvidenceMatrix(
  params: NamedArtifactInput & {
    columns: readonly MatrixColumn[];
    papers?: MatrixPaper[];
  },
): EvidenceMatrix {
  const columns = params.columns.map(normalizeColumn);
  const seen = new Set();
  for (const column of columns) {
    if (!/^[a-zA-Z0-9._-]+$/.test(column.id))
      throw new Error(`Invalid column id ${column.id}`);
    if (seen.has(column.id)) throw new Error(`Duplicate column ${column.id}`);
    seen.add(column.id);
    if (column.valueType === "enum" && !column.enumValues?.length)
      throw new Error(`Enum column ${column.id} requires values`);
  }
  const paperKeys = new Set();
  const papers = (params.papers ?? []).map((paper) => {
    if (paperKeys.has(paper.paperKey))
      throw new Error(`Duplicate paper ${paper.paperKey}`);
    paperKeys.add(paper.paperKey);
    return { ...paper, attachmentKeys: [...new Set(paper.attachmentKeys)] };
  });
  const now = params.now ?? new Date().toISOString();
  const title = (params.title || params.name || "Evidence Matrix").trim();
  return {
    schemaVersion: 2,
    id: params.id,
    title,
    name: title,
    columns,
    papers,
    cells: [],
    rows: [],
    createdAt: now,
    updatedAt: now,
  };
}
function normalizeEvidenceMatrixCell(
  column: MatrixColumn,
  cell: Omit<MatrixCell, "displayValue" | "status"> &
    Partial<Pick<MatrixCell, "displayValue" | "status">>,
): MatrixCell {
  let value = cell.value;
  if (value !== null) {
    if (column.valueType === "number") {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number))
        throw new Error(`${column.id} must be a number`);
      value = number;
    } else if (column.valueType === "boolean") {
      if (typeof value !== "boolean") {
        const normalized = String(value).toLowerCase();
        if (["true", "yes", "1"].includes(normalized)) value = true;
        else if (["false", "no", "0"].includes(normalized)) value = false;
        else throw new Error(`${column.id} must be boolean`);
      }
    } else if (column.valueType === "list") {
      value = Array.isArray(value)
        ? value.map(String)
        : String(value)
            .split(/[,;]\s*/)
            .filter(Boolean);
    } else {
      value = String(value);
      if (
        column.valueType === "enum" &&
        !column.enumValues?.includes(String(value))
      )
        throw new Error(`${column.id} has invalid enum value ${value}`);
    }
  }
  const status = cell.status ?? (value === null ? "not_reported" : "extracted");
  // Evidence requirements are reported by coverage instead of rejecting a
  // model response. This preserves missing-evidence cells for review.
  return {
    ...cell,
    value,
    status,
    displayValue: cell.displayValue?.trim() || display(value),
    ...(typeof cell.confidence === "number" && Number.isFinite(cell.confidence)
      ? { confidence: Math.max(0, Math.min(1, cell.confidence)) }
      : {}),
    evidence: [...cell.evidence],
  };
}
function rebuildRows(matrix: EvidenceMatrix, cells: MatrixCell[], now: string) {
  return matrix.papers.map((paper) => ({
    paperKey: paper.paperKey,
    attachmentKey: paper.attachmentKeys[0] ?? "",
    title: paper.title,
    cells: cells.filter((cell) => cell.paperKey === paper.paperKey),
    createdAt: now,
  }));
}
function upsertEvidenceMatrixCells(
  matrix: EvidenceMatrix,
  incoming: (Omit<MatrixCell, "displayValue" | "status"> &
    Partial<Pick<MatrixCell, "displayValue" | "status">>)[],
  now = new Date().toISOString(),
) {
  const columns = new Map(matrix.columns.map((column) => [column.id, column]));
  const paperKeys = new Set(matrix.papers.map((paper) => paper.paperKey));
  const byKey = new Map(
    matrix.cells.map((cell) => [
      `${cell.paperKey}\u0000${cell.columnId}`,
      cell,
    ]),
  );
  for (const cell of incoming) {
    if (!paperKeys.has(cell.paperKey))
      throw new Error(`Unknown paper ${cell.paperKey}`);
    const column = columns.get(cell.columnId);
    if (!column) throw new Error(`Unknown column ${cell.columnId}`);
    const normalized = normalizeEvidenceMatrixCell(column, cell);
    byKey.set(`${normalized.paperKey}\u0000${normalized.columnId}`, normalized);
  }
  const cells = [...byKey.values()].sort((left, right) => {
    const paperOrder =
      matrix.papers.findIndex((paper) => paper.paperKey === left.paperKey) -
      matrix.papers.findIndex((paper) => paper.paperKey === right.paperKey);
    return (
      paperOrder ||
      matrix.columns.findIndex((column) => column.id === left.columnId) -
        matrix.columns.findIndex((column) => column.id === right.columnId)
    );
  });
  return {
    ...matrix,
    cells,
    rows: rebuildRows(matrix, cells, now),
    updatedAt: now,
  };
}
function upsertEvidenceMatrixRow(matrix: EvidenceMatrix, row: MatrixRow) {
  let papers = matrix.papers;
  if (!papers.some((paper) => paper.paperKey === row.paperKey)) {
    papers = [
      ...papers,
      {
        paperKey: row.paperKey,
        title: row.title,
        attachmentKeys: row.attachmentKey ? [row.attachmentKey] : [],
      },
    ];
  }
  return upsertEvidenceMatrixCells(
    { ...matrix, papers },
    row.cells.map((cell) => ({ ...cell, paperKey: row.paperKey })),
  );
}
function calculateEvidenceMatrixCoverage(matrix: EvidenceMatrix) {
  const cellCount = matrix.papers.length * matrix.columns.length;
  const filled = matrix.cells.filter(
    (cell) =>
      cell.status === "extracted" &&
      cell.value !== null &&
      !!cell.displayValue.trim(),
  );
  const evidenced = filled.filter((cell) => cell.evidence.length > 0);
  const columnMap = new Map(
    matrix.columns.map((column) => [column.id, column]),
  );
  const requiredColumnCount = matrix.columns.filter(
    (column) => column.requiredEvidence,
  ).length;
  const requiredCellCount = matrix.papers.length * requiredColumnCount;
  const requiredEvidenced = filled.filter(
    (cell) =>
      columnMap.get(cell.columnId)?.requiredEvidence &&
      cell.evidence.length > 0,
  );
  const extractionCoverage = cellCount ? filled.length / cellCount : 1;
  return {
    cellCount,
    filledCount: filled.length,
    evidencedCount: evidenced.length,
    requiredEvidenceCount: requiredCellCount,
    extractionCoverage,
    coverage: extractionCoverage,
    evidenceCoverage: filled.length ? evidenced.length / filled.length : 1,
    requiredEvidenceCoverage: requiredCellCount
      ? requiredEvidenced.length / requiredCellCount
      : 1,
  };
}

export {
  calculateEvidenceMatrixCoverage,
  createEvidenceMatrix,
  normalizeEvidenceMatrixCell,
  upsertEvidenceMatrixCells,
  upsertEvidenceMatrixRow,
};
