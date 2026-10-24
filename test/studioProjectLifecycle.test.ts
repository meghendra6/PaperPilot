import { strict as assert } from "node:assert";
import { test } from "node:test";
import { StudioProjectLifecycle } from "../src/modules/studio/projectLifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("deletion blocks pending opens and drains requests from already closed windows", async () => {
  const lifecycle = new StudioProjectLifecycle();
  const opening = deferred();
  const save = deferred();
  const events: string[] = [];
  const request = lifecycle.track("project", async () => {
    await save.promise;
    events.push("saved");
  });
  const pendingOpen = opening.promise.then(() => {
    lifecycle.assertAvailable("project");
    assert.fail("A pending open must not recreate the deleted project window.");
  });
  const deletion = lifecycle.quiesce("project", {
    pendingOpen,
    cleanup: async () => {
      events.push("cleaned");
    },
    closePendingWindow: () => {
      events.push("closed");
    },
  });
  assert.throws(
    () => lifecycle.track("project", async () => {}),
    /being deleted/,
  );
  assert.throws(() => lifecycle.assertAvailable("project"), /being deleted/);
  lifecycle.assertAvailable("other-project");
  opening.resolve();
  await tick();
  assert.deepEqual(events, ["cleaned"]);
  save.resolve();
  await Promise.all([request, deletion]);
  assert.deepEqual(events, ["cleaned", "saved", "cleaned", "closed"]);
  assert.throws(() => lifecycle.assertAvailable("project"), /being deleted/);
  lifecycle.release("project");
  lifecycle.assertAvailable("project");
});

test("dirty-window refusal restores admission without canceling work or cleaning files", async () => {
  const lifecycle = new StudioProjectLifecycle();
  lifecycle.register("project", {
    confirmClose: () => false,
    stop: async () => assert.fail("Must preserve the active window."),
    close: () => assert.fail("Must preserve unsaved changes."),
  });
  await assert.rejects(
    lifecycle.quiesce("project", {
      cleanup: async () => assert.fail("Dirty refusal must precede cleanup."),
      closePendingWindow: () => assert.fail(),
    }),
    /deletion canceled/,
  );
  lifecycle.assertAvailable("project");
});

test("failed cleanup remains blocked and concurrent deletion shares a retryable drain", async () => {
  const lifecycle = new StudioProjectLifecycle();
  const cancelled = deferred();
  const tail = deferred();
  let stopped = false;
  let cleanups = 0;
  let closes = 0;
  lifecycle.register("project", {
    confirmClose: () => true,
    stop: async () => {
      stopped = true;
      cancelled.resolve();
    },
    close: () => {
      closes++;
    },
  });
  const request = lifecycle.track("project", async () => {
    await cancelled.promise;
    await tail.promise;
  });
  const hooks = {
    cleanup: async () => {
      assert.ok(
        stopped,
        "Window must reject admitted requests before scope drain.",
      );
      cleanups++;
      if (cleanups === 1) throw new Error("termination unconfirmed");
    },
    closePendingWindow: () => {},
  };
  const first = lifecycle.quiesce("project", hooks);
  assert.equal(lifecycle.quiesce("project", hooks), first);
  await assert.rejects(first, /unconfirmed/);
  assert.throws(() => lifecycle.assertAvailable("project"), /being deleted/);
  const retry = lifecycle.quiesce("project", hooks);
  await tick();
  assert.equal(
    closes,
    0,
    "Pending persistence must settle before close/deletion.",
  );
  tail.resolve();
  await Promise.all([request, retry]);
  assert.equal(cleanups, 3);
  assert.equal(closes, 1);
});

test("final cleanup catches a process retained by an admitted request after the first scan", async () => {
  const lifecycle = new StudioProjectLifecycle();
  const scanned = deferred();
  let retained = false;
  let scans = 0;
  const request = lifecycle.track("project", async () => {
    await scanned.promise;
    retained = true;
    throw new Error("late preparation cleanup failed");
  });
  const rejected = assert.rejects(request, /late preparation/);
  const cleanup = async () => {
    scans++;
    if (retained) throw new Error("late process is still running");
    scanned.resolve();
  };
  await assert.rejects(
    lifecycle.quiesce("project", {
      cleanup,
      closePendingWindow: () =>
        assert.fail("Do not allow deletion after failed final cleanup."),
    }),
    /late process/,
  );
  await rejected;
  assert.equal(scans, 2);
  assert.throws(() => lifecycle.assertAvailable("project"), /being deleted/);
  retained = false;
  await lifecycle.quiesce("project", { cleanup, closePendingWindow: () => {} });
});

test("an old pending load cannot revive after successful deletion releases a recreated project ID", async () => {
  const lifecycle = new StudioProjectLifecycle();
  const oldLoad = lifecycle.openingGuard("project");
  await lifecycle.quiesce("project", {
    cleanup: async () => {},
    closePendingWindow: () => {},
  });
  lifecycle.release("project");
  const newLoad = lifecycle.openingGuard("project");
  assert.throws(oldLoad, /opening was canceled/);
  newLoad();
});
