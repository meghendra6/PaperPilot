import { listResearchWorkspaceCapabilities } from "./capabilityRegistry";
import { element } from "./dom";
import {
  createResearchWorkspaceProjectFromTemplate,
  exportResearchWorkspaceProjectTemplateState,
  listResearchWorkspaceProjectTemplateOptions,
  previewResearchWorkspaceProjectTemplate,
  updateResearchWorkspaceProjectTemplateSettings,
} from "./facade";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import {
  addedPapersMessage,
  button,
  formStatus,
  labeledField,
  setMessage,
  textArea,
  textInput,
  type ProjectNavigation,
} from "./projectSurfaceShared";
import type { ResearchWorkspaceProjectTemplatePreview } from "./projectTemplates";
import { papersLabel } from "./surfaceSelection";

export interface ProjectTemplateCreatorOptions {
  /** How many selected papers a new project would include. */
  includedPapers: number;
  /** Reads the papers to include; reports progress through `report`. */
  papers(
    report: (message: string) => void,
  ): Promise<{ papers: readonly ResearchWorkspacePaper[]; unread: number }>;
  open(
    projectID: string,
    papers: readonly ResearchWorkspacePaper[],
    message: { text: string; kind: "info" | "success" | "warning" },
  ): Promise<void>;
}

/**
 * Checkboxes for the tools a template recommends. Recommendations only add
 * emphasis; every tool stays available. `selected()` reads the boxes, so a
 * choice restored after a project rebuild is the one that is saved.
 */
function renderPresetChoices(doc: Document, selected: readonly string[]) {
  const fieldset = element(doc, "fieldset", "pprw-preset-choices");
  fieldset.append(element(doc, "legend", "", "Recommended tools"));
  const current = new Set(selected);
  const boxes: HTMLInputElement[] = [];
  for (const capability of listResearchWorkspaceCapabilities()) {
    const label = element(doc, "label", "pprw-preset-choice");
    const box = element(doc, "input", "");
    box.type = "checkbox";
    box.value = capability.id;
    box.checked = current.has(capability.id);
    box.dataset.restoreKey = `preset:${capability.id}`;
    boxes.push(box);
    label.append(box, ` ${capability.label}`);
    fieldset.append(label);
  }
  return {
    element: fieldset,
    selected: () =>
      boxes.filter((entry) => entry.checked).map((entry) => entry.value),
  };
}

export function renderProjectTemplateCreator(
  doc: Document,
  options: ProjectTemplateCreatorOptions,
) {
  const section = element(
    doc,
    "details",
    "pprw-project-panel pprw-template-creator",
  );
  section.append(
    element(
      doc,
      "summary",
      "pprw-section-title",
      "Create from a research project template",
    ),
    element(
      doc,
      "p",
      "pprw-muted",
      `Templates fill in a name, a research question, and assumptions for common review types, and highlight the tools that suit them. Edit anything before you create.${
        options.includedPapers
          ? ` The ${papersLabel(options.includedPapers)} selected in Zotero are added.`
          : ""
      } No capability runs automatically and no other capability is hidden.`,
    ),
  );
  const templates = listResearchWorkspaceProjectTemplateOptions();
  const selector = element(doc, "select", "pprw-input");
  selector.setAttribute("aria-label", "Research project template");
  for (const template of templates) {
    const option = element(doc, "option", "", template.name);
    option.value = template.templateID;
    selector.append(option);
  }
  const previewHost = element(doc, "div", "pprw-template-preview");
  const status = formStatus(doc);
  let preview: ResearchWorkspaceProjectTemplatePreview | undefined;

  const renderPreview = () => {
    preview = previewResearchWorkspaceProjectTemplate(selector.value);
    previewHost.replaceChildren();
    const projectName = textInput(doc, "Project name", preview.projectName);
    const description = textArea(
      doc,
      "Project description",
      preview.description,
    );
    description.rows = 3;
    const researchQuestion = textArea(
      doc,
      "Research question",
      preview.researchQuestion,
    );
    researchQuestion.rows = 2;
    projectName.addEventListener("input", () => {
      if (preview) preview.projectName = projectName.value;
    });
    description.addEventListener("input", () => {
      if (preview) preview.description = description.value;
    });
    researchQuestion.addEventListener("input", () => {
      if (preview) preview.researchQuestion = researchQuestion.value;
    });
    previewHost.append(
      element(doc, "h3", "", "Editable preview"),
      labeledField(doc, "Project name", projectName),
      labeledField(doc, "Description", description),
      labeledField(doc, "Research question", researchQuestion),
      element(doc, "h4", "", "Editable assumptions"),
    );
    for (const assumption of preview.assumptions) {
      const input = textArea(doc, assumption.label, assumption.value);
      input.rows = 2;
      input.setAttribute("aria-label", assumption.label);
      input.addEventListener("input", () => {
        assumption.value = input.value;
      });
      previewHost.append(labeledField(doc, assumption.label, input));
    }
    const presets = renderPresetChoices(doc, preview.capabilityPresetIDs);
    previewHost.append(
      presets.element,
      element(
        doc,
        "p",
        "pprw-muted",
        "Recommendations change visual emphasis only. All capabilities remain available, and choosing a template never starts analysis.",
      ),
      button(
        doc,
        options.includedPapers
          ? `Create project from template with ${papersLabel(options.includedPapers)}`
          : "Create project from template",
        async () => {
          if (!preview) return;
          preview.capabilityPresetIDs = presets.selected();
          status.clear();
          try {
            const loaded = await options.papers(status.info);
            status.info("Creating the project without running capabilities…");
            const created = await createResearchWorkspaceProjectFromTemplate(
              preview,
              loaded.papers,
            );
            await options.open(created.project.projectID, loaded.papers, {
              text: loaded.papers.length
                ? `${addedPapersMessage(
                    `Created “${created.project.name}” from a template with`,
                    loaded.papers.length,
                    loaded.unread,
                  )} Recommended tools are highlighted below.`
                : `Created “${created.project.name}” from a template. Add papers from the Papers tab.`,
              kind: loaded.unread ? "warning" : "success",
            });
          } catch (error) {
            status.error(error);
          }
        },
        true,
      ),
      status.node,
    );
  };
  selector.addEventListener("change", renderPreview);
  section.append(labeledField(doc, "Template", selector), previewHost);
  if (templates[0]) {
    selector.value = templates[0].templateID;
    renderPreview();
  }
  return section;
}

export function renderProjectTemplateSettings(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const snapshot = details.project.templateSnapshot;
  if (!snapshot) return undefined;
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-template-settings",
  );
  section.append(
    element(doc, "h3", "", "Project template settings"),
    element(
      doc,
      "p",
      "pprw-muted",
      `${snapshot.templateName} · version ${snapshot.templateVersion} · applied ${new Date(snapshot.appliedAt).toLocaleString()}`,
    ),
  );
  // Saving reads the fields themselves. A rebuild restores typed values
  // without input events, so a copy kept by listeners would be stale.
  const assumptionInputs = (details.project.templateAssumptions ?? []).map(
    (assumption) => {
      const input = textArea(doc, assumption.label, assumption.value);
      input.rows = 2;
      input.setAttribute("aria-label", assumption.label);
      section.append(labeledField(doc, assumption.label, input));
      return { assumption, input };
    },
  );
  const presets = renderPresetChoices(
    doc,
    details.project.capabilityPresetIDs ?? [],
  );
  const capabilityLabels = new Map<string, string>(
    listResearchWorkspaceCapabilities().map((entry) => [entry.id, entry.label]),
  );
  const original = element(doc, "details", "pprw-section");
  original.append(
    element(doc, "summary", "pprw-section-title", "Original template snapshot"),
  );
  const originalList = element(doc, "ul", "pprw-render-list");
  for (const assumption of snapshot.registryAssumptions) {
    originalList.append(
      element(doc, "li", "", `${assumption.label}: ${assumption.value}`),
    );
  }
  original.append(
    originalList,
    element(
      doc,
      "p",
      "pprw-muted",
      `Original recommended tools: ${
        snapshot.registryCapabilityPresetIDs
          .map((id) => capabilityLabels.get(id) ?? id)
          .join(", ") || "None"
      }`,
    ),
  );
  const actions = element(doc, "div", "pprw-row");
  actions.append(
    button(
      doc,
      "Save template settings",
      async () => {
        try {
          setMessage(root, "Saving editable template settings…");
          await updateResearchWorkspaceProjectTemplateSettings({
            projectID: details.project.projectID,
            expectedProjectRevision: details.projectRevision,
            assumptions: assumptionInputs.map(({ assumption, input }) => ({
              ...assumption,
              value: input.value,
            })),
            capabilityPresetIDs: presets.selected(),
          });
          await navigation.renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
          setMessage(root, "Template settings saved.", "success");
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      },
      true,
    ),
    button(doc, "Verify template export", async () => {
      try {
        const exported = await exportResearchWorkspaceProjectTemplateState(
          details.project.projectID,
        );
        setMessage(
          root,
          `Template snapshot is present in JSON (${exported.json.length.toLocaleString()} characters) and Markdown (${exported.markdown.length.toLocaleString()} characters).`,
          "success",
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    }),
  );
  section.append(
    presets.element,
    element(
      doc,
      "p",
      "pprw-muted",
      "Editing presets changes recommendations only. It does not run capabilities or hide any capability from the project.",
    ),
    original,
    actions,
  );
  return section;
}
