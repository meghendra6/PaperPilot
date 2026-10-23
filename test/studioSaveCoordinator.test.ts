import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SaveCoordinator } from "../src/modules/studio/saveCoordinator";

test("concurrent save and navigation waiters share a drain, including edits made during a write", async () => {
  let revision = 1;
  let saved = 0;
  let calls = 0;
  let release!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new SaveCoordinator(
    () => revision !== saved,
    async () => {
      const captured = revision;
      if (++calls === 1) await firstWrite;
      saved = captured;
    },
  );
  const first = coordinator.save();
  await Promise.resolve();
  const navigation = coordinator.save();
  const explicit = coordinator.save();
  assert.equal(first, navigation);
  assert.equal(first, explicit);
  revision = 2;
  release();
  await Promise.all([first, navigation, explicit]);
  assert.equal(saved, 2);
  assert.equal(calls, 2);
  assert.equal(coordinator.pending, false);
});

test("a failed save rejects every waiter, keeps the draft dirty, and permits retry", async () => {
  let saved = false;
  let fail = true;
  const coordinator = new SaveCoordinator(
    () => !saved,
    async () => {
      if (fail) throw new Error("disk full");
      saved = true;
    },
  );
  const results = await Promise.allSettled([
    coordinator.save(),
    coordinator.save(),
  ]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(saved, false);
  assert.equal(coordinator.pending, false);
  fail = false;
  await coordinator.save();
  assert.equal(saved, true);
});
