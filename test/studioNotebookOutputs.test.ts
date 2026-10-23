import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NotebookOutputs } from "../src/modules/studio/notebookOutputs";
import { newCell } from "../src/modules/studio/notebook";

test("Jupyter display handles update prior cells without entering persisted nbformat", () => {
  const state = new NotebookOutputs();
  const first = newCell("code", "one"),
    second = newCell("code", "two");
  state.apply(first, [first, second], {
    status: "ok",
    execution_count: 1,
    outputs: [
      {
        output_type: "display_data",
        data: { "text/plain": "before" },
        metadata: {},
      },
    ],
    displayIDs: { "0": "handle" },
  });
  const update = {
    status: "ok" as const,
    execution_count: 2,
    outputs: [],
    displayUpdates: [
      { displayID: "handle", data: { "text/plain": "after" }, metadata: {} },
    ],
  };
  first.metadata.paperpilotExecution = { id: "prior-execution" };
  state.apply(second, [first, second], update);
  assert.equal(first.metadata.paperpilotExecution, undefined);
  assert.equal(first.outputs?.[0].data["text/plain"], "after");
  assert(!JSON.stringify(first).includes("handle"));
  state.clear();
  state.apply(second, [first, second], {
    ...update,
    displayUpdates: [
      {
        displayID: "handle",
        data: { "text/plain": "unrelated kernel" },
        metadata: {},
      },
    ],
  });
  assert.equal(first.outputs?.[0].data["text/plain"], "after");
});
