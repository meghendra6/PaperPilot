import { test } from "node:test";
import * as assert from "node:assert/strict";

import { getZoteroProfilePath } from "../src/utils/zoteroProfile";

test("getZoteroProfilePath prefers Zotero 10 Profile.dir", () => {
  assert.equal(
    getZoteroProfilePath({
      Profile: { dir: "/profiles/zotero-10" },
      getProfileDirectory: () => {
        throw new Error("legacy profile getter must not be called");
      },
    }),
    "/profiles/zotero-10",
  );
});

test("getZoteroProfilePath falls back to the Zotero 7-9 profile getter", () => {
  assert.equal(
    getZoteroProfilePath({
      getProfileDirectory: () => ({ path: "/profiles/zotero-legacy" }),
    }),
    "/profiles/zotero-legacy",
  );
});
