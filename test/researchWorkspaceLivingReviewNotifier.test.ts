import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  createResearchWorkspaceLivingReviewNotifier,
  type ResearchWorkspaceLivingReviewNotifierObserver,
} from "../src/modules/researchWorkspace/livingReviewNotifier";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeNotifier {
  registrations: Array<{
    observer: ResearchWorkspaceLivingReviewNotifierObserver;
    types: string[];
    observerID: string;
    handle: string;
  }> = [];
  unregistered: string[] = [];

  registerObserver(
    observer: ResearchWorkspaceLivingReviewNotifierObserver,
    types: string[],
    observerID: string,
  ) {
    const handle = `observer-${this.registrations.length + 1}`;
    this.registrations.push({ observer, types, observerID, handle });
    return handle;
  }

  unregisterObserver(handle: string) {
    this.unregistered.push(handle);
  }

  emit() {
    this.registrations
      .at(-1)
      ?.observer.notify("modify", "item", [101, "ITEM-KEY"], {
        101: { changed: true },
      });
  }
}

test("living-review notifier registers once and unregisters the exact handle", async () => {
  const zoteroNotifier = new FakeNotifier();
  let scans = 0;
  const livingReview = createResearchWorkspaceLivingReviewNotifier({
    notifier: zoteroNotifier,
    scanAllActiveProjects: async () => {
      scans += 1;
    },
  });

  livingReview.start();
  livingReview.start();

  assert.equal(zoteroNotifier.registrations.length, 1);
  assert.deepEqual(zoteroNotifier.registrations[0]?.types, ["item"]);
  assert.equal(
    zoteroNotifier.registrations[0]?.observerID,
    "paperpilot-living-review",
  );

  livingReview.stop();
  livingReview.stop();
  livingReview.start();
  zoteroNotifier.emit();
  await livingReview.flushForTests();

  assert.deepEqual(zoteroNotifier.unregistered, ["observer-1"]);
  assert.equal(zoteroNotifier.registrations.length, 1);
  assert.equal(scans, 0);
});

test("bursts are coalesced and an in-flight burst produces one serialized trailing scan", async () => {
  const zoteroNotifier = new FakeNotifier();
  const scans: Deferred[] = [];
  let active = 0;
  let maximumActive = 0;
  const livingReview = createResearchWorkspaceLivingReviewNotifier({
    notifier: zoteroNotifier,
    scanAllActiveProjects: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const current = deferred();
      scans.push(current);
      try {
        await current.promise;
      } finally {
        active -= 1;
      }
    },
  });
  livingReview.start();

  for (let index = 0; index < 20; index += 1) zoteroNotifier.emit();
  assert.equal(
    scans.length,
    0,
    "the observer callback must return before scanning",
  );
  await Promise.resolve();
  assert.equal(scans.length, 1);

  for (let index = 0; index < 20; index += 1) zoteroNotifier.emit();
  assert.equal(scans.length, 1);
  scans[0]?.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scans.length, 2);

  scans[1]?.resolve();
  await livingReview.flushForTests();
  assert.equal(scans.length, 2);
  assert.equal(maximumActive, 1);
});

test("a failed scan is logged and a pending trailing scan still runs", async () => {
  const zoteroNotifier = new FakeNotifier();
  const first = deferred();
  const failures: Array<{ message: string; error: unknown }> = [];
  let scans = 0;
  const livingReview = createResearchWorkspaceLivingReviewNotifier({
    notifier: zoteroNotifier,
    scanAllActiveProjects: async () => {
      scans += 1;
      if (scans === 1) await first.promise;
    },
    log: (message, error) => failures.push({ message, error }),
  });
  livingReview.start();

  zoteroNotifier.emit();
  await Promise.resolve();
  assert.equal(scans, 1);
  zoteroNotifier.emit();
  const failure = new Error("transient Zotero read failure");
  first.reject(failure);
  await livingReview.flushForTests();

  assert.equal(scans, 2);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.error, failure);

  zoteroNotifier.emit();
  await livingReview.flushForTests();
  assert.equal(scans, 3, "future notifications must recover after an error");
});

test("stop cancels queued and trailing work without interrupting an active scan", async () => {
  const zoteroNotifier = new FakeNotifier();
  const activeScan = deferred();
  let scans = 0;
  const livingReview = createResearchWorkspaceLivingReviewNotifier({
    notifier: zoteroNotifier,
    scanAllActiveProjects: async () => {
      scans += 1;
      await activeScan.promise;
    },
  });
  livingReview.start();

  zoteroNotifier.emit();
  await Promise.resolve();
  assert.equal(scans, 1);
  zoteroNotifier.emit();
  livingReview.stop();
  zoteroNotifier.emit();
  activeScan.resolve();
  await livingReview.flushForTests();

  assert.equal(scans, 1);
  assert.deepEqual(zoteroNotifier.unregistered, ["observer-1"]);
  assert.deepEqual(livingReview.getState(), {
    lifecycle: "stopped",
    scheduled: false,
    draining: false,
    pending: false,
  });

  const queuedNotifier = new FakeNotifier();
  let queuedScans = 0;
  const queuedLivingReview = createResearchWorkspaceLivingReviewNotifier({
    notifier: queuedNotifier,
    scanAllActiveProjects: () => {
      queuedScans += 1;
    },
  });
  queuedLivingReview.start();
  queuedNotifier.emit();
  queuedLivingReview.stop();
  await queuedLivingReview.flushForTests();
  assert.equal(queuedScans, 0, "stop must cancel a scheduled scan");
});
