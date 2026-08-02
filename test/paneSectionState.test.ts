import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PANE_SECTION_STATE,
  parsePaneSectionState,
  serializePaneSectionState,
} from "../src/modules/ui/paneSectionState";

test("parsePaneSectionState reads a complete persisted state", () => {
  assert.deepEqual(
    parsePaneSectionState('{"workbench":false,"related":true,"sessions":true}'),
    { workbench: false, related: true, sessions: true },
  );
});

test("parsePaneSectionState falls back after damaged JSON", () => {
  assert.deepEqual(
    parsePaneSectionState("{broken"),
    DEFAULT_PANE_SECTION_STATE,
  );
});

test("parsePaneSectionState accepts a component-provided fallback", () => {
  assert.deepEqual(
    parsePaneSectionState("{broken", {
      workbench: false,
      related: true,
      sessions: true,
    }),
    { workbench: false, related: true, sessions: true },
  );
});

test("parsePaneSectionState merges partial keys with defaults", () => {
  assert.deepEqual(parsePaneSectionState('{"related":true}'), {
    workbench: true,
    related: true,
    sessions: false,
  });
});

test("parsePaneSectionState ignores non-boolean values", () => {
  assert.deepEqual(parsePaneSectionState({ workbench: "no", sessions: true }), {
    workbench: true,
    related: false,
    sessions: true,
  });
});

test("serializePaneSectionState emits stable normalized JSON", () => {
  assert.equal(
    serializePaneSectionState({
      workbench: false,
      related: true,
      sessions: false,
    }),
    '{"workbench":false,"related":true,"sessions":false}',
  );
});
