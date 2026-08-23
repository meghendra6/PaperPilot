import { test } from "node:test";
import * as assert from "node:assert/strict";
import { findNearbyContext } from "../src/modules/context/nearbyContext";

test("findNearbyContext returns text before and after the selection", () => {
  const nearby = findNearbyContext({
    fullText: "Introduction. The selected claim is here. Discussion follows.",
    selectedText: "The selected claim is here.",
    radius: 100,
  });

  assert.equal(
    nearby,
    "Before selection: Introduction.\nAfter selection: Discussion follows.",
  );
});

test("findNearbyContext matches selection across whitespace differences", () => {
  assert.equal(
    findNearbyContext({
      fullText: "Before\nThe   selected\tclaim\nAfter",
      selectedText: "The selected claim",
      radius: 100,
    }),
    "Before selection: Before\nAfter selection: After",
  );
});

test("findNearbyContext returns the available side at a document boundary", () => {
  assert.equal(
    findNearbyContext({
      fullText: "Selected text. The remainder.",
      selectedText: "Selected text.",
      radius: 100,
    }),
    "After selection: The remainder.",
  );
});

test("findNearbyContext returns undefined when the selection is absent", () => {
  assert.equal(
    findNearbyContext({
      fullText: "A different paper body.",
      selectedText: "Missing selection",
    }),
    undefined,
  );
});

test("findNearbyContext never repeats the selected text", () => {
  const selectedText = "unique selected passage";
  const nearby = findNearbyContext({
    fullText: `before ${selectedText} after`,
    selectedText,
    radius: 100,
  });

  assert.doesNotMatch(nearby || "", /unique selected passage/);
});
