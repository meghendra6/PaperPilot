import * as assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import * as facade from "../src/modules/researchWorkspace/facade";
import type { ResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";
import type { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import {
  quickProjectID,
  ResearchWorkspaceProjectController,
} from "../src/modules/researchWorkspace/projectController";
import {
  quiesceResearchWorkspaceProject,
  releaseResearchWorkspaceProjectDeletion,
} from "../src/modules/researchWorkspace/projectRunAdmission";
import * as storage from "../src/modules/researchWorkspace/storage";

const paper: ResearchWorkspacePaper = {
  sourceID: "zotero:1:ITEM:PDF",
  paperKey: "zotero:1:ITEM:PDF",
  libraryID: 1,
  itemID: 1,
  itemKey: "ITEM",
  attachmentID: 2,
  attachmentKey: "PDF",
  contentFingerprint: {
    algorithm: "zotero-version-mtime-size-v1",
    value: "v1",
  },
  title: "Paper",
  context: "context",
  extractionQuality: "structured",
};

function repository(t: TestContext) {
  const getProjectRoot = (projectID: string) =>
    `/profile/facade-delete/${projectID}`;
  t.mock.method(
    storage,
    "getResearchWorkspaceProjectRepository",
    () => ({ getProjectRoot }) as ResearchWorkspaceProjectRepository,
  );
  return { getProjectRoot };
}

test("every project-preparing facade action refuses deletion before preparation", async (t) => {
  const repo = repository(t);
  const projectID = "project-facade-deleting";
  const scope = repo.getProjectRoot(projectID);
  await quiesceResearchWorkspaceProject(scope);
  t.after(() => releaseResearchWorkspaceProjectDeletion(scope));
  t.mock.method(ResearchWorkspaceProjectController.prototype, "addPapers", () =>
    assert.fail("blocked action reached project preparation"),
  );
  const params = {
    projectID,
    paper,
    papers: [paper, { ...paper, sourceID: "second" }],
  };
  const actions: Array<() => Promise<unknown>> = [
    () =>
      facade.runResearchWorkspaceSingleOperation({
        ...params,
        operation: "claims",
      }),
    () => facade.startOrResumeResearchWorkspaceMastery(params),
    () =>
      facade.submitResearchWorkspaceMastery({ ...params, answer: "answer" }),
    () =>
      facade.runResearchWorkspaceMultiOperation({
        ...params,
        operation: "evidence-matrix",
      }),
    () =>
      facade.runResearchWorkspaceProjectSynthesis({
        ...params,
        question: "Question?",
      }),
    () =>
      facade.submitResearchWorkspaceCrossPaperMastery({
        ...params,
        sessionID: "session",
        expectedRevision: 1,
        submissionID: "submission",
        answer: "answer",
      }),
    () => facade.extractResearchWorkspaceCitationContexts(params),
    () =>
      facade.classifyResearchWorkspaceCitations({
        ...params,
        anchor: paper,
        contexts: [],
        approvedForModel: true,
      }),
    () =>
      facade.correctResearchWorkspaceCitationStance({
        ...params,
        payload: {},
        contextID: "context",
        stance: "supporting",
        reason: "reason",
        expectedRevision: 1,
        submissionID: "submission",
      }),
    () =>
      facade.exportIntegratedResearchWorkspace({ ...params, anchor: paper }),
  ];
  for (const action of actions) await assert.rejects(action(), /being deleted/);
});

test("implicit quick-project scopes deduplicate sources before preparation", async (t) => {
  const repo = repository(t);
  const papers = [paper, { ...paper, sourceID: "second" }];
  const scope = repo.getProjectRoot(quickProjectID(papers));
  await quiesceResearchWorkspaceProject(scope);
  t.after(() => releaseResearchWorkspaceProjectDeletion(scope));
  t.mock.method(
    ResearchWorkspaceProjectController.prototype,
    "ensureQuickProject",
    () => assert.fail("blocked quick project was prepared"),
  );
  await assert.rejects(
    facade.runResearchWorkspaceMultiOperation({
      papers: [papers[1], paper, paper],
      operation: "evidence-matrix",
    }),
    /being deleted/,
  );
});

test("deletion waits for a quick-project preparation admitted before the barrier", async (t) => {
  const repo = repository(t);
  const projectID = quickProjectID([paper]);
  const scope = repo.getProjectRoot(projectID);
  let entered = () => {};
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish = () => {};
  const preparation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  t.mock.method(
    ResearchWorkspaceProjectController.prototype,
    "ensureQuickProject",
    async () => {
      entered();
      await preparation;
      return projectID;
    },
  );
  const operation = facade.exportIntegratedResearchWorkspace({
    anchor: paper,
    onStatus: () => {
      throw new Error("admitted preparation finished");
    },
  });
  const rejected = assert.rejects(operation, /admitted preparation finished/);
  await preparing;
  let drained = false;
  const deletion = quiesceResearchWorkspaceProject(scope).then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(
    drained,
    false,
    "deletion must not finish while quick-project creation is pending",
  );
  finish();
  await Promise.all([rejected, deletion]);
  assert.equal(drained, true);
  releaseResearchWorkspaceProjectDeletion(scope);
});
