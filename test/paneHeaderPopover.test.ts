import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNativeSelectClickGuard,
  installPopoverDismissal,
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

test("native select guard keeps the popover open for every picker it owns", () => {
  const modelSelect = {} as HTMLSelectElement;
  const effortSelect = {} as HTMLSelectElement;
  const dropdownPopup = { id: "ContentSelectDropdownPopup" };
  const guard = createNativeSelectClickGuard([modelSelect, effortSelect]);

  for (const select of [modelSelect, effortSelect]) {
    guard.notePointerDown(makeEvent(dropdownPopup, [dropdownPopup]));
    assert.equal(guard.consumeClick(select), true);
  }
});

test("native select guard preserves only the click that follows a picker interaction", () => {
  const modelSelect = {} as HTMLSelectElement;
  const effortSelect = {} as HTMLSelectElement;
  const dropdownPopup = { id: "ContentSelectDropdownPopup" };
  const outside = {};
  const guard = createNativeSelectClickGuard([modelSelect, effortSelect]);

  guard.notePointerDown(makeEvent(dropdownPopup, [dropdownPopup]));
  assert.equal(guard.consumeClick(effortSelect), true);
  assert.equal(guard.consumeClick(effortSelect), false);

  guard.notePointerDown(makeEvent(outside, [outside]));
  assert.equal(guard.consumeClick(effortSelect), false);

  guard.notePointerDown(makeEvent(dropdownPopup, [dropdownPopup]));
  assert.equal(guard.consumeClick(outside as Element), false);
});

test("shared popover dismissal removes its outside-click and Escape listeners", () => {
  const listeners = new Map<string, EventListener>();
  const doc = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  } as unknown as Document;
  const root = makeRoot();
  const dismissals: boolean[] = [];
  const dispose = installPopoverDismissal({
    doc,
    getRoot: () => root,
    dismiss: (restoreFocus) => dismissals.push(restoreFocus),
  });

  listeners.get("click")?.(makeEvent({}, [{}]));
  listeners.get("keydown")?.({
    key: "Escape",
    preventDefault() {},
  } as unknown as Event);
  assert.deepEqual(dismissals, [false, true]);

  dispose();
  assert.equal(listeners.size, 0);
});
