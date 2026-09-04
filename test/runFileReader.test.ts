import { test } from "node:test";
import * as assert from "node:assert/strict";

import { readOptionalRunTextFile } from "../src/modules/ai/runFileReader";

test("run file reads distinguish absent files from unreadable files", async () => {
  const absent = await readOptionalRunTextFile("/run/missing", {
    read: () => {
      throw new Error("missing");
    },
    exists: () => false,
    log: (error) => assert.fail(String(error)),
  });
  const logged: unknown[] = [];
  const unreadable = await readOptionalRunTextFile("/run/unreadable", {
    read: () => {
      throw new Error("permission denied");
    },
    exists: () => true,
    log: (error) => logged.push(error),
  });

  assert.equal(absent, "");
  assert.equal(unreadable, undefined);
  assert.equal(logged.length, 1);
});
