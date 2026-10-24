import { test } from "node:test";
import * as assert from "node:assert/strict";

import { runResearchWorkspaceSurfaceAction } from "../src/modules/researchWorkspace/surfaceAction";

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

test("Research Workspace surface actions name the running action to a second click", async () => {
  const surface = new FakeSurface();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = runResearchWorkspaceSurfaceAction({
    surface,
    trigger: { disabled: false },
    label: "Open LLM evaluation review",
    action: () => waiting,
    onError: (error) => assert.fail(String(error)),
  });
  const busy: (string | undefined)[] = [];

  assert.equal(
    await runResearchWorkspaceSurfaceAction({
      surface,
      trigger: { disabled: false },
      label: "Open Studio for LLM evaluation review",
      action: () => assert.fail("the second action must not run"),
      onError: (error) => assert.fail(String(error)),
      onBusy: (active) => busy.push(active),
    }),
    false,
  );
  assert.deepEqual(busy, ["Open LLM evaluation review"]);

  release();
  assert.equal(await first, true);
  let ran = false;
  assert.equal(
    await runResearchWorkspaceSurfaceAction({
      surface,
      trigger: { disabled: false },
      action: () => {
        ran = true;
      },
      onError: (error) => assert.fail(String(error)),
      onBusy: () => assert.fail("the surface is idle again"),
    }),
    true,
  );
  assert.equal(ran, true);
});
