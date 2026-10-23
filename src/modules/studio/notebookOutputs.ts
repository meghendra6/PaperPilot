import type { KernelResult } from "./kernelBroker";
import type { NotebookCell } from "./notebook";

/** Display handles live only for this editor/kernel session, never in exported nbformat. */
export class NotebookOutputs {
  private handles = new Map<NotebookCell, Record<string, string>>();
  clear() {
    this.handles.clear();
  }
  apply(cell: NotebookCell, cells: NotebookCell[], result: KernelResult) {
    this.handles.delete(cell);
    for (const previous of this.handles.keys())
      if (!cells.includes(previous)) this.handles.delete(previous);
    for (const update of result.displayUpdates ?? []) {
      for (const [previous, ids] of this.handles) {
        for (const [index, id] of Object.entries(ids)) {
          const output = previous.outputs?.[Number(index)];
          if (
            id === update.displayID &&
            output &&
            ["display_data", "execute_result"].includes(output.output_type)
          ) {
            output.data = update.data;
            output.metadata = update.metadata;
            // An update from another cell is not produced solely by the old
            // cell's code. Retire that receipt instead of asserting false lineage.
            delete previous.metadata.paperpilotExecution;
          }
        }
      }
    }
    cell.outputs = result.outputs;
    cell.execution_count = result.execution_count;
    this.handles.set(cell, result.displayIDs ?? {});
  }
}
