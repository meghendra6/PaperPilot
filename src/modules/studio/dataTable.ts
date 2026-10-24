import * as Papa from "papaparse";

export interface DataTable {
  headers: string[];
  rows: string[][];
  jsonRows?: Record<string, unknown>[];
  delimiter: "," | "\t";
  newline: string;
  bom: boolean;
  trailingNewline: boolean;
}

function parseGridJSON(text: string): unknown {
  return JSON.parse(text, (_key, value) => {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value)))
    )
      throw new Error(
        "This JSON contains numbers outside the grid’s safe precision. Use source view to preserve them.",
      );
    return value;
  });
}

/** Keep cell strings (including leading zeros and formulas) as data. */
export function parseDataTable(name: string, source: string): DataTable {
  const bom = source.startsWith("\uFEFF");
  const text = bom ? source.slice(1) : source;
  if (/\.jsonl$/i.test(name)) {
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const trailingNewline = text.endsWith(newline);
    const jsonRows = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, index) => {
        const value = parseGridJSON(line);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error(
            `JSONL row ${index + 1} is not an object. Use source view to edit it.`,
          );
        return value as Record<string, unknown>;
      });
    const headers = [...new Set(jsonRows.flatMap((row) => Object.keys(row)))];
    return {
      headers,
      rows: jsonRows.map((row) =>
        headers.map((key) =>
          Object.prototype.hasOwnProperty.call(row, key)
            ? JSON.stringify(row[key])
            : "",
        ),
      ),
      jsonRows,
      delimiter: ",",
      newline,
      bom,
      trailingNewline,
    };
  }
  const delimiter = /\.tsv$/i.test(name) ? "\t" : ",";
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    dynamicTyping: false,
  });
  if (parsed.errors.length)
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  // The CSV parser detects separators outside quoted cells. A cell's CRLF
  // must not turn an LF-delimited table's final terminator into an extra row.
  const newline = parsed.meta.linebreak;
  const trailingNewline = text.endsWith(newline);
  const rows = parsed.data;
  if (trailingNewline && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "")
    rows.pop();
  const headers = rows.shift() ?? [];
  if (rows.some((row) => row.length !== headers.length))
    throw new Error(
      "Rows have different column counts. Use source view to preserve them.",
    );
  return { headers, rows, delimiter, newline, bom, trailingNewline };
}

export function setDataCell(
  table: DataTable,
  row: number,
  column: number,
  value: string,
) {
  if (
    !Number.isSafeInteger(row) ||
    row < 0 ||
    row >= table.rows.length ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    column >= table.headers.length
  )
    throw new Error("Data cell is outside this table.");
  if (table.jsonRows) {
    const key = table.headers[column];
    if (value === "") delete table.jsonRows[row][key];
    else
      Object.defineProperty(table.jsonRows[row], key, {
        value: parseGridJSON(value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  table.rows[row][column] = value;
}

export function addDataColumn(table: DataTable, name: string) {
  if (
    !name.trim() ||
    name.length > 200 ||
    table.headers.includes(name) ||
    table.headers.length >= 2000
  )
    throw new Error(
      "Use a unique column name (1–200 characters; at most 2,000 columns).",
    );
  table.headers.push(name);
  for (const row of table.rows) row.push("");
}

export function addDataRow(table: DataTable) {
  if (!table.headers.length && !table.jsonRows)
    throw new Error("Add a column before adding CSV or TSV rows.");
  table.rows.push(table.headers.map(() => ""));
  table.jsonRows?.push({});
}

export function removeDataRow(table: DataTable, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= table.rows.length)
    throw new Error("Data row is outside this table.");
  table.rows.splice(index, 1);
  table.jsonRows?.splice(index, 1);
}

export function removeDataColumn(table: DataTable, index: number) {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= table.headers.length
  )
    throw new Error("Data column is outside this table.");
  if (!table.jsonRows && table.headers.length === 1 && table.rows.length)
    throw new Error("Remove all rows before removing the last column.");
  const [name] = table.headers.splice(index, 1);
  for (const row of table.rows) row.splice(index, 1);
  // Existing duplicate CSV headers are positional. JSONL keys are unique.
  for (const row of table.jsonRows ?? []) delete row[name];
}

export function serializeDataTable(table: DataTable) {
  const content = table.jsonRows
    ? table.jsonRows.map((row) => JSON.stringify(row)).join(table.newline)
    : Papa.unparse([table.headers, ...table.rows], {
        delimiter: table.delimiter,
        newline: table.newline,
        // An unquoted final empty cell is indistinguishable from a trailing
        // newline in a one-column file. Quote empties to preserve row count.
        quotes: (value) => value === "",
      });
  return (
    (table.bom ? "\uFEFF" : "") +
    content +
    (table.trailingNewline ? table.newline : "")
  );
}
