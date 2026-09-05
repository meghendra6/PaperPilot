import { element } from "./dom";
import {
  applyResearchWorkspaceZoteroSync,
  listResearchWorkspaceZoteroSyncTargets,
  previewResearchWorkspaceZoteroSync,
  undoResearchWorkspaceZoteroSync,
} from "./facade";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import {
  button,
  setMessage,
  textArea,
  textInput,
  type ProjectNavigation,
} from "./projectSurfaceShared";
import type {
  ResearchWorkspaceZoteroSyncPreview,
  ResearchWorkspaceZoteroSyncReceiptFile,
  ResearchWorkspaceZoteroSyncTargets,
} from "./zoteroSync";
export function syncPreviewChangeLabels(
  preview: ResearchWorkspaceZoteroSyncPreview,
) {
  return preview.items.map((item) => {
    const changes = [
      item.addCollection && preview.collection
        ? `collection:${preview.collection.name}`
        : "",
      ...item.addTagNames.map((tagName) => `tag:${tagName}`),
    ].filter(Boolean);
    return { item, changes };
  });
}

export function renderZoteroSyncPreview(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  preview: ResearchWorkspaceZoteroSyncPreview,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const container = element(doc, "div", "pprw-template-preview");
  container.append(
    element(doc, "h4", "", "Full additive sync preview"),
    element(
      doc,
      "p",
      "pprw-muted",
      `${preview.summary.totalItems} items · ${preview.summary.collectionAdditions} collection additions · ${preview.summary.tagAdditions} tag additions · ${preview.summary.noOpItems} no-op · ${preview.summary.blockedItems} blocked`,
    ),
  );
  if (preview.collection) {
    container.append(
      element(
        doc,
        "p",
        "pprw-muted",
        `Existing collection: ${preview.collection.name} (${preview.collection.libraryID}:${preview.collection.collectionKey})`,
      ),
    );
  }
  if (preview.selection.tagNames.length) {
    container.append(
      element(
        doc,
        "p",
        "pprw-muted",
        `Existing tags: ${preview.selection.tagNames.join(", ")}`,
      ),
    );
  }
  const itemList = element(doc, "div", "pprw-artifact-history");
  for (const { item, changes } of syncPreviewChangeLabels(preview)) {
    const card = element(doc, "article", "pprw-artifact-card");
    card.append(
      element(
        doc,
        "strong",
        "",
        item.title || `${item.libraryID}:${item.itemKey}`,
      ),
      element(doc, "span", "pprw-artifact-status", item.status),
      element(
        doc,
        "p",
        "pprw-muted",
        `Stable item identity: ${item.libraryID}:${item.itemKey}`,
      ),
      element(
        doc,
        "p",
        "pprw-muted",
        item.sourceIDs.length
          ? `${item.sourceIDs.length} Research Workspace source identity${item.sourceIDs.length === 1 ? "" : "ies"}`
          : "No admitted project source identity",
      ),
      element(
        doc,
        "p",
        "pprw-muted",
        `Before · collections: ${item.beforeCollectionKeys.join(", ") || "none"} · tags: ${item.beforeTagNames.join(", ") || "none"}`,
      ),
      element(
        doc,
        "p",
        item.status === "blocked" ? "pprw-project-warning" : "pprw-muted",
        changes.length
          ? `Approved additions: ${changes.join(", ")}`
          : (item.blockedReason ?? "No additive change is needed."),
      ),
    );
    itemList.append(card);
  }
  container.append(itemList);

  const tokenDisplay = textArea(
    doc,
    "Preview-bound approval token",
    preview.approvalToken,
  );
  tokenDisplay.rows = 2;
  tokenDisplay.readOnly = true;
  tokenDisplay.setAttribute("aria-label", "Preview-bound approval token");
  const tokenInput = textInput(doc, "Enter the exact approval token");
  tokenInput.setAttribute(
    "aria-label",
    "Enter the preview-bound approval token",
  );
  const approval = element(doc, "input", "");
  approval.type = "checkbox";
  const approvalLabel = element(doc, "label", "pprw-check-row");
  approvalLabel.append(
    approval,
    element(
      doc,
      "span",
      "",
      "I reviewed every item and explicitly approve only the additions shown in this exact preview.",
    ),
  );
  const applyButton = button(
    doc,
    "Apply approved additive sync",
    async () => {
      try {
        setMessage(root, "Writing a receipt before the Zotero transaction…");
        await applyResearchWorkspaceZoteroSync({
          preview,
          approvalToken: tokenInput.value.trim(),
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
  );
  const updateApproval = () => {
    applyButton.disabled =
      !preview.summary.additiveItems ||
      !approval.checked ||
      tokenInput.value.trim() !== preview.approvalToken;
  };
  applyButton.disabled = true;
  approval.addEventListener("change", updateApproval);
  tokenInput.addEventListener("input", updateApproval);
  container.append(
    element(doc, "label", "pprw-field-label", "Preview-bound approval token"),
    tokenDisplay,
    element(doc, "label", "pprw-field-label", "Explicit token confirmation"),
    tokenInput,
    approvalLabel,
    applyButton,
  );
  if (!preview.summary.additiveItems) {
    container.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "This preview contains no additive changes, so apply remains disabled.",
      ),
    );
  }
  return container;
}

export function renderZoteroSyncTargets(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  targets: ResearchWorkspaceZoteroSyncTargets,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  navigation: ProjectNavigation,
) {
  const container = element(doc, "div", "pprw-template-preview");
  if (!targets.libraries.length) {
    container.append(
      element(
        doc,
        "p",
        "pprw-project-warning",
        "No existing collection or tag target could be read for this project's libraries.",
      ),
    );
    return container;
  }
  const library = element(doc, "select", "pprw-select");
  library.setAttribute("aria-label", "Zotero sync library");
  for (const target of targets.libraries) {
    const option = element(doc, "option", "", `Library ${target.libraryID}`);
    option.value = String(target.libraryID);
    library.append(option);
  }
  const collection = element(doc, "select", "pprw-select");
  collection.setAttribute("aria-label", "Existing Zotero collection");
  const tags = element(doc, "select", "pprw-select");
  tags.multiple = true;
  tags.size = 6;
  tags.setAttribute("aria-label", "Existing Zotero tags");
  const previewHost = element(doc, "div", "pprw-template-preview");

  const selectedLibrary = () =>
    targets.libraries.find(
      (target) => target.libraryID === Number(library.value),
    );
  const refreshTargets = () => {
    previewHost.replaceChildren();
    const selected = selectedLibrary();
    collection.replaceChildren();
    const none = element(doc, "option", "", "No collection");
    none.value = "";
    collection.append(none);
    for (const entry of selected?.collections ?? []) {
      const option = element(
        doc,
        "option",
        "",
        `${entry.name} (${entry.collectionKey})`,
      );
      option.value = entry.collectionKey;
      collection.append(option);
    }
    tags.replaceChildren();
    for (const tagName of selected?.tagNames ?? []) {
      const option = element(doc, "option", "", tagName);
      option.value = tagName;
      tags.append(option);
    }
  };
  library.addEventListener("change", refreshTargets);
  collection.addEventListener("change", () => previewHost.replaceChildren());
  tags.addEventListener("change", () => previewHost.replaceChildren());
  refreshTargets();

  const buildPreview = button(
    doc,
    "Build full sync preview",
    async () => {
      try {
        const tagNames = (Array.from(tags.options) as HTMLOptionElement[])
          .filter((option) => option.selected)
          .map((option) => option.value);
        setMessage(root, "Reading current Zotero collection and tag state…");
        const preview = await previewResearchWorkspaceZoteroSync({
          projectID: details.project.projectID,
          selection: {
            libraryID: Number(library.value),
            ...(collection.value ? { collectionKey: collection.value } : {}),
            tagNames,
          },
        });
        previewHost.replaceChildren(
          renderZoteroSyncPreview(
            doc,
            root,
            details,
            preview,
            capturedPapers,
            generation,
            navigation,
          ),
        );
        setMessage(
          root,
          "Review the full preview and enter its exact approval token.",
          "success",
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
  );
  container.append(
    element(doc, "label", "pprw-field-label", "Project library target"),
    library,
    element(doc, "label", "pprw-field-label", "Existing collection (optional)"),
    collection,
    element(doc, "label", "pprw-field-label", "Existing tags (optional)"),
    tags,
    buildPreview,
    previewHost,
  );
  if (targets.limitations.length) {
    const limitations = element(doc, "ul", "pprw-render-list");
    for (const limitation of targets.limitations) {
      limitations.append(element(doc, "li", "", limitation));
    }
    container.append(element(doc, "h4", "", "Safety boundaries"), limitations);
  }
  return container;
}

export function renderSafeZoteroSyncPanel(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  receiptFiles: readonly ResearchWorkspaceZoteroSyncReceiptFile[],
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
  receiptWarning: string | undefined,
  navigation: ProjectNavigation,
) {
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-zotero-sync-panel",
  );
  section.append(
    element(doc, "h3", "", "Safe Zotero collection and tag sync"),
    element(
      doc,
      "p",
      "pprw-muted",
      "One-way additive sync only. Paper Pilot can add existing regular Zotero items to an existing collection and associate existing tags after a full preview and explicit approval. It never creates or deletes items, collections, or tags; never writes bibliographic metadata, PDFs, annotations, or Research Workspace artifacts; and fails closed without a Zotero database transaction.",
    ),
    element(
      doc,
      "p",
      "pprw-muted",
      "Every apply is preceded by a separate revisioned write-ahead receipt. Undo removes only additions proven by that receipt and preserves unrelated later changes.",
    ),
  );
  if (receiptWarning) {
    section.append(element(doc, "p", "pprw-project-warning", receiptWarning));
  }
  const targetsHost = element(doc, "div", "pprw-template-preview");
  const loadTargets = button(
    doc,
    "Load existing Zotero targets",
    async () => {
      try {
        setMessage(root, "Loading existing collections and tags…");
        const targets = await listResearchWorkspaceZoteroSyncTargets(
          details.project.projectID,
        );
        targetsHost.replaceChildren(
          renderZoteroSyncTargets(
            doc,
            root,
            details,
            targets,
            capturedPapers,
            generation,
            navigation,
          ),
        );
        setMessage(root, "Existing Zotero targets loaded.", "success");
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
    true,
  );
  loadTargets.disabled = Boolean(receiptWarning);
  if (receiptWarning) loadTargets.dataset.disabled = "true";
  section.append(
    loadTargets,
    targetsHost,
    element(doc, "h4", "", `Write-ahead receipts · ${receiptFiles.length}`),
  );
  const receipts = element(doc, "div", "pprw-artifact-history");
  for (const file of receiptFiles) {
    const receipt = file.receipt;
    const card = element(doc, "article", "pprw-artifact-card");
    card.append(
      element(doc, "strong", "", receipt.receiptID),
      element(
        doc,
        "span",
        "pprw-artifact-status",
        `${receipt.status} · revision ${file.revision}`,
      ),
      element(
        doc,
        "p",
        "pprw-muted",
        `${receipt.plannedItems.length} planned items · library ${receipt.selection.libraryID} · ${new Date(receipt.createdAt).toLocaleString()}`,
      ),
    );
    if (receipt.error) {
      card.append(element(doc, "p", "pprw-project-warning", receipt.error));
    }
    for (const result of receipt.applyResults ?? []) {
      const additions = [
        result.collectionAdded ? "collection" : "",
        ...result.tagNamesAdded.map((tagName) => `tag:${tagName}`),
      ].filter(Boolean);
      card.append(
        element(
          doc,
          "p",
          "pprw-muted",
          `${result.libraryID}:${result.itemKey} · ${result.status} · ${additions.join(", ") || "no owned addition"}${result.notifierDataIncluded ? " · PaperPilot-originated notifier data included" : ""}`,
        ),
      );
    }
    for (const result of receipt.undoResults ?? []) {
      const removals = [
        result.collectionRemoved ? "collection" : "",
        ...result.tagNamesRemoved.map((tagName) => `tag:${tagName}`),
      ].filter(Boolean);
      card.append(
        element(
          doc,
          "p",
          result.status === "blocked" || result.status === "failed"
            ? "pprw-project-warning"
            : "pprw-muted",
          `Undo ${result.libraryID}:${result.itemKey} · ${result.status} · ${removals.join(", ") || result.message || "no owned state remained"}`,
        ),
      );
    }
    if (receipt.status === "prepared") {
      card.append(
        element(
          doc,
          "p",
          "pprw-project-warning",
          "This receipt has no committed per-item ownership result. Do not reapply the same preview; undo remains disabled to fail closed.",
        ),
      );
    }
    if (
      receipt.status === "committed" ||
      receipt.status === "partially-undone"
    ) {
      card.append(
        button(doc, "Undo receipt-owned additions", async () => {
          const confirmed =
            doc.defaultView?.confirm(
              "Undo only the collection and tag additions owned by this receipt? Unrelated Zotero state will be preserved.",
            ) ?? false;
          if (!confirmed) return;
          try {
            setMessage(root, "Undoing only receipt-owned additions…");
            await undoResearchWorkspaceZoteroSync({
              projectID: details.project.projectID,
              receiptID: receipt.receiptID,
              expectedRevision: file.revision,
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
        }),
      );
    }
    receipts.append(card);
  }
  if (!receiptFiles.length) {
    receipts.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No sync receipt exists. A prepared receipt is written before any approved transaction.",
      ),
    );
  }
  section.append(receipts);
  return section;
}
