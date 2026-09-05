import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  createResearchWorkspaceProjectTemplatePreview,
  getResearchWorkspaceProjectTemplate,
  instantiateResearchWorkspaceProjectTemplate,
  listResearchWorkspaceProjectTemplates,
  renderResearchWorkspaceProjectTemplateMarkdown,
  serializeResearchWorkspaceProjectTemplateJSON,
  updateResearchWorkspaceProjectTemplateSettings,
} from "../src/modules/researchWorkspace/projectTemplates";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import { parseResearchWorkspaceProjectFile } from "../src/modules/researchWorkspace/persistence/validation";
import { ResearchWorkspaceProjectController } from "../src/modules/researchWorkspace/projectController";

class MemoryFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async exists(path: string) {
    if (this.files.has(path) || this.directories.has(path)) return true;
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].some((entry) => entry.startsWith(prefix));
  }

  async readText(path: string) {
    return this.files.get(path);
  }

  async writeTextAtomic(path: string, contents: string) {
    this.files.set(path, contents);
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const entry of [...this.files.keys()]) {
      if (entry === path || (options?.recursive && entry.startsWith(prefix))) {
        this.files.delete(entry);
      }
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function setup() {
  let clock = Date.parse("2026-08-30T01:00:00.000Z");
  let id = 0;
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir: "/profile/paperpilot-research-workspace",
    fileOps: new MemoryFiles(),
    now: () => new Date(clock++),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  const controller = new ResearchWorkspaceProjectController(repository, {
    now: () => new Date(clock++),
  });
  return { repository, controller };
}

test("template registry exposes exactly five defensive deep clones", () => {
  const templates = listResearchWorkspaceProjectTemplates();
  assert.deepEqual(
    templates.map((template) => template.name),
    [
      "Exploratory literature review",
      "Systematic review",
      "Reproduction project",
      "Technology comparison",
      "Paper reading group",
    ],
  );
  assert.equal(templates.length, 5);

  templates[0].name = "mutated caller copy";
  templates[0].assumptions[0].value = "mutated assumption";
  templates[0].capabilityPresetIDs.push("invented-capability");
  const fresh = getResearchWorkspaceProjectTemplate(
    "exploratory-literature-review",
  );
  assert.equal(fresh.name, "Exploratory literature review");
  assert.notEqual(fresh.assumptions[0].value, "mutated assumption");
  assert.equal(
    fresh.capabilityPresetIDs.includes("invented-capability"),
    false,
  );
});

test("template previews are editable while the registry provenance snapshot stays immutable", () => {
  const preview =
    createResearchWorkspaceProjectTemplatePreview("systematic-review");
  const registryAssumption = preview.template.assumptions[0].value;
  preview.projectName = "Edited systematic project";
  preview.description = "Edited project description";
  preview.researchQuestion = "What is the admitted effect?";
  preview.assumptions[0].value = "Edited before creation";
  preview.capabilityPresetIDs = ["living-review", "screening-log"];

  const instantiated = instantiateResearchWorkspaceProjectTemplate({
    preview,
    appliedAt: "2026-08-30T01:00:00.000Z",
  });
  assert.equal(instantiated.projectName, "Edited systematic project");
  assert.equal(
    instantiated.templateAssumptions[0].value,
    "Edited before creation",
  );
  assert.equal(
    instantiated.templateSnapshot.registryAssumptions[0].value,
    registryAssumption,
  );
  assert.deepEqual(instantiated.capabilityPresetIDs, [
    "living-review",
    "screening-log",
  ]);

  const project = {
    projectID: "project-template-unit",
    name: instantiated.projectName,
    description: instantiated.description,
    researchQuestion: instantiated.researchQuestion,
    templateSnapshot: instantiated.templateSnapshot,
    templateAssumptions: instantiated.templateAssumptions,
    capabilityPresetIDs: instantiated.capabilityPresetIDs,
    artifactIDs: [],
    runIDs: [],
    createdAt: "2026-08-30T01:00:00.000Z",
    updatedAt: "2026-08-30T01:00:00.000Z",
  };
  const updated = updateResearchWorkspaceProjectTemplateSettings(project, {
    assumptions: [
      {
        ...project.templateAssumptions[0],
        value: "Edited after creation",
      },
    ],
    capabilityPresetIDs: ["citation-reference-health"],
  });
  assert.deepEqual(updated.templateSnapshot, project.templateSnapshot);
  assert.equal(updated.templateAssumptions?.[0].value, "Edited after creation");
  assert.deepEqual(updated.capabilityPresetIDs, ["citation-reference-health"]);
});

test("stale template previews and unknown capability presets are rejected", () => {
  const stale = createResearchWorkspaceProjectTemplatePreview(
    "reproduction-project",
  );
  stale.template.templateVersion += 1;
  assert.throws(
    () =>
      instantiateResearchWorkspaceProjectTemplate({
        preview: stale,
        appliedAt: "2026-08-30T01:00:00.000Z",
      }),
    /preview is stale/,
  );

  const invalid = createResearchWorkspaceProjectTemplatePreview(
    "technology-comparison",
  );
  invalid.capabilityPresetIDs.push("not-a-real-capability");
  assert.throws(
    () =>
      instantiateResearchWorkspaceProjectTemplate({
        preview: invalid,
        appliedAt: "2026-08-30T01:00:00.000Z",
      }),
    /Unknown Research Workspace capability/,
  );
});

test("template project creation persists provenance without running capabilities", async () => {
  const { repository, controller } = setup();
  const preview = createResearchWorkspaceProjectTemplatePreview(
    "technology-comparison",
  );
  preview.projectName = "Accelerator comparison";
  preview.assumptions[0].value = "Compare batch-1 decoding on fixed hardware.";

  const created = await controller.createProjectFromTemplate(preview);
  assert.equal(created.project.name, "Accelerator comparison");
  assert.equal(
    created.project.templateSnapshot?.templateID,
    "technology-comparison",
  );
  assert.equal(
    created.project.templateAssumptions?.[0].value,
    "Compare batch-1 decoding on fixed hardware.",
  );
  assert.deepEqual(created.project.artifactIDs, []);
  assert.deepEqual(created.project.runIDs, []);
  assert.deepEqual(
    (await repository.listArtifacts(created.project.projectID)).artifacts,
    [],
  );
  assert.deepEqual(
    (await repository.listRuns(created.project.projectID)).runs,
    [],
  );

  const snapshot = structuredClone(created.project.templateSnapshot);
  const updated = await controller.updateTemplateSettings({
    projectID: created.project.projectID,
    expectedProjectRevision: created.projectRevision,
    assumptions: [
      {
        ...created.project.templateAssumptions![0],
        value: "Compare prefill and decoding separately.",
      },
    ],
    capabilityPresetIDs: ["citation-reference-health", "living-review"],
  });
  assert.deepEqual(updated.project.templateSnapshot, snapshot);
  assert.equal(
    updated.project.templateAssumptions?.[0].value,
    "Compare prefill and decoding separately.",
  );
  assert.deepEqual(updated.project.capabilityPresetIDs, [
    "citation-reference-health",
    "living-review",
  ]);

  await assert.rejects(
    () =>
      repository.updateProject(
        created.project.projectID,
        updated.projectRevision,
        (project) => ({
          ...project,
          templateSnapshot: {
            ...project.templateSnapshot!,
            templateName: "Rewritten provenance",
          },
        }),
      ),
    /provenance snapshot/,
  );
});

test("template snapshot is included in JSON, Markdown, and project export", async () => {
  const { repository, controller } = setup();
  const created = await controller.createProjectFromTemplate(
    createResearchWorkspaceProjectTemplatePreview("paper-reading-group"),
  );
  const json = serializeResearchWorkspaceProjectTemplateJSON(created.project);
  const markdown = renderResearchWorkspaceProjectTemplateMarkdown(
    created.project,
  );
  assert.match(json, /"templateID": "paper-reading-group"/);
  assert.match(json, /"registryAssumptions"/);
  assert.match(markdown, /Paper reading group/);
  assert.match(markdown, /does not run them automatically/);
  const exported = await repository.exportProject(created.project.projectID);
  assert.equal(
    exported.project.templateSnapshot?.templateID,
    "paper-reading-group",
  );
  assert.deepEqual(
    exported.project.templateSnapshot?.registryCapabilityPresetIDs,
    created.project.templateSnapshot?.registryCapabilityPresetIDs,
  );
});

test("schema-v1 project parser accepts additive template fields and rejects orphan presets", () => {
  const instantiated = instantiateResearchWorkspaceProjectTemplate({
    preview: createResearchWorkspaceProjectTemplatePreview(
      "exploratory-literature-review",
    ),
    appliedAt: "2026-08-30T01:00:00.000Z",
  });
  const valid = {
    schemaVersion: 1,
    revision: 1,
    project: {
      projectID: "project-template-parser",
      name: instantiated.projectName,
      description: instantiated.description,
      researchQuestion: instantiated.researchQuestion,
      templateSnapshot: instantiated.templateSnapshot,
      templateAssumptions: instantiated.templateAssumptions,
      capabilityPresetIDs: instantiated.capabilityPresetIDs,
      artifactIDs: [],
      runIDs: [],
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    },
  };
  assert.deepEqual(parseResearchWorkspaceProjectFile(valid), valid);

  const historical = structuredClone(valid);
  historical.project.templateSnapshot.registryCapabilityPresetIDs = [
    "retired-capability-v1",
  ];
  historical.project.capabilityPresetIDs = ["retired-capability-v1"];
  assert.deepEqual(parseResearchWorkspaceProjectFile(historical), historical);

  const invalid = structuredClone(valid);
  delete (invalid.project as Partial<typeof invalid.project>).templateSnapshot;
  assert.throws(
    () => parseResearchWorkspaceProjectFile(invalid),
    /require a template snapshot/,
  );
});

test("every template preset is a registered capability", () => {
  const registrySource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/capabilityRegistry.ts"),
    "utf8",
  );
  const registered = new Set(
    [...registrySource.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map(
      (match) => match[1],
    ),
  );
  for (const template of listResearchWorkspaceProjectTemplates()) {
    for (const presetID of template.capabilityPresetIDs) {
      assert(
        registered.has(presetID),
        `${template.templateID} uses unknown capability ${presetID}`,
      );
    }
  }
});

test("template UI exposes selector, editable preview, settings, and recommendation-only emphasis", () => {
  const projectWindowSource = readFileSync(
    join(
      process.cwd(),
      "src/modules/researchWorkspace/projectTemplatePanels.ts",
    ),
    "utf8",
  );
  assert.match(projectWindowSource, /Create from a research project template/);
  assert.match(projectWindowSource, /Editable preview/);
  assert.match(projectWindowSource, /Create project from template/);
  assert.match(projectWindowSource, /Project template settings/);
  assert.match(
    projectWindowSource,
    /does not run capabilities or hide any capability/,
  );
  const creatorStart = projectWindowSource.indexOf(
    "function renderProjectTemplateCreator",
  );
  const creatorEnd = projectWindowSource.indexOf(
    "function renderProjectTemplateSettings",
  );
  const creator = projectWindowSource.slice(creatorStart, creatorEnd);
  assert.equal(/runResearchWorkspace[A-Z]/.test(creator), false);

  const viewSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/view.ts"),
    "utf8",
  );
  assert.match(viewSource, /recommendedCapabilityIDs/);
  assert.match(viewSource, /pp-btn--recommended/);
  assert.doesNotMatch(
    viewSource,
    /recommendedCapabilityIDs[\s\S]{0,200}\.(?:filter|hide)|hidden\s*=\s*recommended/,
  );
});

test("template documentation covers architecture, QA, spec, and every README locale", () => {
  for (const path of [
    "docs/architecture.md",
    "docs/manual-qa.md",
    "docs/research-workspace-redesign-spec.md",
    "README.md",
    "README.ko.md",
    "README.zh-CN.md",
    "README.zh-TW.md",
  ]) {
    const contents = readFileSync(join(process.cwd(), path), "utf8");
    assert(
      /Research project templates|Project templates|프로젝트 템플릿|项目模板|專案範本/.test(
        contents,
      ),
      `${path} must document research project templates`,
    );
  }
});
