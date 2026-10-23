import { parseDataTable } from "./dataTable";

export function relativeAssetPath(draft: string, asset: string) {
  const from = draft.split("/").slice(0, -1);
  const to = asset.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}

export function figureMarkup(draft: string, asset: string) {
  const path = relativeAssetPath(draft, asset);
  if (/\.tex$/i.test(draft)) {
    if (/[{}\\%\r\n]/.test(path))
      throw new Error(
        "Rename this image without TeX special characters before inserting it.",
      );
    return `\n\\begin{figure}[ht]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{\\detokenize{${path}}}\n\\caption{Figure caption}\n\\end{figure}\n`;
  }
  if (/\.typ$/i.test(draft))
    return `\n#figure(image(${JSON.stringify(path)}, width: 80%), caption: [Figure caption])\n`;
  if (/\.(md|markdown|myst)$/i.test(draft))
    return `\n![Figure caption](${path
      .split("/")
      .map((part) =>
        encodeURIComponent(part).replace(
          /[!'()*]/g,
          (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .join("/")})\n`;
  throw new Error("Insert figures into DOCX, Markdown, MyST, LaTeX or Typst.");
}

export function draftTable(name: string, text: string) {
  const table = parseDataTable(name, text);
  const rows = [table.headers, ...table.rows];
  if (
    !table.headers.length ||
    rows.length * table.headers.length > 1000 ||
    table.headers.length > 20
  )
    throw new Error(
      "Draft tables support at most 20 columns and 1,000 cells. Save a smaller table first.",
    );
  return rows;
}

export function tableMarkup(draft: string, rows: string[][]) {
  if (/\.typ$/i.test(draft))
    return `\n#table(columns: ${rows[0].length},\n${rows.map((row) => row.map((cell) => JSON.stringify(cell)).join(", ")).join(",\n")}\n)\n`;
  if (/\.tex$/i.test(draft)) {
    const escaped = (text: string) =>
      text
        .replace(
          /[\\{}$&#%_^~]/g,
          (char) =>
            ({
              "\\": "\\textbackslash{}",
              "~": "\\textasciitilde{}",
              "^": "\\textasciicircum{}",
            })[char] ?? `\\${char}`,
        )
        .replace(/[\r\n]+/g, " ");
    return `\n\\begin{tabular}{${"l".repeat(rows[0].length)}}\n${rows.map((row) => row.map(escaped).join(" & ")).join(" \\\\\n")}\n\\end{tabular}\n`;
  }
  if (/\.(md|markdown|myst)$/i.test(draft)) {
    const line = (row: string[]) =>
      `| ${row
        .map((cell) =>
          cell
            .replace(/[\\`*_[\]{}()#!|$@]/g, (char) => `\\${char}`)
            .replace(/[\r\n]+/g, " ")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;"),
        )
        .join(" | ")} |`;
    return `\n${line(rows[0])}\n${line(rows[0].map(() => "---"))}\n${rows.slice(1).map(line).join("\n")}\n`;
  }
  throw new Error("Insert tables into DOCX, Markdown, MyST, LaTeX or Typst.");
}

export function docxTable(rows: string[][]) {
  return {
    type: "table",
    content: rows.map((row) => ({
      type: "tableRow",
      content: row.map((cell) => ({
        type: "tableCell",
        content: [
          {
            type: "paragraph",
            content: cell ? [{ type: "text", text: cell }] : [],
          },
        ],
      })),
    })),
  };
}
