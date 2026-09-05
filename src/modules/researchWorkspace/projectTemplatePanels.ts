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
  button,
  capabilityPresetIDs,
  logProjectError,
  setMessage,
  textArea,
  textInput,
  type ProjectNavigation,
} from "./projectSurfaceShared";
import type { ResearchWorkspaceProjectTemplatePreview } from "./projectTemplates";
export function renderSelectionReview(
  doc: Document,
  papers: readonly ResearchWorkspacePaper[],
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(
    element(doc, "h2", "", "Review captured selection"),
    element(
      doc,
      "p",
      "pprw-muted",
      `${papers.length} exact PDF${papers.length === 1 ? " is" : "s are"} ready. No analysis starts until you choose a project and an operation.`,
    ),
  );
  const list = element(doc, "div", "pprw-project-paper-list");
  for (const paper of papers) {
    const row = element(doc, "div", "pprw-project-paper-row");
    row.append(
      element(doc, "strong", "", paper.title),
      element(
        doc,
        "span",
        "pprw-muted",
        `Library ${paper.libraryID} · PDF ${paper.attachmentKey} · ${paper.extractionQuality}`,
      ),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

export function renderProjectTemplateCreator(
  doc: Document,
  root: HTMLElement,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-template-creator",
  );
  section.append(
    element(doc, "h2", "", "Create from a research project template"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Choose a template, edit its preview, and create explicitly. Presets only highlight recommendations; no capability runs automatically and no other capability is hidden.",
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
  const status = element(doc, "p", "pprw-muted", "");
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
    description.rows = 4;
    const researchQuestion = textArea(
      doc,
      "Research question",
      preview.researchQuestion,
    );
    researchQuestion.rows = 3;
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
      element(doc, "label", "pprw-field-label", "Project name"),
      projectName,
      element(doc, "label", "pprw-field-label", "Description"),
      description,
      element(doc, "label", "pprw-field-label", "Research question"),
      researchQuestion,
      element(doc, "h4", "", "Editable assumptions"),
    );
    for (const assumption of preview.assumptions) {
      const input = textArea(doc, assumption.label, assumption.value);
      input.rows = 2;
      input.setAttribute("aria-label", assumption.label);
      input.addEventListener("input", () => {
        assumption.value = input.value;
      });
      previewHost.append(
        element(doc, "label", "pprw-field-label", assumption.label),
        input,
      );
    }
    const presets = textInput(
      doc,
      "Capability preset IDs",
      preview.capabilityPresetIDs.join(", "),
    );
    presets.setAttribute("aria-label", "Recommended capability preset IDs");
    presets.addEventListener("input", () => {
      if (preview) {
        preview.capabilityPresetIDs = capabilityPresetIDs(presets.value);
      }
    });
    previewHost.append(
      element(doc, "h4", "", "Recommended capability presets"),
      presets,
      element(
        doc,
        "p",
        "pprw-muted",
        "Recommendations change visual emphasis only. All capabilities remain available, and choosing a template never starts analysis.",
      ),
      button(
        doc,
        "Create project from template",
        async () => {
          if (!preview) return;
          try {
            status.textContent =
              "Creating the project without running capabilities…";
            const created = await createResearchWorkspaceProjectFromTemplate(
              preview,
              capturedPapers,
            );
            await navigation.renderProject(
              root,
              created.project.projectID,
              capturedPapers,
              generation,
            );
          } catch (error) {
            status.textContent =
              error instanceof Error ? error.message : String(error);
            status.className = "pprw-project-warning";
            logProjectError(error);
          }
        },
        true,
      ),
    );
  };
  selector.addEventListener("change", renderPreview);
  section.append(selector, previewHost, status);
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
      `${snapshot.templateName} · ${snapshot.templateID} v${snapshot.templateVersion} · applied ${new Date(snapshot.appliedAt).toLocaleString()}`,
    ),
  );
  const assumptions = (details.project.templateAssumptions ?? []).map(
    (assumption) => ({ ...assumption }),
  );
  for (const assumption of assumptions) {
    const input = textArea(doc, assumption.label, assumption.value);
    input.rows = 2;
    input.setAttribute("aria-label", assumption.label);
    input.addEventListener("input", () => {
      assumption.value = input.value;
    });
    section.append(
      element(doc, "label", "pprw-field-label", assumption.label),
      input,
    );
  }
  const presets = textInput(
    doc,
    "Capability preset IDs",
    (details.project.capabilityPresetIDs ?? []).join(", "),
  );
  presets.setAttribute("aria-label", "Recommended capability preset IDs");
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
      `Original presets: ${snapshot.registryCapabilityPresetIDs.join(", ") || "None"}`,
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
            assumptions,
            capabilityPresetIDs: capabilityPresetIDs(presets.value),
          });
          await navigation.renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
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
    element(doc, "label", "pprw-field-label", "Recommended capability presets"),
    presets,
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
