import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  isNativeSelectInteraction,
  shouldDismissPopover,
} from "../src/modules/ui/popoverDismissal";

function makeRoot(...containedNodes: object[]) {
  return {
    contains(node: object) {
      return containedNodes.includes(node);
    },
  } as unknown as HTMLElement;
}

function makeEvent(target: object, path: object[]) {
  return {
    target,
    composedPath: () => path,
  } as unknown as Event;
}

test("pane header popover stays open for native model-picker interactions", () => {
  const rootPathEntry = {};
  const modelSelect = {};
  const nativePopupOption = {};
  const root = makeRoot(modelSelect);

  assert.equal(
    shouldDismissPopover(
      root,
      makeEvent(nativePopupOption, [nativePopupOption, rootPathEntry, root]),
    ),
    false,
  );
  assert.equal(
    shouldDismissPopover(root, makeEvent(modelSelect, [modelSelect])),
    false,
  );
});

test("pane header popover dismisses an outside click", () => {
  const outside = {};
  const root = makeRoot();
  assert.equal(shouldDismissPopover(root, makeEvent(outside, [outside])), true);
});

test("native model select interactions include Zotero's dropdown popup", () => {
  const modelSelect = {};
  const dropdownPopup = { id: "ContentSelectDropdownPopup" };
  const outside = {};

  assert.equal(
    isNativeSelectInteraction(
      modelSelect as HTMLSelectElement,
      makeEvent(modelSelect, [modelSelect]),
    ),
    true,
  );
  assert.equal(
    isNativeSelectInteraction(
      modelSelect as HTMLSelectElement,
      makeEvent(dropdownPopup, [dropdownPopup]),
    ),
    true,
  );
  assert.equal(
    isNativeSelectInteraction(
      modelSelect as HTMLSelectElement,
      makeEvent(outside, [outside]),
    ),
    false,
  );
});
