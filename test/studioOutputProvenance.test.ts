import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KernelBroker } from "../src/modules/studio/kernelBroker";
import {
  assertOutputOrigin,
  notebookOutputHash,
  outputFreshness,
  type OutputOrigin,
} from "../src/modules/studio/outputProvenance";
import { newCell, newNotebook } from "../src/modules/studio/notebook";
import type { StudioManifest } from "../src/modules/studio/contracts";

export const outputOrigin: OutputOrigin = {
  execution: {
    schemaVersion: 1,
    id: "execution",
    sessionID: "session",
    notebookID: "notebook",
    kernel: "python3",
    code: "print(42)",
    startedAt: "2026-10-23T00:00:00Z",
    completedAt: "2026-10-23T00:00:01Z",
    inputs: [
      { id: "data", name: "data.csv", revision: 1, sha256: "a".repeat(64) },
    ],
  },
  cellID: "cell",
  outputIndex: 0,
  outputHash: "b".repeat(64),
};

test("output provenance distinguishes reruns, edited source, changed outputs and captured inputs", () => {
  const notebook = newNotebook();
  const cell = newCell("code", "cell");
  cell.source = "print(42)";
  cell.metadata.paperpilotExecution = { ...outputOrigin.execution };
  notebook.cells.push(cell);
  const manifest = {
    documents: [
      { id: "notebook", archived: false },
      {
        id: "data",
        name: "data.csv",
        archived: false,
        versions: [{ sha256: "a".repeat(64) }],
      },
    ],
  } as StudioManifest;
  assert.deepEqual(
    outputFreshness(outputOrigin, manifest, notebook, outputOrigin.outputHash),
    [],
  );
  (cell.metadata.paperpilotExecution as { id: string }).id = "rerun";
  assert.match(
    outputFreshness(
      outputOrigin,
      manifest,
      notebook,
      outputOrigin.outputHash,
    ).join(),
    /rerun/,
  );
  cell.source = "print(43)";
  assert.match(
    outputFreshness(
      outputOrigin,
      manifest,
      notebook,
      outputOrigin.outputHash,
    ).join(),
    /Source code changed/,
  );
  assert.match(
    outputFreshness(outputOrigin, manifest, notebook, "c".repeat(64)).join(),
    /Source output changed/,
  );
  manifest.documents[1].name = "renamed.csv";
  assert.match(
    outputFreshness(outputOrigin, manifest, notebook).join(),
    /Captured input changed/,
  );
});

test("malformed provenance is rejected and output fingerprints reflect actual values", async () => {
  assertOutputOrigin(outputOrigin);
  assert.throws(
    () => assertOutputOrigin({ ...outputOrigin, outputIndex: -1 }),
    /origin/,
  );
  assert.throws(
    () =>
      assertOutputOrigin({
        ...outputOrigin,
        execution: {
          ...outputOrigin.execution,
          inputs: [{ ...outputOrigin.execution.inputs[0], name: "../outside" }],
        },
      }),
    /relative/,
  );
  assert.notEqual(
    await notebookOutputHash({ data: { "text/plain": "42" } }),
    await notebookOutputHash({ data: { "text/plain": "43" } }),
  );
});

test("persistent kernel receipts retain the initial input snapshot and distinguish each execution", async () => {
  const disk = new Map<string, string>();
  let id = 0;
  const broker = new KernelBroker({
    id: () => `run-${++id}`,
    delay: async () => {},
    createJob: async () => {
      disk.set(
        "/owned/inputs.json",
        JSON.stringify(outputOrigin.execution.inputs),
      );
      disk.set("/owned/ready.json", '{"ok":true}');
      return "/owned";
    },
    read: async (path) => disk.get(path),
    write: async (path, text) => {
      disk.set(path, text);
      if (path.endsWith("request.json")) {
        const request = JSON.parse(text);
        disk.set(
          `/owned/response-${request.id}.json`,
          JSON.stringify({ status: "ok", execution_count: id, outputs: [] }),
        );
      }
    },
    launch: async () => {},
    kill: async () => {},
  });
  try {
    const first = await broker.execute("notebook", "python3", "x = 42");
    disk.set("/owned/inputs.json", "[]");
    const second = await broker.execute("notebook", "python3", "print(x)");
    assert.notEqual(first.execution?.id, second.execution?.id);
    assert.equal(first.execution?.sessionID, second.execution?.sessionID);
    assert.deepEqual(second.execution?.inputs, outputOrigin.execution.inputs);
    assert.equal(second.execution?.code, "print(x)");
  } finally {
    await broker.close();
  }
});

test("Stop during kernel startup cancels the pending cell without poisoning the next run", async () => {
  const disk = new Map<string, string>();
  let id = 0;
  let submitted = 0;
  let finishStartup!: () => void;
  const startup = new Promise<void>((resolve) => {
    finishStartup = resolve;
  });
  const broker = new KernelBroker({
    id: () => `run-${++id}`,
    delay: async () => {},
    createJob: async () => {
      await startup;
      disk.set("/owned/ready.json", '{"ok":true}');
      return "/owned";
    },
    read: async (path) => disk.get(path),
    write: async (path, text) => {
      disk.set(path, text);
      if (path.endsWith("request.json")) {
        submitted++;
        const request = JSON.parse(text);
        disk.set(
          `/owned/response-${request.id}.json`,
          JSON.stringify({ status: "ok", execution_count: 1, outputs: [] }),
        );
      }
    },
    launch: async () => {},
    kill: async () => {},
  });
  try {
    const pending = broker.execute("notebook", "python3", "never_run()");
    await broker.interrupt("notebook");
    finishStartup();
    await assert.rejects(pending, /canceled before it started/);
    assert.equal(submitted, 0);
    assert.equal(disk.has("/owned/interrupt"), false);
    const next = await broker.execute("notebook", "python3", "print(42)");
    assert.equal(next.status, "ok");
    assert.equal(submitted, 1);
    assert.equal(next.execution?.code, "print(42)");
  } finally {
    finishStartup();
    await broker.close();
  }
});

test("Stop targets the admitted request ID even while its request file is being published", async () => {
  const disk = new Map([["/owned/ready.json", '{"ok":true}']]);
  let id = 0;
  const broker = new KernelBroker({
    id: () => `run-${++id}`,
    delay: async () => {},
    createJob: async () => "/owned",
    read: async (path) => disk.get(path),
    write: async (path, text) => {
      disk.set(path, text);
      if (path.endsWith("request.json")) {
        const request = JSON.parse(text);
        await broker.interrupt("notebook");
        assert.deepEqual(JSON.parse(disk.get("/owned/interrupt") ?? "null"), {
          id: request.id,
        });
        disk.set(
          `/owned/response-${request.id}.json`,
          JSON.stringify({
            status: "error",
            execution_count: null,
            outputs: [],
          }),
        );
      }
    },
    launch: async () => {},
    kill: async () => {},
  });
  try {
    assert.equal(
      (await broker.execute("notebook", "python3", "print(42)")).status,
      "error",
    );
    disk.delete("/owned/interrupt");
    await broker.interrupt("notebook");
    assert.equal(disk.has("/owned/interrupt"), false);
  } finally {
    await broker.close();
  }
});
