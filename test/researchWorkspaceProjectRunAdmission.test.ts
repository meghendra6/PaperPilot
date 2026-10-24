import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  isResearchWorkspaceProjectDeleting,
  quiesceResearchWorkspaceProject,
  releaseResearchWorkspaceProjectDeletion,
  runResearchWorkspaceProjectTask,
} from "../src/modules/researchWorkspace/projectRunAdmission";

test("deletion drains admitted work and retains its barrier until success", async () => {
  const scope = "/profile/admission/projects/one";
  let finish = () => {};
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let taskStarted = () => {};
  const started = new Promise<void>((resolve) => {
    taskStarted = resolve;
  });
  const task = runResearchWorkspaceProjectTask(scope, async () => {
    taskStarted();
    await waiting;
    await assert.rejects(
      runResearchWorkspaceProjectTask(scope, async () => {}),
      /being deleted/,
    );
  });
  await started;
  let drained = false;
  const deletion = quiesceResearchWorkspaceProject(scope).then(() => {
    drained = true;
  });
  assert.equal(isResearchWorkspaceProjectDeleting(scope), true);
  await assert.rejects(
    runResearchWorkspaceProjectTask(scope, async () => {}),
    /being deleted/,
  );
  assert.throws(
    () => releaseResearchWorkspaceProjectDeletion(scope),
    /not finished/,
  );
  assert.equal(drained, false);
  finish();
  await Promise.all([task, deletion]);
  await assert.rejects(
    runResearchWorkspaceProjectTask(scope, async () => {}),
    /being deleted/,
  );
  await quiesceResearchWorkspaceProject(scope);
  releaseResearchWorkspaceProjectDeletion(scope);
  assert.equal(
    await runResearchWorkspaceProjectTask(scope, async () => "recreated"),
    "recreated",
  );
});

test("project deletion is isolated by profile and project and drains failed work", async () => {
  const scope = "/profile-a/projects/shared";
  let fail = () => {};
  const work = runResearchWorkspaceProjectTask(
    scope,
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error("operation failed"));
      }),
  );
  const rejected = assert.rejects(work, /operation failed/);
  await Promise.resolve();
  const deletion = quiesceResearchWorkspaceProject(scope);
  assert.equal(
    await runResearchWorkspaceProjectTask(
      "/profile-b/projects/shared",
      async () => 1,
    ),
    1,
  );
  assert.equal(
    await runResearchWorkspaceProjectTask(
      "/profile-a/projects/other",
      async () => 2,
    ),
    2,
  );
  fail();
  await Promise.all([rejected, deletion]);
  assert.equal(isResearchWorkspaceProjectDeleting(scope), true);
  releaseResearchWorkspaceProjectDeletion(scope);
});
