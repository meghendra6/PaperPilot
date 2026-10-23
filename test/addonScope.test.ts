import { test } from "node:test";
import * as assert from "node:assert/strict";
import { getAddonRootURI, logWithToolkit } from "../src/utils/addonScope";
import { createGlobalStateRestorer } from "./helpers/globalState";

test("getAddonRootURI reads bootstrap's loader scope, not the sandbox global", () => {
  const restore = createGlobalStateRestorer(["_globalThis", "rootURI"]);
  try {
    delete (globalThis as Record<string, unknown>)._globalThis;
    (globalThis as Record<string, unknown>).rootURI = "file:///sandbox/";
    assert.equal(getAddonRootURI(), "");
    (globalThis as Record<string, unknown>)._globalThis = {
      rootURI: "jar:file:///profile/extensions/paperpilot.xpi!/",
    };
    assert.equal(
      getAddonRootURI(),
      "jar:file:///profile/extensions/paperpilot.xpi!/",
    );
  } finally {
    restore();
  }
});

test("logWithToolkit uses the loader-scope toolkit and is a no-op before it exists", () => {
  const restore = createGlobalStateRestorer(["_globalThis"]);
  try {
    delete (globalThis as Record<string, unknown>)._globalThis;
    assert.doesNotThrow(() => logWithToolkit("message"));
    const logged: unknown[][] = [];
    (globalThis as Record<string, unknown>)._globalThis = {
      ztoolkit: { log: (...values: unknown[]) => logged.push(values) },
    };
    logWithToolkit("message", 1);
    assert.deepEqual(logged, [["message", 1]]);
  } finally {
    restore();
  }
});
