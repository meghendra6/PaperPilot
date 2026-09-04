import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  fnv1a32,
  normalizeIdentityAuthor,
  normalizeIdentityDOI,
  normalizeIdentityTitle,
  stableHash,
} from "../src/modules/researchWorkspace/identity";

test("Research Workspace identity normalization is shared and Unicode-safe", () => {
  assert.equal(
    normalizeIdentityDOI(" https://doi.org/10.1000/ABC. "),
    "10.1000/abc",
  );
  assert.equal(normalizeIdentityTitle("Ｃａｆé—연구"), "café 연구");
  assert.equal(normalizeIdentityAuthor("Ada Lovelace"), "lovelace");
});

test("Research Workspace FNV-1a helpers preserve stable fingerprints", () => {
  assert.equal(stableHash("Paper Pilot"), "97648037");
  assert.equal(fnv1a32("Paper Pilot"), Number.parseInt("97648037", 16));
  assert.notEqual(
    stableHash("Paper Pilot", 2246822519),
    stableHash("Paper Pilot"),
  );
});
