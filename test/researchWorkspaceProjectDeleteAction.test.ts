import * as assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import * as facade from "../src/modules/researchWorkspace/facade";
import { deleteProjectFromSurface } from "../src/modules/researchWorkspace/projectDeleteAction";
import * as surface from "../src/modules/researchWorkspace/projectSurfaceShared";

const project = { projectID: "project-delete-test", name: "Review project" };

function setup(t: TestContext, confirmed = true, released = true) {
  const events: string[] = [];
  const root = {
    ownerDocument: {
      defaultView: {
        confirm(message: string) {
          assert.match(message, /Permanently delete “Review project”/);
          assert.match(
            message,
            /documents, imported PDF copies, saved versions/,
          );
          assert.match(message, /conversations, research artifacts/);
          assert.match(message, /project-owned temporary files/);
          assert.match(message, /project-managed exports and backups/);
          assert.match(
            message,
            /Original Zotero items and attachments, and files saved separately, will be preserved/,
          );
          events.push("confirm");
          return confirmed;
        },
      },
    },
  } as unknown as HTMLElement;
  t.mock.method(surface, "releaseOperations", () => {
    events.push("release");
    return released;
  });
  t.mock.method(
    surface,
    "setMessage",
    (_root: HTMLElement, message: string, kind = "info") => {
      events.push(`${kind}: ${message}`);
    },
  );
  const renderHome = async () => {
    events.push("home");
  };
  return { root, events, renderHome };
}

test("project deletion cancellation leaves operations and project intact", async (t) => {
  const { root, events, renderHome } = setup(t, false);
  t.mock.method(facade, "deleteResearchWorkspaceProject", () =>
    assert.fail("cancelled deletion must not reach storage"),
  );
  await deleteProjectFromSurface(root, project, renderHome);
  assert.deepEqual(events, ["confirm"]);
});

test("keeping a running analysis cancels project deletion", async (t) => {
  const { root, events, renderHome } = setup(t, true, false);
  t.mock.method(facade, "deleteResearchWorkspaceProject", () =>
    assert.fail("a retained analysis must prevent deletion"),
  );
  await deleteProjectFromSurface(root, project, renderHome);
  assert.deepEqual(events, ["confirm", "release"]);
});

test("project deletion waits for cleanup before navigation and success", async (t) => {
  const { root, events, renderHome } = setup(t);
  let finishCleanup = () => {};
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  t.mock.method(
    facade,
    "deleteResearchWorkspaceProject",
    (projectID: string) => {
      assert.equal(projectID, project.projectID);
      events.push("delete");
      return cleanup;
    },
  );
  const deleting = deleteProjectFromSurface(root, project, renderHome);
  assert.deepEqual(events, [
    "confirm",
    "release",
    "info: Deleting “Review project”…",
    "delete",
  ]);
  finishCleanup();
  await deleting;
  assert.deepEqual(events.slice(-2), [
    "home",
    "success: Deleted “Review project”.",
  ]);
});

test("failed project cleanup propagates to the surface error handler without success", async (t) => {
  const { root, events, renderHome } = setup(t);
  const failure = new Error("A Studio process could not be stopped.");
  t.mock.method(facade, "deleteResearchWorkspaceProject", async () => {
    throw failure;
  });
  await assert.rejects(
    deleteProjectFromSurface(root, project, renderHome),
    failure,
  );
  assert.deepEqual(events, [
    "confirm",
    "release",
    "info: Deleting “Review project”…",
  ]);
});
