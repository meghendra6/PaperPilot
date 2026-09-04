import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  replaceResearchWorkspaceDialogAfterCreate,
  runResearchWorkspaceSurfaceAction,
} from "../src/modules/researchWorkspace/surfaceAction";

class FakeSurface {
  readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

test("Research Workspace surface actions reject overlap and restore busy state", async () => {
  const surface = new FakeSurface();
  const trigger = { disabled: false };
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const first = runResearchWorkspaceSurfaceAction({
    surface,
    trigger,
    action: async () => {
      calls += 1;
      await waiting;
    },
    onError: (error) => assert.fail(String(error)),
  });

  assert.equal(trigger.disabled, true);
  assert.equal(surface.attributes.get("aria-busy"), "true");
  assert.equal(
    await runResearchWorkspaceSurfaceAction({
      surface,
      trigger,
      action: () => {
        calls += 1;
      },
      onError: (error) => assert.fail(String(error)),
    }),
    false,
  );
  assert.equal(calls, 1);

  release();
  assert.equal(await first, true);
  assert.equal(trigger.disabled, false);
  assert.equal(surface.attributes.has("aria-busy"), false);
});

test("Research Workspace surface actions report failures and restore state", async () => {
  const surface = new FakeSurface();
  const trigger = { disabled: false };
  const failure = new Error("injected action failure");
  let reported: unknown;

  assert.equal(
    await runResearchWorkspaceSurfaceAction({
      surface,
      trigger,
      action: () => {
        throw failure;
      },
      onError: (error) => {
        reported = error;
      },
    }),
    false,
  );
  assert.equal(reported, failure);
  assert.equal(trigger.disabled, false);
  assert.equal(surface.attributes.has("aria-busy"), false);
});

test("Research Workspace dialog replacement closes the old window only after creation", async () => {
  let closed = false;
  const current = {
    window: {
      close: () => {
        closed = true;
      },
    },
  };
  const replacement = { window: { close: () => undefined } };

  assert.equal(
    await replaceResearchWorkspaceDialogAfterCreate(
      current,
      async () => replacement,
    ),
    replacement,
  );
  assert.equal(closed, true);

  closed = false;
  await assert.rejects(
    replaceResearchWorkspaceDialogAfterCreate(current, async () => {
      throw new Error("capture failed");
    }),
    /capture failed/,
  );
  assert.equal(closed, false);
});
