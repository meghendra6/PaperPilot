import { node, type TextSurface } from "./dom";
import { sourceEditor, renderMarkdown } from "./sourceEditor";
import {
  newCell,
  notebookText,
  parseNotebook,
  type NotebookCell,
} from "./notebook";
import type { KernelResult } from "./kernelBroker";
import { NotebookOutputs } from "./notebookOutputs";
import {
  notebookOutputHash,
  type ExecutionReceipt,
  type OutputOrigin,
} from "./outputProvenance";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- DOMPurify uses export= with this repository's CommonJS type settings.
import DOMPurify = require("dompurify");
import * as Papa from "papaparse";

export interface NotebookActions {
  execute(kernel: "python3" | "ir", code: string): Promise<KernelResult>;
  interrupt(): Promise<unknown>;
  restart(): Promise<unknown>;
  createFile(
    name: string,
    base64: string,
    origin?: OutputOrigin,
  ): Promise<unknown>;
}

export function notebookEditor(
  host: HTMLElement,
  source: string,
  readOnly: boolean,
  changed: () => void,
  actions: NotebookActions,
): TextSurface {
  const notebook = parseNotebook(source);
  const outputState = new NotebookOutputs();
  const shell = node("div", undefined, "notebook-surface");
  const controls = node("div", undefined, "surface-controls");
  const cells = node("div", undefined, "notebook-cells");
  const status = node("output", "Idle · code runs only when requested");
  status.setAttribute("aria-live", "polite");
  const kernel = node("select");
  kernel.setAttribute("aria-label", "Notebook kernel");
  for (const [value, label] of [
    ["python3", "Python 3"],
    ["ir", "R"],
  ]) {
    const option = node("option", label);
    option.value = value;
    kernel.append(option);
  }
  kernel.value = notebook.metadata.kernelspec?.name === "ir" ? "ir" : "python3";
  kernel.disabled = readOnly;
  kernel.addEventListener("change", () => {
    notebook.metadata.kernelspec = {
      name: kernel.value,
      display_name: kernel.value === "ir" ? "R" : "Python 3",
      language: kernel.value === "ir" ? "R" : "python",
    };
    notebook.metadata.language_info = {
      name: kernel.value === "ir" ? "R" : "python",
    };
    changed();
    render();
  });
  const views = new Map<
    NotebookCell,
    { view: TextSurface; input: HTMLElement; language: string }
  >();
  let busy = false;
  let stop = false;
  let alive = true;
  const fail = (error: unknown) => {
    status.textContent = String(error);
  };
  const button = (label: string, action: () => void | Promise<unknown>) => {
    const item = node("button", label);
    item.addEventListener("click", () => {
      void Promise.resolve().then(action).catch(fail);
    });
    return item;
  };
  async function run(selected: NotebookCell[]) {
    if (busy || readOnly) return;
    busy = true;
    stop = false;
    render();
    try {
      for (const cell of selected) {
        if (stop || !alive) break;
        if (cell.cell_type !== "code") continue;
        cell.id ??= crypto.randomUUID();
        status.textContent = "Running locally…";
        const result = await actions.execute(
          kernel.value as "python3" | "ir",
          notebookText(cell.source),
        );
        if (!alive) break;
        outputState.apply(cell, notebook.cells, result);
        if (result.execution)
          cell.metadata.paperpilotExecution = result.execution;
        else delete cell.metadata.paperpilotExecution;
        changed();
        status.textContent =
          result.status === "ok"
            ? "Execution completed"
            : "Execution failed — see cell output";
        if (result.status !== "ok") break;
      }
    } finally {
      busy = false;
      if (alive) render();
    }
  }
  const runAll = button("Run all", () => run([...notebook.cells]));
  const interrupt = button("Stop", async () => {
    stop = true;
    await actions.interrupt();
  });
  const restart = button("Restart kernel", async () => {
    stop = true;
    await actions.restart();
    outputState.clear();
    status.textContent = "Kernel stopped. The next run starts fresh.";
  });
  const addCode = button("+ Code", () => {
    notebook.cells.push(newCell("code", crypto.randomUUID()));
    changed();
    render();
  });
  const addMarkdown = button("+ Markdown", () => {
    notebook.cells.push(newCell("markdown", crypto.randomUUID()));
    changed();
    render();
  });
  controls.append(
    kernel,
    runAll,
    interrupt,
    restart,
    addCode,
    addMarkdown,
    status,
  );
  shell.append(
    controls,
    node(
      "p",
      "Runs local code with your account permissions. Install notebook packages in the configured Python environment; use %pip for Python or install.packages() for R.",
      "surface-notice",
    ),
    cells,
  );
  host.append(shell);

  function render() {
    for (const [cell, entry] of views) {
      if (!notebook.cells.includes(cell)) {
        entry.view.destroy();
        views.delete(cell);
      }
    }
    cells.replaceChildren();
    for (const item of [kernel, runAll, addCode, addMarkdown])
      item.disabled = readOnly || busy;
    interrupt.disabled = !busy;
    restart.disabled = readOnly;
    for (const [index, cell] of notebook.cells.entries()) {
      const section = node("section", undefined, "notebook-cell");
      section.setAttribute("aria-label", `Notebook cell ${index + 1}`);
      const bar = node("div", undefined, "surface-controls");
      bar.append(
        node("span", `${cell.cell_type} [${cell.execution_count ?? " "}]`),
      );
      if (cell.cell_type === "code") {
        const runCell = button("Run cell", () => run([cell]));
        runCell.disabled = readOnly || busy;
        bar.append(runCell);
      }
      const up = button("Move up", () => {
        [notebook.cells[index - 1], notebook.cells[index]] = [
          cell,
          notebook.cells[index - 1],
        ];
        changed();
        render();
      });
      const remove = button("Remove cell", () => {
        notebook.cells.splice(index, 1);
        changed();
        render();
      });
      up.disabled = index === 0 || readOnly || busy;
      remove.disabled = readOnly || busy || cell.metadata.deletable === false;
      bar.append(up, remove);
      const language =
        cell.cell_type === "markdown"
          ? "cell.md"
          : kernel.value === "ir"
            ? "cell.r"
            : "cell.py";
      let entry = views.get(cell);
      if (entry && entry.language !== language) {
        entry.view.destroy();
        entry = undefined;
      }
      if (!entry) {
        const input = node("div", undefined, "cell-source");
        const view = sourceEditor(
          input,
          language,
          notebookText(cell.source),
          readOnly || cell.metadata.editable === false,
          () => {
            cell.source = view.text();
            changed();
          },
        );
        entry = { view, input, language };
        views.set(cell, entry);
      }
      // Keep the CodeMirror instance and undo stack when execution/output changes.
      entry.input.inert = busy;
      section.append(bar, entry.input);
      if (cell.cell_type === "markdown") {
        const preview = node("article", undefined, "markdown-preview");
        renderMarkdown(preview, notebookText(cell.source));
        section.append(preview);
      }
      for (const [outputIndex, output] of (cell.outputs ?? []).entries()) {
        const origin = async (): Promise<OutputOrigin | undefined> => {
          const execution = cell.metadata.paperpilotExecution as
            | ExecutionReceipt
            | undefined;
          if (!execution || !cell.id) return undefined;
          return {
            execution,
            cellID: cell.id,
            outputIndex,
            outputHash: await notebookOutputHash(output),
          };
        };
        const rendered = node("div", undefined, "cell-output");
        if (output.output_type === "stream")
          rendered.append(node("pre", notebookText(output.text)));
        else if (output.output_type === "error")
          rendered.append(
            node(
              "pre",
              `${output.ename}: ${output.evalue}\n${stripTerminalEscapes((output.traceback ?? []).join("\n"))}`,
            ),
          );
        else if (output.data?.["image/png"]) {
          const base64 = notebookText(output.data["image/png"]).replace(
            /\s/g,
            "",
          );
          const image = node("img");
          image.src = `data:image/png;base64,${base64}`;
          image.alt = `Output of cell ${index + 1}`;
          rendered.append(
            image,
            button("Save figure to project", async () => {
              await actions.createFile(
                `figures/cell-${index + 1}-${outputIndex + 1}-${Date.now()}.png`,
                base64,
                await origin(),
              );
              status.textContent = "Figure saved to project files.";
            }),
          );
        } else if (output.data?.["text/html"]) {
          const html = notebookText(output.data["text/html"]);
          if (html.length > 500000)
            rendered.append(
              node(
                "pre",
                "HTML output is too large to preview. The original output remains in the notebook.",
              ),
            );
          else {
            const fragment = DOMPurify.sanitize(html, {
              RETURN_DOM_FRAGMENT: true,
              ALLOWED_TAGS: [
                "table",
                "thead",
                "tbody",
                "tfoot",
                "tr",
                "td",
                "th",
              ],
              ALLOWED_ATTR: ["rowspan", "colspan"],
            });
            const tables = Array.from(
              fragment.querySelectorAll("table"),
            ) as HTMLTableElement[];
            tables.forEach((table, tableIndex) => {
              rendered.append(
                button(`Save table ${tableIndex + 1} to project`, async () => {
                  if (table.querySelector("table"))
                    throw new Error(
                      "Nested tables cannot be exported as a rectangular CSV.",
                    );
                  const rows = (
                    Array.from(table.rows) as HTMLTableRowElement[]
                  ).map((row) =>
                    (Array.from(row.cells) as HTMLTableCellElement[]).map(
                      (cell) => {
                        if (cell.colSpan !== 1 || cell.rowSpan !== 1)
                          throw new Error(
                            "Merged cells cannot be exported as a rectangular CSV.",
                          );
                        return cell.textContent ?? "";
                      },
                    ),
                  );
                  if (
                    !rows.length ||
                    rows.length > 1000 ||
                    rows[0].length > 100 ||
                    rows.some((row) => row.length !== rows[0].length)
                  )
                    throw new Error(
                      "Choose a rectangular table with at most 1,000 rows and 100 columns.",
                    );
                  const bytes = new TextEncoder().encode(Papa.unparse(rows));
                  let binary = "";
                  for (let offset = 0; offset < bytes.length; offset += 32768)
                    binary += String.fromCharCode(
                      ...bytes.subarray(offset, offset + 32768),
                    );
                  await actions.createFile(
                    `tables/cell-${index + 1}-${outputIndex + 1}-${tableIndex + 1}-${Date.now()}.csv`,
                    btoa(binary),
                    await origin(),
                  );
                  status.textContent =
                    "Table saved to project. Open a draft and choose Insert project output.";
                }),
              );
            });
            rendered.append(fragment);
          }
        } else if (output.data?.["text/markdown"])
          renderMarkdown(rendered, notebookText(output.data["text/markdown"]));
        else if (output.data?.["text/plain"])
          rendered.append(node("pre", notebookText(output.data["text/plain"])));
        else
          rendered.append(
            node("pre", JSON.stringify(output.data ?? output, null, 2)),
          );
        section.append(rendered);
      }
      cells.append(section);
    }
  }
  render();
  return {
    text: () => JSON.stringify(notebook, null, 2) + "\n",
    selectedText: () =>
      [...views.values()]
        .map(({ view }) => view.selectedText())
        .filter(Boolean)
        .join("\n"),
    insert: () => {
      throw new Error("Choose a notebook cell to edit.");
    },
    canNavigate: () => !busy,
    destroy: () => {
      alive = false;
      stop = true;
      for (const { view } of views.values()) view.destroy();
      views.clear();
      shell.remove();
    },
  };
}

function stripTerminalEscapes(value: string) {
  // eslint-disable-next-line no-control-regex -- Jupyter tracebacks contain ANSI color escapes.
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
