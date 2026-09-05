import type { EvidenceMatrix, MatrixCell } from "../contracts";
function quoteCsv(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function cellFor(
  matrix: Pick<
    EvidenceMatrix,
    "title" | "columns" | "papers" | "cells" | "rows"
  >,
  paperKey: string,
  columnId: string,
) {
  return (
    matrix.cells.find(
      (cell) => cell.paperKey === paperKey && cell.columnId === columnId,
    ) ??
    matrix.rows
      .find((row) => row.paperKey === paperKey)
      ?.cells.find((cell) => cell.columnId === columnId)
  );
}
function exportEvidenceMatrixCsv(
  matrix: Pick<
    EvidenceMatrix,
    "title" | "columns" | "papers" | "cells" | "rows"
  >,
) {
  const lines = [
    ["Paper", ...matrix.columns.map((column) => column.label)]
      .map(quoteCsv)
      .join(","),
  ];
  for (const paper of matrix.papers.length
    ? matrix.papers
    : matrix.rows.map((row) => ({
        paperKey: row.paperKey,
        title: row.title,
        attachmentKeys: [row.attachmentKey],
      }))) {
    lines.push(
      [
        paper.title,
        ...matrix.columns.map(
          (column) =>
            cellFor(matrix, paper.paperKey, column.id)?.displayValue ?? "",
        ),
      ]
        .map(quoteCsv)
        .join(","),
    );
  }
  return lines.join("\n");
}
function exportEvidenceMatrixMarkdown(
  matrix: Pick<
    EvidenceMatrix,
    "title" | "columns" | "papers" | "cells" | "rows"
  >,
) {
  const papers = matrix.papers.length
    ? matrix.papers
    : matrix.rows.map((row) => ({
        paperKey: row.paperKey,
        title: row.title,
        attachmentKeys: [row.attachmentKey],
      }));
  const escape = (value: string) =>
    value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `# ${matrix.title}`,
    "",
    `| Paper | ${matrix.columns.map((column) => escape(column.label)).join(" | ")} |`,
    `|---|${matrix.columns.map(() => "---").join("|")}|`,
  ];
  const sourceLabel = (cell: MatrixCell | undefined) => {
    if (!cell?.evidence.length) return "";
    const references = cell.evidence.slice(0, 3).map((reference) => {
      const page =
        reference.pageIndex === undefined
          ? ""
          : ` p.${reference.pageIndex + 1}`;
      return `${reference.attachmentKey}${page}`;
    });
    return ` <sub>${references.join("; ")}</sub>`;
  };
  for (const paper of papers) {
    lines.push(
      `| ${escape(paper.title)} | ${matrix.columns
        .map((column) => {
          const cell = cellFor(matrix, paper.paperKey, column.id);
          return escape(`${cell?.displayValue ?? ""}${sourceLabel(cell)}`);
        })
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

export {
  exportEvidenceMatrixCsv as evidenceMatrixToCsv,
  exportEvidenceMatrixMarkdown as evidenceMatrixToMarkdown,
  exportEvidenceMatrixCsv,
  exportEvidenceMatrixMarkdown,
};
