// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
import * as engine_1 from "./engine";
import { enumValue, optionalUnitInterval } from "../parserValidation";
const STATUSES = new Set([
  "extracted",
  "not_reported",
  "unclear",
  "conflicting",
  "error",
]);
function parseCells(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const columnMap = new Map(
    params.columns.map((column) => [column.id, column]),
  );
  const allowedAttachmentKeys = new Set(params.attachmentKeys);
  const seen = new Set();
  const cells = (0, json_1.readArray)(root.cells, "cells").map(
    (entry, index) => {
      const object = (0, json_1.readObject)(entry, `cells[${index}]`);
      const paperKey =
        typeof object.paperKey === "string" && object.paperKey.trim()
          ? object.paperKey.trim()
          : params.paperKey;
      if (paperKey !== params.paperKey)
        throw new Error(
          `Cell paper key ${paperKey} does not match ${params.paperKey}`,
        );
      const columnId = String(object.columnId ?? "").trim();
      if (!columnId || seen.has(columnId))
        throw new Error(`Missing or duplicate column ${columnId}`);
      seen.add(columnId);
      const column = columnMap.get(columnId);
      if (!column) throw new Error(`Unknown column ${columnId}`);
      const evidence = (0, types_1.normalizeEvidenceReferences)(
        object.evidence,
        { allowedAttachmentKeys },
      );
      const rawValue = object.value === undefined ? null : object.value;
      return (0, engine_1.normalizeEvidenceMatrixCell)(column, {
        paperKey,
        columnId,
        value: rawValue,
        displayValue:
          typeof object.displayValue === "string"
            ? object.displayValue
            : undefined,
        ...(object.status !== undefined
          ? { status: enumValue(object.status, "cell status", STATUSES) }
          : {}),
        ...(optionalUnitInterval(
          object.confidence,
          `cells[${index}].confidence`,
        ) !== undefined
          ? {
              confidence: optionalUnitInterval(
                object.confidence,
                `cells[${index}].confidence`,
              ),
            }
          : {}),
        evidence,
        ...(typeof object.notes === "string" && object.notes.trim()
          ? { notes: object.notes.trim() }
          : {}),
      });
    },
  );
  for (const column of params.columns)
    if (!seen.has(column.id)) throw new Error(`Missing column ${column.id}`);
  return cells;
}
function parseEvidenceMatrixExtractionResponse(params) {
  return parseCells(params);
}
function parseEvidenceMatrixRowResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  return {
    paperKey: params.paperKey,
    attachmentKey: params.attachmentKey,
    title: (0, json_1.readString)(root.title, "title"),
    cells: parseCells({
      response: params.response,
      paperKey: params.paperKey,
      attachmentKeys: [params.attachmentKey],
      columns: params.columns,
    }),
    createdAt: params.now ?? new Date().toISOString(),
  };
}

export {
  parseEvidenceMatrixExtractionResponse,
  parseEvidenceMatrixRowResponse,
};
