import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolveOpenDataLoaderJarPath } from "../src/modules/tools/paperWorkspaceContent";

test("resolveOpenDataLoaderJarPath falls back to node_modules for file roots", async () => {
  const resolved = await resolveOpenDataLoaderJarPath({
    rootUri: "file:///tmp/project/build/addon/",
    exists: async (candidate) =>
      candidate ===
      "/tmp/project/node_modules/@opendataloader/pdf/lib/opendataloader-pdf-cli.jar",
  });

  assert.equal(
    resolved,
    "/tmp/project/node_modules/@opendataloader/pdf/lib/opendataloader-pdf-cli.jar",
  );
});
