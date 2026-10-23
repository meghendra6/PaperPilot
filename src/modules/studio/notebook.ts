export interface NotebookCell {
  cell_type: string;
  id?: string;
  metadata: Record<string, unknown>;
  source: string | string[];
  outputs?: Array<Record<string, any>>;
  execution_count?: number | null;
  [key: string]: unknown;
}

export interface Notebook {
  nbformat: 4;
  nbformat_minor: number;
  metadata: Record<string, any>;
  cells: NotebookCell[];
  [key: string]: unknown;
}

export function notebookText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string"))
    return value.join("");
  throw new Error("Notebook text must be a string or an array of strings.");
}

export function parseNotebook(source: string): Notebook {
  const notebook = JSON.parse(source);
  if (
    notebook?.nbformat !== 4 ||
    !Number.isInteger(notebook.nbformat_minor) ||
    !notebook.metadata ||
    !Array.isArray(notebook.cells)
  )
    throw new Error(
      "This notebook format is unsupported. Use source view to preserve it.",
    );
  for (const cell of notebook.cells) {
    if (
      !cell ||
      typeof cell.cell_type !== "string" ||
      !cell.metadata ||
      typeof cell.metadata !== "object"
    )
      throw new Error("Invalid notebook cell.");
    notebookText(cell.source);
    if (
      cell.cell_type === "code" &&
      (!Array.isArray(cell.outputs) ||
        !(
          cell.execution_count === null ||
          Number.isInteger(cell.execution_count)
        ))
    )
      throw new Error("Invalid notebook code cell.");
  }
  return notebook;
}

export function newNotebook(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
        language: "python",
      },
      language_info: { name: "python" },
    },
    cells: [],
  };
}

export function newCell(type: "code" | "markdown", id: string): NotebookCell {
  return {
    id,
    cell_type: type,
    metadata: {},
    source: "",
    ...(type === "code" ? { outputs: [], execution_count: null } : {}),
  };
}
