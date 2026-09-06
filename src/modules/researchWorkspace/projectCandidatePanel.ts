import { element } from "./dom";
import {
  addResearchWorkspaceCandidate,
  checkResearchWorkspaceChanges,
  bindResearchWorkspaceCandidatePDF,
  linkResearchWorkspaceCandidateItem,
  updateResearchWorkspaceCandidateNote,
} from "./facade";
import { candidateBindingState } from "./persistence/candidates";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import { button, setMessage, textInput } from "./projectSurfaceShared";

export function renderProjectCandidateInbox(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  refresh: () => Promise<void>,
) {
  const panel = element(doc, "section", "pprw-project-panel");
  panel.append(
    element(doc, "h3", "", "Candidate inbox"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Keep promising papers before a PDF is available. Linking uses the exact existing Zotero item or PDF you select; it does not download files or create library items.",
    ),
  );
  const initialRevision = details.candidatesRevision;
  if (initialRevision === undefined) {
    panel.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "The candidate inbox could not be read. Existing files were preserved.",
      ),
    );
    return panel;
  }
  let candidatesRevision = initialRevision;
  if (details.candidates?.some((candidate) => candidate.binding))
    panel.append(
      button(doc, "Refresh linked PDF status", async () => {
        setMessage(root, "Checking exact linked PDF availability…");
        await checkResearchWorkspaceChanges(details.project.projectID);
        await refresh();
      }),
    );
  const title = textInput(doc, "Candidate title");
  const doi = textInput(doc, "DOI (optional)");
  const url = textInput(doc, "Discovery URL (optional)");
  const note = textInput(doc, "Why is this paper useful? (optional)");
  panel.append(
    title,
    doi,
    url,
    note,
    button(doc, "Save candidate", async () => {
      await addResearchWorkspaceCandidate({
        projectID: details.project.projectID,
        metadata: {
          title: title.value.trim(),
          ...(doi.value.trim() ? { doi: doi.value.trim() } : {}),
          ...(url.value.trim() ? { url: url.value.trim() } : {}),
        },
        provenance: {
          kind: "manual",
          ...(url.value.trim() ? { url: url.value.trim() } : {}),
        },
        userNote: note.value,
      });
      await refresh();
    }),
  );
  for (const candidate of details.candidates ?? []) {
    const row = element(doc, "article", "pprw-project-card");
    const source = details.sources.find(
      (entry) => entry.sourceID === candidate.binding?.sourceID,
    );
    row.append(
      element(doc, "h4", "", candidate.metadata.title),
      element(
        doc,
        "p",
        "pprw-muted",
        `${candidateBindingState(candidate, source)} · ${candidate.provenance.kind}${candidate.metadata.doi ? ` · DOI ${candidate.metadata.doi}` : ""}`,
      ),
    );
    if (candidate.provenance.url || candidate.metadata.url)
      row.append(
        element(
          doc,
          "p",
          "pprw-muted",
          candidate.provenance.url || candidate.metadata.url,
        ),
      );
    if (candidate.binding)
      row.append(
        element(
          doc,
          "p",
          "pprw-muted",
          `Linked PDF: library ${candidate.binding.libraryID} · ${candidate.binding.attachmentKey}`,
        ),
      );
    else if (candidate.zoteroItem)
      row.append(
        element(
          doc,
          "p",
          "pprw-muted",
          `Linked Zotero item: library ${candidate.zoteroItem.libraryID} · ${candidate.zoteroItem.itemKey}`,
        ),
      );
    const userNote = textInput(
      doc,
      `Review note for ${candidate.metadata.title}`,
      candidate.userNote ?? "",
    );
    row.append(
      userNote,
      button(doc, "Save note", async () => {
        const saved = await updateResearchWorkspaceCandidateNote({
          projectID: details.project.projectID,
          candidateID: candidate.candidateID,
          expectedRevision: candidatesRevision,
          userNote: userNote.value,
        });
        candidatesRevision = saved.revision;
        setMessage(root, "Candidate note saved.");
      }),
    );
    const linkSelection = async (pdf: boolean) => {
      const items =
        (Zotero.getActiveZoteroPane() as any)?.getSelectedItems?.() ?? [];
      if (items.length !== 1)
        throw new Error(
          `Select exactly one existing ${pdf ? "PDF attachment row" : "bibliographic item"} in Zotero first.`,
        );
      const selected = items[0];
      if (Boolean(selected.isAttachment?.()) !== pdf)
        throw new Error(
          pdf
            ? "Select the exact PDF attachment row, not its parent item."
            : "Select the bibliographic parent item, not an attachment.",
        );
      const label = String(selected.getField?.("title") || selected.key);
      if (
        !doc.defaultView?.confirm(
          `Link “${candidate.metadata.title}” to “${label}” in library ${selected.libraryID} (${selected.key})?${pdf ? " This adds that exact PDF to the project; analysis does not start." : " PDF selection remains a separate step."}`,
        )
      )
        return;
      setMessage(
        root,
        pdf
          ? "Loading and linking the selected PDF…"
          : "Linking the selected Zotero item…",
      );
      if (pdf)
        await bindResearchWorkspaceCandidatePDF({
          projectID: details.project.projectID,
          candidateID: candidate.candidateID,
          attachmentID: selected.id,
        });
      else
        await linkResearchWorkspaceCandidateItem({
          projectID: details.project.projectID,
          candidateID: candidate.candidateID,
          itemID: selected.id,
        });
      await refresh();
    };
    row.append(
      button(doc, "Link selected Zotero item", () => linkSelection(false)),
      button(doc, "Link selected PDF", () => linkSelection(true)),
    );
    panel.append(row);
  }
  return panel;
}
