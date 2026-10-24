import { node, type TextSurface } from "./dom";
import {
  parseDataTable,
  serializeDataTable,
  setDataCell,
  addDataColumn,
  addDataRow,
  removeDataRow,
  removeDataColumn,
} from "./dataTable";

/** Paging and sorting change the view; original row order changes only on explicit edits. */
export function dataEditor(
  host: HTMLElement,
  name: string,
  source: string,
  readOnly: boolean,
  changed: () => void,
): TextSurface {
  const data = parseDataTable(name, source);
  let modified = false;
  const invalid = new Map<string, string>();
  let page = 0;
  let sortColumn = -1;
  let ascending = true;
  const shell = node("div", undefined, "data-surface");
  const controls = node("div", undefined, "surface-controls");
  const filter = node("input");
  filter.placeholder = "Filter rows";
  filter.setAttribute("aria-label", "Filter data rows");
  const info = node("output");
  const guidance = node("p", undefined, "surface-notice");
  const table = node("table");
  const viewport = node("div", undefined, "data-viewport");
  const action = (label: string, handler: () => void) => {
    const button = node("button", label);
    button.addEventListener("click", handler);
    return button;
  };
  const previous = action("Previous rows", () => {
    page = Math.max(0, page - 1);
    render();
  });
  const next = action("Next rows", () => {
    page++;
    render();
  });
  const add = action("Add row", () => {
    addDataRow(data);
    modified = true;
    filter.value = "";
    sortColumn = -1;
    page = Math.floor((data.rows.length - 1) / 100);
    changed();
    render();
  });
  add.disabled = readOnly;
  const columnName = node("input");
  columnName.placeholder = "Column name";
  columnName.setAttribute("aria-label", "New column name");
  columnName.disabled = readOnly;
  const addColumn = action("Add column", () => {
    try {
      addDataColumn(data, columnName.value);
      columnName.value = "";
      columnName.setCustomValidity("");
      modified = true;
      changed();
      render();
    } catch (error) {
      columnName.setCustomValidity(String(error));
      columnName.reportValidity();
    }
  });
  addColumn.disabled = readOnly;
  controls.append(filter, previous, next, add, columnName, addColumn, info);
  viewport.append(table);
  shell.append(controls, guidance, viewport);
  host.append(shell);
  filter.addEventListener("input", () => {
    page = 0;
    render();
  });
  function render() {
    add.disabled = readOnly || (!data.headers.length && !data.jsonRows);
    guidance.hidden = data.headers.length > 0;
    guidance.textContent = data.jsonRows
      ? "Add a column to edit object fields. Empty objects remain visible as rows."
      : "Add a column first, then add rows to enter data.";
    let indices = data.rows
      .map((_, index) => index)
      .filter(
        (index) =>
          !filter.value ||
          data.rows[index].some((value) =>
            value
              .toLocaleLowerCase()
              .includes(filter.value.toLocaleLowerCase()),
          ),
      );
    if (sortColumn >= 0)
      indices = indices.sort(
        (a, b) =>
          (data.rows[a][sortColumn] ?? "").localeCompare(
            data.rows[b][sortColumn] ?? "",
            undefined,
            { numeric: true },
          ) * (ascending ? 1 : -1),
      );
    page = Math.min(page, Math.max(0, Math.ceil(indices.length / 100) - 1));
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 100 >= indices.length;
    info.textContent = `${indices.length} of ${data.rows.length} rows · page ${page + 1}`;
    const head = node("thead");
    const headings = node("tr");
    for (const [column, title] of data.headers.entries()) {
      const th = node("th");
      th.append(
        action(
          `${title || `Column ${column + 1}`}${sortColumn === column ? (ascending ? " ↑" : " ↓") : ""}`,
          () => {
            ascending = sortColumn === column ? !ascending : true;
            sortColumn = column;
            render();
          },
        ),
      );
      const remove = action(`Remove column ${title || column + 1}`, () => {
        removeDataColumn(data, column);
        remapInvalid(undefined, column);
        sortColumn = -1;
        modified = true;
        changed();
        render();
      });
      const lastColumnWithRows =
        !data.jsonRows && data.headers.length === 1 && data.rows.length > 0;
      remove.disabled = readOnly || lastColumnWithRows;
      if (lastColumnWithRows)
        remove.title = "Remove all rows before removing the last column.";
      th.append(remove);
      headings.append(th);
    }
    headings.append(node("th", "Row actions"));
    head.append(headings);
    const body = node("tbody");
    for (const rowIndex of indices.slice(page * 100, (page + 1) * 100)) {
      const row = node("tr");
      for (let column = 0; column < data.headers.length; column++) {
        const cell = node("td");
        const input = node("textarea");
        const key = `${rowIndex}:${column}`;
        input.value = invalid.get(key) ?? data.rows[rowIndex][column] ?? "";
        input.readOnly = readOnly;
        input.setAttribute(
          "aria-label",
          `Row ${rowIndex + 1}, ${data.headers[column] || `column ${column + 1}`}`,
        );
        input.addEventListener("input", () => {
          try {
            setDataCell(data, rowIndex, column, input.value);
            invalid.delete(key);
            input.setCustomValidity("");
          } catch (error) {
            invalid.set(key, input.value);
            input.setCustomValidity(String(error));
            input.reportValidity();
          }
          modified = true;
          changed();
        });
        cell.append(input);
        row.append(cell);
      }
      const operations = node("td");
      const remove = action(`Remove row ${rowIndex + 1}`, () => {
        removeDataRow(data, rowIndex);
        remapInvalid(rowIndex);
        modified = true;
        changed();
        render();
      });
      remove.disabled = readOnly;
      operations.append(remove);
      row.append(operations);
      body.append(row);
    }
    table.replaceChildren(head, body);
  }
  function remapInvalid(removedRow?: number, removedColumn?: number) {
    const entries = [...invalid];
    invalid.clear();
    for (const [key, value] of entries) {
      let [row, column] = key.split(":").map(Number);
      if (row === removedRow || column === removedColumn) continue;
      if (removedRow !== undefined && row > removedRow) row--;
      if (removedColumn !== undefined && column > removedColumn) column--;
      invalid.set(`${row}:${column}`, value);
    }
  }
  render();
  return {
    text: () => {
      if (invalid.size)
        throw new Error("Correct invalid JSON cells before saving.");
      return modified ? serializeDataTable(data) : source;
    },
    selectedText: () => "",
    insert: () => {
      throw new Error("Choose a data cell to edit.");
    },
    destroy: () => shell.remove(),
  };
}
