import { academicDraft } from "./academicDraft";
import { SuperDoc, DOCX } from "@paperpilot/studio-editor";
import { isCommentMutation } from "./docxEvents";
import { docxStructure } from "./docxStructure";
import type {
  StudioDocument,
  StudioManifest,
  StudioVersion,
  StudioInsertion,
} from "./contracts";
import { MAX_DOCUMENT_BYTES } from "./contracts";
import { SaveCoordinator } from "./saveCoordinator";
import { sourceEditor } from "./sourceEditor";
import { dataEditor } from "./dataEditor";
import type { TextSurface } from "./dom";
import { notebookEditor } from "./notebookEditor";
import { parseNotebook } from "./notebook";
import { documentHash } from "./documentHash";
import { projectGraph } from "./projectGraph";
import type { StudioRepository } from "./repository";
import {
  notebookOutputHash,
  outputFreshness,
  type OutputOrigin,
} from "./outputProvenance";
import { newNotebook } from "./notebook";
import type { KernelResult } from "./kernelBroker";
import { aiPanel } from "./aiPanel";
import type { StudioChange, StudioConversation } from "./aiContracts";
import { TEXT_DOCUMENT } from "./aiContracts";
import { newBoard } from "./board";
import { boardEditor } from "./boardEditor";
import { referencePanel } from "./referencePanel";
import { insertWordCitation, refreshWordReferences } from "./docxReferences";
import type { CompileResult } from "./compiler";
import { pdfPreview } from "./pdfPreview";
import { MAX_BACKUP_TEXT } from "./backup";
import {
  NEW_DOCUMENT_EXTENSION,
  baseName,
  documentFormat,
  extensionOf,
  newDocumentName,
  type TemplateChoice,
} from "./documentTemplates";
import { newDocumentDialog } from "./newDocumentDialog";
import {
  figureMarkup,
  draftTable,
  tableMarkup,
  docxTable,
} from "./draftAssets";

const channel = location.hash.slice(1);
let hostPort: MessagePort | undefined;
let connectHost: (port: MessagePort) => void;
const connected = new Promise<MessagePort>((resolve) => {
  connectHost = resolve;
});
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: number;
  }
>();
function receive(event: MessageEvent) {
  const message = event.data;
  if (
    message?.channel !== channel ||
    message?.protocol !== "paperpilot-studio/1"
  )
    return;
  const call = pending.get(message.id);
  if (!call) return;
  pending.delete(message.id);
  clearTimeout(call.timer);
  if (message.error) call.reject(new Error(message.error));
  else call.resolve(message.result);
}
window.addEventListener("message", (event) => {
  // The host transfers one project-bound capability. The unguessable channel
  // is supplied in this frame's URL; no content-to-chrome window access needed.
  if (
    hostPort ||
    event.data?.protocol !== "paperpilot-studio/1" ||
    event.data?.channel !== channel ||
    event.data?.method !== "connect" ||
    event.ports.length !== 1
  )
    return;
  hostPort = event.ports[0];
  hostPort.onmessage = receive;
  hostPort.start();
  connectHost(hostPort);
});

function request<T>(method: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(
      () => {
        pending.delete(id);
        reject(
          new Error(
            "The project did not confirm this operation. Your edits remain open.",
          ),
        );
      },
      method === "ai.ask" || method === "compiler.build"
        ? 300000
        : method.startsWith("kernel.") || method.startsWith("backup.")
          ? 180000
          : 30000,
    );
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    void connected
      .then((port) => {
        if (pending.has(id))
          port.postMessage({
            protocol: "paperpilot-studio/1",
            channel,
            id,
            method,
            payload,
          });
      })
      .catch((error) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
  });
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function button(label: string, action: () => Promise<unknown> | unknown) {
  const item = node("button", label);
  item.type = "button";
  item.addEventListener("click", () => {
    // File pickers need the original user activation, including in sandboxed frames.
    try {
      void Promise.resolve(action()).catch(showError);
    } catch (error) {
      showError(error);
    }
  });
  return item;
}

const shell = node("main", undefined, "studio");
const header = node("header", undefined, "studio-header");
const title = node("h1", "Project documents");
const status = node("output", "Opening project…");
status.setAttribute("aria-live", "polite");
const filesButton = button("Hide files", () => {
  const hidden = shell.classList.toggle("files-hidden");
  filesButton.textContent = hidden ? "Show files" : "Hide files";
  filesButton.setAttribute("aria-expanded", String(!hidden));
});
filesButton.setAttribute("aria-expanded", "true");
filesButton.setAttribute("aria-controls", "studio-files");
const assistantButton = button("Assistant", () => {
  references.close(false);
  return assistant.open(assistantButton);
});
const referencesButton = button("References", () => {
  assistant.close(false);
  return references.open(referencesButton);
});
referencesButton.title =
  "Cite this project's Zotero papers and build a bibliography.";
assistantButton.title =
  "Ask about project files and papers. Edits arrive as proposals you approve.";
header.append(filesButton, title, referencesButton, assistantButton);
const sidebar = node("aside", undefined, "files");
sidebar.setAttribute("aria-label", "Project files");
sidebar.id = "studio-files";
sidebar.inert = true;
const importInput = node("input");
importInput.type = "file";
importInput.multiple = true;
importInput.hidden = true;
const backupInput = node("input");
let restoringProject = false;
backupInput.type = "file";
backupInput.accept = ".json";
backupInput.hidden = true;
backupInput.addEventListener("change", () => {
  void documentOperation(async () => {
    const file = backupInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_TEXT)
      throw new Error("Document backups must be at most 96 MiB.");
    await request(
      restoringProject ? "backup.project.restore" : "backup.restore",
      { text: await file.text() },
    );
    destroyEditor();
    active = undefined;
    await refresh();
    backupDialog.close();
    status.textContent = restoringProject
      ? "Project documents and conversation history restored. Historical research records are in imports/project-context…json; bind Zotero sources explicitly before using them as current evidence."
      : "Document backup restored with original versions and archive state.";
  })
    .catch(showError)
    .finally(() => {
      backupInput.value = "";
    });
});
const backupDetails = node("details");
backupDetails.append(
  node("summary", "Local backups"),
  node(
    "p",
    "Project bundles include all document versions, archived files, conversations and research record snapshots. Restore into a new project. Imported research records remain historical until sources are explicitly rebound in Research Workspace. Zotero attachment bytes, runtime packages and credentials are separate; import PDFs as project files to include them. Document-only backups omit live conversations and research records.",
    "surface-notice",
  ),
  button("Back up documents", () =>
    documentOperation(async () => {
      const result = await request<{ path: string }>("backup.export");
      status.textContent = `Document backup saved to ${result.path}`;
      revealButton.hidden = false;
      backupDialog.close();
    }),
  ),
  button("Back up local project", () =>
    documentOperation(async () => {
      const result = await request<{ path: string }>("backup.project.export");
      status.textContent = `Local project bundle saved to ${result.path}`;
      revealButton.hidden = false;
      backupDialog.close();
    }),
  ),
  button("Restore local project…", () => {
    restoringProject = true;
    backupInput.click();
  }),
  button("Restore document backup…", () => {
    restoringProject = false;
    backupInput.click();
  }),
  backupInput,
);
const fileList = node("nav");
const fileSearch = node("input");
fileSearch.type = "search";
fileSearch.placeholder = "Find a file…";
fileSearch.setAttribute("aria-label", "Find project files");
fileSearch.addEventListener("input", renderFiles);
const fileCount = node("span", "Files", "file-count");
const newDocument = newDocumentDialog({
  documents: () => manifest?.documents ?? [],
  create: ({ name, template }) => createDocument(name, template),
});
/** Opens the new-document dialog, optionally with a format chosen. */
function showNewDocument(extension?: string) {
  newDocument.open(extension);
}
fileList.setAttribute("aria-label", "Documents");
const archivedToggle = node("input");
archivedToggle.type = "checkbox";
const archivedLabel = node("label", " Show archived");
archivedLabel.prepend(archivedToggle);
archivedToggle.addEventListener("change", () => renderFiles());
const fileHeading = node("div", undefined, "file-heading");
fileHeading.append(fileCount, archivedLabel);
const fileCommands = node("div", undefined, "file-commands");
const newButton = button("New document", () => showNewDocument());
newButton.className = "primary";
fileCommands.append(
  newButton,
  button("Import…", () => importInput.click()),
);
const projectTools = node("div", undefined, "project-tools");
const backupDialog = node("dialog", undefined, "file-dialog");
backupDialog.setAttribute("aria-label", "Local project backups");
backupDetails.open = true;
const backupError = node("p", undefined, "dialog-error");
backupError.setAttribute("role", "alert");
backupDialog.append(
  backupDetails,
  backupError,
  button("Close backups", () => backupDialog.close()),
);
projectTools.append(
  button("Project links", async () => {
    await save();
    const links =
      await request<Awaited<ReturnType<StudioRepository["links"]>>>("links");
    projectGraph(links, active?.id, (id) => openDocument(id).catch(showError));
  }),
  button("Backups…", () => backupDialog.showModal()),
);
sidebar.append(
  fileCommands,
  fileSearch,
  fileHeading,
  fileList,
  projectTools,
  importInput,
);
const content = node("section", undefined, "studio-document");
const actions = node("div", undefined, "document-actions");
actions.hidden = true;
const documentName = node("h2", "Choose a document", "document-title");
const saveStatus = node("span", "", "save-state");
saveStatus.setAttribute("aria-live", "polite");
const identity = node("div", undefined, "document-identity");
identity.append(documentName, saveStatus);
const saveButton = button("Save", () => save());
const exportButton = button("Export", () =>
  documentOperation(async () => {
    if (!active) return;
    const result = await request<{ path: string }>("export", { id: active.id });
    status.textContent = `Exported to ${result.path}`;
    revealButton.hidden = false;
  }),
);
const revealButton = button("Show exported file", () => request("reveal"));
revealButton.hidden = true;
const historyButton = button("History", () => showHistory());
const commentButton = button("Add comment", () => {
  const target = editor?.activeEditor;
  if (!target || target.state.selection.empty)
    throw new Error("Select document text before adding a comment.");
  const owner = generation;
  const dialog = node("dialog");
  dialog.setAttribute("aria-label", "New document comment");
  const input = node("textarea");
  input.setAttribute("aria-label", "Comment text");
  input.maxLength = 10000;
  input.rows = 5;
  const error = node("p");
  error.setAttribute("role", "alert");
  dialog.append(
    node("h2", "Comment on selected text"),
    input,
    error,
    button("Save comment", () => {
      if (owner !== generation || editor?.activeEditor !== target) {
        dialog.close();
        return;
      }
      if (!input.value.trim()) {
        error.textContent = "Enter a comment.";
        return;
      }
      const commands = target.commands as unknown as {
        addComment(content: string): boolean;
      };
      if (!commands.addComment(input.value.trim())) {
        error.textContent = "Select document text and try again.";
        return;
      }
      dialog.close();
    }),
    button("Cancel comment", () => dialog.close()),
  );
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
});
const assetChoice = node("select");
assetChoice.setAttribute("aria-label", "Project figure or table");
const insertAssetButton = button("Insert figure / table", () => insertAsset());
const buildButton = button("Build PDF", () => buildPDF());
const cancelBuildButton = button("Cancel build", () =>
  request("compiler.cancel"),
);
cancelBuildButton.hidden = true;
const sourceButton = button(
  "Source view",
  () => active && openDocument(active.id, !sourceMode),
);
const duplicateButton = button("Duplicate", async () => {
  let created: StudioDocument | undefined;
  await documentOperation(async () => {
    if (!active) return;
    const saved = await request<{ base64: string }>("read", { id: active.id });
    const name = active.name.replace(/(\.[^./]+)?$/, " copy$1");
    created = await request<StudioDocument>("create", {
      name,
      base64: saved.base64,
    });
    await refresh();
  });
  if (created) await openDocument(created.id);
});
const renameButton = button("Rename / move…", () => {
  if (!active) return;
  const targetID = active.id;
  const dialog = node("dialog", undefined, "file-dialog");
  dialog.setAttribute("aria-label", "Rename document");
  const input = node("input");
  input.value = active.name;
  input.setAttribute("aria-label", "Document name");
  const error = node("p", undefined, "dialog-error");
  error.setAttribute("role", "alert");
  const confirm = button("Rename", async () => {
    assertCanNavigate();
    const asSource = sourceMode;
    let renamed: StudioDocument | undefined;
    await documentOperation(async () => {
      if (!active || active.id !== targetID)
        throw new Error("The open document changed.");
      renamed = await request<StudioDocument>("rename", {
        id: active.id,
        expectedRevision: active.revision,
        name: input.value,
      });
      // Moving a text draft can rebase its links. Keep the old editor's
      // revision until those persisted bytes are loaded, so a failed reload
      // cannot authorize stale editor text to overwrite the repaired links.
      await refresh();
    });
    if (!renamed) return;
    await openDocument(renamed.id, asSource);
    delete status.dataset.error;
    status.textContent = `Renamed to ${renamed.name}`;
    dialog.close();
  });
  dialog.append(
    node("h2", "Rename or move"),
    node(
      "p",
      "Use / for folders. Keep the file extension; linked paths update with the rename.",
      "dialog-hint",
    ),
    input,
    error,
    confirm,
    button("Cancel", () => dialog.close()),
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm.click();
    }
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      moreSummary.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  input.select();
});
const templateButton = button("Save as template…", () => {
  if (!active) return;
  const source = active;
  const extension = extensionOf(source.name);
  const dialog = node("dialog", undefined, "file-dialog");
  dialog.setAttribute("aria-label", "Save as template");
  const input = node("input");
  input.value = baseName(source.name);
  input.setAttribute("aria-label", "Template name");
  const error = node("p", undefined, "dialog-error");
  error.setAttribute("role", "alert");
  const confirm = button("Save template", async () => {
    assertCanNavigate();
    const entered = input.value.trim().replace(/^templates\//, "");
    if (!entered) throw new Error("Enter a template name.");
    const name = newDocumentName(
      `templates/${entered}`,
      extension,
      baseName(source.name),
      manifest.documents.map((doc) => doc.name),
    );
    if (extensionOf(name) !== extension)
      throw new Error(
        "Keep the document's file extension; changing it does not convert the document.",
      );
    let saved = false;
    await documentOperation(async () => {
      if (active?.id !== source.id)
        throw new Error("The open document changed.");
      const current = await request<{ base64: string }>("read", {
        id: source.id,
      });
      await request("create", { name, base64: current.base64 });
      await refresh();
      saved = true;
    });
    if (!saved) return;
    delete status.dataset.error;
    status.textContent = `Template saved: ${name}. New ${extension.toUpperCase()} documents can start from it.`;
    dialog.close();
  });
  confirm.className = "primary";
  const actionsRow = node("div", undefined, "dialog-actions");
  actionsRow.append(
    button("Cancel", () => dialog.close()),
    confirm,
  );
  dialog.append(
    node("h2", "Save as template"),
    node(
      "p",
      `The saved version of ${source.name} is copied to templates/. The New document dialog offers it for ${extension.toUpperCase()} files.`,
      "dialog-hint",
    ),
    input,
    error,
    actionsRow,
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm.click();
    }
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      moreSummary.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  input.select();
});
const archiveButton = button("Archive", () =>
  documentOperation(async () => {
    assertCanNavigate();
    if (!active) return;
    await request("archive", {
      id: active.id,
      expectedRevision: active.revision,
      archived: true,
    });
    destroyEditor();
    active = undefined;
    await refresh();
  }),
);
const moreActions = node("details", undefined, "action-menu");
const moreSummary = node("summary", "More");
const moreList = node("div", undefined, "action-menu-items");
const provenanceButton = button(
  "Output provenance",
  () => active && showOutputOrigin(active.id),
);
moreList.append(
  historyButton,
  renameButton,
  duplicateButton,
  templateButton,
  sourceButton,
  provenanceButton,
  archiveButton,
);
moreActions.append(moreSummary, moreList);
moreList.addEventListener("click", (event) => {
  if ((event.target as Element).closest("button")) moreActions.open = false;
});
moreActions.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    moreActions.open = false;
    moreSummary.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!moreActions.contains(event.target as Node)) moreActions.open = false;
});
const toolsButton = button("Insert & review", () => {
  documentTools.hidden = !documentTools.hidden;
  toolsButton.setAttribute("aria-expanded", String(!documentTools.hidden));
});
toolsButton.setAttribute("aria-expanded", "false");
toolsButton.setAttribute("aria-controls", "document-tools");
actions.append(
  identity,
  toolsButton,
  buildButton,
  cancelBuildButton,
  saveButton,
  exportButton,
  moreActions,
);
const toolbar = node("div");
toolbar.id = "docx-toolbar";
toolbar.hidden = true;
const editorHost = node("div", undefined, "studio-editor");
editorHost.id = "docx-editor";
const history = node("dialog", undefined, "history");
history.setAttribute("aria-label", "Document history");
history.addEventListener("close", () => moreSummary.focus());
const buildReport = node("details", undefined, "build-report");
buildReport.hidden = true;
const buildSummary = node("summary", "Build log");
const buildLog = node("pre");
const buildOutput = node("div");
buildReport.append(buildSummary, buildOutput, buildLog);
const assetTools = node("details");
assetTools.className = "draft-assets";
assetTools.append(
  node("summary", "Insert project output"),
  node(
    "p",
    "Choose a saved figure or data table. DOCX embeds a snapshot; source documents link image files or insert table text.",
    "surface-notice",
  ),
  assetChoice,
  insertAssetButton,
  button(
    "Inspect output origin",
    () => assetChoice.value && showOutputOrigin(assetChoice.value),
  ),
  button("Inserted output history", () => showInsertionHistory()),
);
const structure = docxStructure(
  () => editor?.activeEditor ?? undefined,
  changed,
);
const documentTools = node("div", undefined, "document-tools");
documentTools.id = "document-tools";
documentTools.hidden = true;
documentTools.append(commentButton, assetTools, structure.element);
const welcome = node("section", undefined, "studio-welcome");
welcome.inert = true;
/** A start card: a title and one line about what it opens. */
function welcomeCard(
  heading: string,
  text: string,
  action: () => unknown,
): HTMLButtonElement {
  const card = node("button", undefined, "welcome-card");
  card.type = "button";
  card.append(node("strong", heading), node("span", text));
  card.addEventListener("click", () => {
    void Promise.resolve(action()).catch(showError);
  });
  return card;
}
const welcomeCards = node("div", undefined, "welcome-cards");
welcomeCards.append(
  welcomeCard(
    "Write a draft",
    "Word, Markdown, LaTeX, Typst or MyST. Start blank or from an article template.",
    () => showNewDocument("docx"),
  ),
  welcomeCard(
    "Cite your papers",
    "Insert citations and a bibliography from this project's Zotero papers.",
    () => referencesButton.click(),
  ),
  welcomeCard(
    "Ask the assistant",
    "Ask about your files and papers. Edits arrive as proposals you approve.",
    () => assistantButton.click(),
  ),
  welcomeCard(
    "Analyze data",
    "A Python or R notebook whose figures and tables can go into a draft.",
    () => showNewDocument("ipynb"),
  ),
  welcomeCard(
    "Plan the work",
    "A board for tasks, reading, and screening.",
    () => showNewDocument("kanban"),
  ),
  welcomeCard(
    "Import files",
    "Bring in DOCX, PDF, data, or images from this computer.",
    () => importInput.click(),
  ),
);
welcome.append(
  node("h2", "Write up this project"),
  node(
    "p",
    "Drafts, data, and notebook results stay together with the project's papers on this computer. Start with one of these, or open a file on the left.",
  ),
  welcomeCards,
  node(
    "p",
    "Shortcuts: Ctrl or ⌘ + S saves. Ctrl or ⌘ + P finds a file.",
    "welcome-shortcuts",
  ),
);
const statusBar = node("footer", undefined, "studio-status");
statusBar.append(status, revealButton);
content.append(
  actions,
  documentTools,
  welcome,
  buildReport,
  toolbar,
  editorHost,
  statusBar,
);
shell.append(header, sidebar, content);
document.body.replaceChildren(
  shell,
  newDocument.element,
  backupDialog,
  history,
);

let manifest: StudioManifest;
let active: StudioDocument | undefined;
let editor: SuperDoc | undefined;
let textEditor: TextSurface | undefined;
let editRevision = 0;
let savedEditRevision = 0;
let switching = false;
let ready = false;
let timer: number | undefined;
let generation = 0;
let sourceMode = false;
let imageURL: string | undefined;
let closePDF: (() => void) | undefined;
let building = false;
let pendingInsertions: StudioInsertion[] = [];
const collapsedFolders = new Set<string>();
const assistant = aiPanel(shell, {
  request,
  documents: () => manifest?.documents ?? [],
  activeID: () => active?.id,
  selection: () => {
    if (!active) return undefined;
    let text = textEditor?.selectedText() ?? "";
    const engine = editor?.activeEditor;
    if (engine)
      text = engine.state.doc.textBetween(
        engine.state.selection.from,
        engine.state.selection.to,
        "\n",
      );
    if (/\.pdf$/i.test(active.name)) {
      const selection = window.getSelection();
      if (selection?.anchorNode && editorHost.contains(selection.anchorNode))
        text = selection.toString();
    }
    return { id: active.id, name: active.name, text };
  },
  save,
  apply: applyAIChange,
});
const references = referencePanel(shell, {
  request,
  documents: () => manifest?.documents ?? [],
  activeName: () => active?.name,
  activeID: () => active?.id,
  save,
  create: async (name, text) => {
    await request("create", {
      name,
      base64: toBase64(new TextEncoder().encode(text)),
    });
    await refresh();
  },
  wordReferences: async (records, style, xml, bibliography, targetID) => {
    assertCanNavigate();
    if (
      !targetID ||
      active?.id !== targetID ||
      !ready ||
      active.archived ||
      !editor?.activeEditor
    )
      throw new Error(
        "Open an editable DOCX draft before using Word citation fields.",
      );
    await documentOperation(async () => {
      const engine = editor!.activeEditor!;
      if (!bibliography) await insertWordCitation(engine, records);
      refreshWordReferences(engine, style, xml, bibliography);
      changed();
      await save();
    });
  },
  insert: async (text, targetID) => {
    assertCanNavigate();
    if (!targetID || active?.id !== targetID || !ready || active.archived)
      throw new Error("Open an editable draft before inserting a reference.");
    if (switching) throw new Error("Wait for the current document operation.");
    await documentOperation(async () => {
      if (active?.id !== targetID)
        throw new Error("The target document changed. Select the draft again.");
      if (editor?.activeEditor) {
        const engine = editor.activeEditor;
        const commands = (
          engine as unknown as {
            commands: {
              insertContentAt(
                range: { from: number; to: number },
                text: string,
                options: { asText: boolean },
              ): boolean;
            };
          }
        ).commands;
        if (
          !commands.insertContentAt(
            {
              from: engine.state.selection.from,
              to: engine.state.selection.to,
            },
            text,
            { asText: true },
          )
        )
          throw new Error("The editor rejected the citation insertion.");
      } else if (textEditor) textEditor.insert(text);
      else throw new Error("This document does not accept text insertions.");
      changed();
      await save();
    });
  },
});

function showError(error: unknown) {
  status.textContent = error instanceof Error ? error.message : String(error);
  status.dataset.error = "true";
  const dialogError = document.querySelector("dialog[open] .dialog-error");
  if (dialogError) dialogError.textContent = status.textContent;
}

function dirty(value: boolean) {
  hostPort?.postMessage({
    protocol: "paperpilot-studio/1",
    channel,
    method: "dirty",
    dirty: value,
  });
}

function changed() {
  if (!ready) return;
  editRevision++;
  dirty(true);
  updateActions();
  status.textContent = "Unsaved changes";
  delete status.dataset.error;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    void save().catch(showError);
  }, 1500);
}

function toBase64(bytes: Uint8Array<ArrayBufferLike>) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

function fromBase64(base64: string) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function refresh() {
  const result = await request<{ name: string; manifest: StudioManifest }>(
    "list",
  );
  title.textContent = result.name;
  manifest = result.manifest;
  sidebar.inert = false;
  welcome.inert = false;
  const selectedAsset = assetChoice.value;
  assetChoice.replaceChildren();
  for (const entry of manifest.documents.filter(
    (doc) => !doc.archived && /\.(png|jpe?g|csv|tsv|jsonl)$/i.test(doc.name),
  )) {
    const option = node("option", entry.name);
    option.value = entry.id;
    assetChoice.append(option);
  }
  if (
    [...assetChoice.options].some(
      (option) => option.getAttribute("value") === selectedAsset,
    )
  )
    assetChoice.value = selectedAsset;
  renderFiles();
  assistant.refresh();
  updateActions();
}

function renderFiles() {
  const scrollTop = fileList.scrollTop;
  fileList.replaceChildren();
  const query = fileSearch.value.trim().toLocaleLowerCase();
  const visible = manifest.documents
    .filter(
      (item) =>
        item.archived === archivedToggle.checked &&
        item.name.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  fileCount.textContent = `${archivedToggle.checked ? "Archived" : "Files"} (${visible.length})`;
  const folders = new Map<string, HTMLElement>();
  for (const doc of visible) {
    const parts = doc.name.split("/");
    let parent: HTMLElement = fileList;
    for (let index = 0; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        const details = node("details", undefined, "file-folder");
        details.open = !!query || !collapsedFolders.has(path);
        details.addEventListener("toggle", () => {
          if (query) return;
          if (details.open) collapsedFolders.delete(path);
          else collapsedFolders.add(path);
        });
        folder = node("div");
        details.append(node("summary", parts[index]), folder);
        parent.append(details);
        folders.set(path, folder);
      }
      parent = folder;
    }
    const basename = parts.at(-1) ?? doc.name;
    const item = button(basename, () => openDocument(doc.id));
    const label = node("span", basename, "file-name");
    const kind = node(
      "span",
      (basename.split(".").at(-1) || "FILE").toUpperCase(),
      "file-kind",
    );
    item.replaceChildren(label, kind);
    item.setAttribute("aria-label", doc.name);
    item.title = doc.name;
    item.className = doc.id === active?.id ? "selected" : "";
    item.setAttribute("aria-current", doc.id === active?.id ? "page" : "false");
    parent.append(item);
  }
  if (!fileList.childElementCount)
    fileList.append(
      node(
        "p",
        query
          ? "No matching files. Try another name."
          : archivedToggle.checked
            ? "No archived files."
            : "Import a file or create a document.",
      ),
    );
  fileList.scrollTop = scrollTop;
}

function updateActions() {
  welcome.hidden = !!active || switching;
  content.classList.toggle("empty-workspace", !active && !switching);
  content.setAttribute("aria-busy", String(switching));
  actions.hidden = !active;
  references.refresh();
  toolbar.hidden = !active || !/\.docx$/i.test(active.name);
  documentName.textContent =
    active?.name.split("/").at(-1) ?? "Choose a document";
  documentName.title = active?.name ?? "";
  saveStatus.textContent = !active
    ? ""
    : saveCoordinator.pending
      ? "Saving…"
      : editRevision !== savedEditRevision
        ? "Unsaved changes"
        : `${active.archived ? "Archived" : "Saved"} · v${active.revision}`;
  saveStatus.dataset.state =
    editRevision !== savedEditRevision ? "dirty" : "saved";
  toolsButton.hidden =
    !active || !/\.(docx|md|markdown|myst|tex|typ)$/i.test(active.name);
  toolsButton.disabled = switching || !ready || active?.archived === true;
  if (toolsButton.hidden) {
    documentTools.hidden = true;
    toolsButton.setAttribute("aria-expanded", "false");
  }
  sourceButton.hidden =
    !active || !/\.(csv|tsv|jsonl|ipynb|kanban)$/i.test(active.name);
  buildButton.hidden =
    !active || !/\.(tex|typ|md|markdown|myst)$/i.test(active.name);
  provenanceButton.hidden = !active?.versions.at(-1)?.origin;
  archiveButton.hidden = active?.archived === true;
  templateButton.hidden =
    !active || active.archived || !documentFormat(extensionOf(active.name));
  structure.element.hidden = !active || !/\.docx$/i.test(active.name);
  structure.element.inert = switching || !ready || active?.archived === true;
  commentButton.hidden = !active || !/\.docx$/i.test(active.name);
  commentButton.disabled = switching || !ready || active?.archived === true;
  assetChoice.disabled = insertAssetButton.disabled =
    switching ||
    !active ||
    active.archived ||
    !/\.(docx|md|markdown|myst|tex|typ)$/i.test(active.name) ||
    !assetChoice.options.length;
  editorHost.inert = switching;
  toolbar.inert = switching;
  for (const item of [
    saveButton,
    exportButton,
    historyButton,
    renameButton,
    archiveButton,
    duplicateButton,
    templateButton,
  ])
    item.disabled = switching || !active;
  saveButton.disabled ||=
    !ready || saveCoordinator.pending || active?.archived === true;
  sourceButton.disabled =
    switching || !active || !TEXT_DOCUMENT.test(active.name);
  sourceButton.textContent = sourceMode ? "Editor view" : "Source view";
  buildButton.disabled =
    switching ||
    building ||
    !active ||
    active.archived ||
    !/\.(tex|typ|md|markdown|myst)$/i.test(active.name);
  cancelBuildButton.hidden = !building;
}

async function insertAsset() {
  assertCanNavigate();
  await documentOperation(async () => {
    if (!active || active.archived || !ready)
      throw new Error("Open an editable draft first.");
    const asset = await request<{ document: StudioDocument; base64: string }>(
      "read",
      { id: assetChoice.value },
    );
    if (/\.(png|jpe?g)$/i.test(asset.document.name)) {
      if (editor?.activeEditor) {
        const src = `data:image/${/\.png$/i.test(asset.document.name) ? "png" : "jpeg"};base64,${asset.base64}`;
        const image = new Image();
        image.src = src;
        await image.decode();
        if (image.naturalWidth * image.naturalHeight > 25000000)
          throw new Error("Use an image smaller than 25 megapixels.");
        const width = Math.min(500, image.naturalWidth);
        if (
          !(editor.activeEditor.commands as any).setImage({
            src,
            alt: asset.document.name,
            size: {
              width,
              height: (width * image.naturalHeight) / image.naturalWidth,
            },
          })
        )
          throw new Error("The editor could not insert this figure.");
      } else textEditor?.insert(figureMarkup(active.name, asset.document.name));
    } else {
      const rows = draftTable(
        asset.document.name,
        new TextDecoder("utf-8", { fatal: true }).decode(
          fromBase64(asset.base64),
        ),
      );
      if (editor?.activeEditor) {
        if (
          !(editor.activeEditor.commands as any).insertContent(docxTable(rows))
        )
          throw new Error("The editor could not insert this table.");
      } else textEditor?.insert(tableMarkup(active.name, rows));
    }
    pendingInsertions.push({
      id: crypto.randomUUID(),
      assetID: asset.document.id,
      assetRevision: asset.document.versions.at(-1)!.revision,
      insertedAt: new Date().toISOString(),
    });
    changed();
    await save();
  });
}

async function buildPDF() {
  if (building || !active) return;
  assertCanNavigate();
  building = true;
  updateActions();
  buildReport.hidden = false;
  buildReport.open = true;
  buildOutput.replaceChildren();
  buildSummary.textContent = "Building PDF…";
  buildLog.textContent =
    "Uses the installed compiler and saved project files. Missing packages or templates may be downloaded. MyST project plugins can run locally; build only projects you trust. Notebook execution is disabled.";
  try {
    let source: StudioDocument | undefined;
    await documentOperation(async () => {
      source = active;
    });
    if (!source) return;
    const result = await request<CompileResult>("compiler.build", {
      id: source.id,
      expectedRevision: source.revision,
    });
    buildSummary.textContent = `${result.status === "complete" ? "PDF built" : result.status === "canceled" ? "Build canceled" : "Build failed"} · ${result.source.name} · revision ${result.source.revision}`;
    buildLog.textContent = result.log || "No compiler diagnostics.";
    if (result.output) {
      const output = result.output;
      buildOutput.append(button("Open PDF", () => openDocument(output.id)));
    }
    buildOutput.append(
      button("Save build report", async () => {
        await request("create", {
          name: `exports/build-${crypto.randomUUID()}.json`,
          base64: toBase64(
            new TextEncoder().encode(JSON.stringify(result, null, 2)),
          ),
        });
        await refresh();
      }),
    );
    await refresh();
  } catch (error) {
    buildSummary.textContent = "Build failed";
    buildLog.textContent = String(error);
  } finally {
    building = false;
    updateActions();
  }
}

function destroyEditor() {
  pendingInsertions = [];
  ready = false;
  generation++;
  clearTimeout(timer);
  editor?.destroy();
  editor = undefined;
  textEditor?.destroy();
  textEditor = undefined;
  closePDF?.();
  closePDF = undefined;
  editorHost.replaceChildren();
  toolbar.replaceChildren();
  if (imageURL) URL.revokeObjectURL(imageURL);
  imageURL = undefined;
  history.close();
}

async function mountDocx(bytes?: Uint8Array<ArrayBufferLike>) {
  const owner = generation;
  return new Promise<void>((resolve, reject) => {
    const deadline = window.setTimeout(
      () =>
        reject(
          new Error(
            "DOCX editor did not become ready. Your saved file is unchanged.",
          ),
        ),
      30000,
    );
    const failed = ({ error }: { error: unknown }) => {
      clearTimeout(deadline);
      reject(error);
      showError(error);
    };
    editor = new SuperDoc({
      selector: editorHost,
      toolbar: "#docx-toolbar",
      modules: {
        toolbar: { responsiveToContainer: true },
        comments: {
          displayMode: "auto",
          compactMeasurementSelector: "#docx-editor",
        },
      },
      document: bytes
        ? new Blob([bytes as BlobPart], { type: DOCX })
        : undefined,
      telemetry: { enabled: false },
      user: { id: "paperpilot-local", name: "You" },
      contained: true,
      zoom: { mode: "fit-width" },
      onReady: () => {
        clearTimeout(deadline);
        if (owner !== generation) return;
        ready = true;
        if (structure.element.open) {
          try {
            structure.refresh();
          } catch (error) {
            showError(error);
          }
        }
        resolve();
      },
      onTransaction: ({ transaction }) => {
        if (transaction.docChanged) changed();
      },
      onCommentsUpdate: (event) => {
        // Imported tracked-change bubbles are hydrated after onReady. Their
        // content lives in document transactions; hydrating a bubble is no edit.
        if (isCommentMutation(event)) changed();
      },
      onException: failed,
      onContentError: failed,
    });
  });
}

async function openDocument(id: string, asSource = false) {
  if (switching) return;
  assertCanNavigate();
  switching = true;
  updateActions();
  try {
    await save();
    const result = await request<{ document: StudioDocument; base64: string }>(
      "read",
      { id },
    );
    destroyEditor();
    active = result.document;
    sourceMode = asSource;
    updateActions();
    status.textContent = `Opening ${active.name}…`;
    documentName.textContent = active.name;
    documentTools.hidden = true;
    toolsButton.setAttribute("aria-expanded", "false");
    editRevision = savedEditRevision = 0;
    dirty(false);
    const bytes = fromBase64(result.base64);
    if (/\.docx$/i.test(active.name)) {
      await mountDocx(bytes);
      if (active.archived) editor?.setDocumentMode("viewing");
    } else if (
      /\.(md|markdown|myst|txt|tex|typ|bib|csv|tsv|jsonl|json|ipynb|kanban|py|r|yaml|yml)$/i.test(
        active.name,
      )
    ) {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (asSource) {
        textEditor = sourceEditor(
          editorHost,
          active.name,
          source,
          active.archived,
          changed,
        );
      } else if (/\.kanban$/i.test(active.name)) {
        try {
          textEditor = boardEditor(
            editorHost,
            source,
            active.archived,
            changed,
            manifest.documents.filter((doc) => doc.id !== active?.id),
            openDocument,
          );
        } catch (error) {
          editorHost.append(
            node(
              "p",
              `Board view unavailable: ${String(error)}`,
              "surface-notice",
            ),
          );
          textEditor = sourceEditor(
            editorHost,
            active.name,
            source,
            active.archived,
            changed,
          );
          sourceMode = true;
        }
      } else if (/\.ipynb$/i.test(active.name)) {
        const documentID = active.id;
        try {
          textEditor = notebookEditor(
            editorHost,
            source,
            active.archived,
            changed,
            {
              execute: (kernel, code) =>
                request<KernelResult>("kernel.execute", {
                  id: documentID,
                  kernel,
                  code,
                }),
              interrupt: () => request("kernel.interrupt", { id: documentID }),
              restart: () => request("kernel.restart", { id: documentID }),
              createFile: async (name, base64, origin) => {
                await save();
                const created = await request("create", {
                  name,
                  base64,
                  origin,
                });
                await refresh();
                return created;
              },
            },
          );
        } catch (error) {
          editorHost.append(
            node(
              "p",
              `Notebook view unavailable: ${String(error)}`,
              "surface-notice",
            ),
          );
          textEditor = sourceEditor(
            editorHost,
            active.name,
            source,
            active.archived,
            changed,
          );
        }
      } else if (/\.(csv|tsv|jsonl)$/i.test(active.name)) {
        try {
          textEditor = dataEditor(
            editorHost,
            active.name,
            source,
            active.archived,
            changed,
          );
        } catch (error) {
          editorHost.append(
            node(
              "p",
              `Table view unavailable: ${String(error)}. Original data is editable below.`,
              "surface-notice",
            ),
          );
          textEditor = sourceEditor(
            editorHost,
            active.name,
            source,
            active.archived,
            changed,
          );
        }
      } else
        textEditor = sourceEditor(
          editorHost,
          active.name,
          source,
          active.archived,
          changed,
        );
      ready = true;
    } else if (/\.pdf$/i.test(active.name)) {
      closePDF = pdfPreview(editorHost, bytes, active.name, () =>
        request<string>("assets.pdf-worker"),
      );
    } else if (/\.(png|jpe?g|webp|gif)$/i.test(active.name)) {
      imageURL = URL.createObjectURL(new Blob([bytes]));
      const image = node("img");
      image.src = imageURL;
      image.alt = active.name;
      image.className = "studio-image";
      editorHost.append(image);
    } else {
      editorHost.append(
        node(
          "p",
          "This file is preserved in its original format. Export it to open in another application.",
        ),
      );
    }
    if (active.archived) {
      editorHost.prepend(
        button("Restore from archive", async () => {
          const documentID = active?.id;
          await documentOperation(async () => {
            if (!active || active.id !== documentID) return;
            active = await request<StudioDocument>("archive", {
              id: active.id,
              expectedRevision: active.revision,
              archived: false,
            });
            archivedToggle.checked = false;
            await refresh();
          });
          if (documentID) await openDocument(documentID);
        }),
      );
    }
    delete status.dataset.error;
    status.textContent = `${active.archived ? "Archived" : "Saved locally"} · revision ${active.revision}`;
    renderFiles();
    fileList.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  } finally {
    switching = false;
    updateActions();
  }
}

async function currentBytes() {
  if (editor) {
    const blob = await editor.export({
      exportType: ["docx"],
      triggerDownload: false,
    });
    if (!(blob instanceof Blob))
      throw new Error("The editor did not produce a DOCX file.");
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  if (textEditor) return toBase64(new TextEncoder().encode(textEditor.text()));
  throw new Error("This document cannot be edited here.");
}

const saveCoordinator = new SaveCoordinator(
  () => Boolean(active && ready && savedEditRevision !== editRevision),
  async () => {
    const captured = active!;
    const revision = editRevision;
    const insertions = [...pendingInsertions];
    status.textContent = "Saving…";
    const base64 = await currentBytes();
    const updated = await request<StudioDocument>("save", {
      id: captured.id,
      expectedRevision: captured.revision,
      base64,
      insertions,
    });
    if (active?.id !== captured.id)
      throw new Error(
        "Document changed during saving. The saved version is preserved.",
      );
    active = updated;
    const recorded = new Set(insertions.map((entry) => entry.id));
    pendingInsertions = pendingInsertions.filter(
      (entry) => !recorded.has(entry.id),
    );
    savedEditRevision = revision;
    dirty(editRevision !== savedEditRevision);
    status.textContent =
      editRevision === revision
        ? `Saved locally · revision ${updated.revision}`
        : "Unsaved changes";
    delete status.dataset.error;
    await refresh();
  },
);

async function save(): Promise<void> {
  const flight = saveCoordinator.save();
  updateActions();
  try {
    await flight;
  } finally {
    updateActions();
  }
}

async function documentOperation(action: () => Promise<unknown>) {
  if (switching) return;
  switching = true;
  updateActions();
  try {
    await save();
    return await action();
  } finally {
    switching = false;
    updateActions();
  }
}

function assertCanNavigate() {
  if (textEditor?.canNavigate?.() === false)
    throw new Error(
      "Stop the running notebook cell before changing documents.",
    );
}

/** Fills a blank DOCX with a template outline as styled paragraphs. */
function fillDocxOutline(outline: string) {
  const engine = editor?.activeEditor;
  if (!engine) throw new Error("The DOCX editor is not ready.");
  // The template is the new file's first version, not an edit to save.
  ready = false;
  clearTimeout(timer);
  const commands = (
    engine as unknown as {
      commands: {
        insertContentAt(
          range: { from: number; to: number },
          value: ReturnType<typeof academicDraft>["content"],
        ): boolean;
      };
    }
  ).commands;
  if (
    !commands.insertContentAt(
      { from: 0, to: engine.state.doc.content.size },
      academicDraft(outline).content,
    )
  )
    throw new Error("The DOCX editor rejected this template.");
}

/** Creates and opens a document. Resolves false when another operation runs. */
async function createDocument(name: string, template: TemplateChoice) {
  assertCanNavigate();
  if (!NEW_DOCUMENT_EXTENSION.test(name))
    throw new Error("Choose a DOCX or text document extension.");
  if (manifest.documents.some((doc) => doc.name === name))
    throw new Error(
      "A file with this name already exists. Choose another name.",
    );
  if (switching) return false;
  switching = true;
  updateActions();
  const previousID = active?.id;
  try {
    await save();
    let base64 = "";
    if (template.kind === "document") {
      base64 = (
        await request<{ base64: string }>("read", { id: template.documentID })
      ).base64;
    } else if (/\.docx$/i.test(name)) {
      destroyEditor();
      active = undefined;
      await mountDocx();
      if (template.kind === "builtin") fillDocxOutline(template.template.text);
      base64 = await currentBytes();
    } else if (template.kind === "builtin") {
      base64 = toBase64(new TextEncoder().encode(template.template.text));
    } else if (/\.ipynb$/i.test(name)) {
      base64 = toBase64(
        new TextEncoder().encode(JSON.stringify(newNotebook(), null, 2) + "\n"),
      );
    } else if (/\.kanban$/i.test(name)) {
      base64 = toBase64(
        new TextEncoder().encode(JSON.stringify(newBoard(), null, 2) + "\n"),
      );
    }
    const created = await request<StudioDocument>("create", { name, base64 });
    await refresh();
    fileSearch.value = "";
    switching = false;
    await openDocument(created.id);
    status.textContent = `Created ${created.name}`;
    return true;
  } catch (error) {
    if (!active && previousID) {
      switching = false;
      await openDocument(previousID);
    }
    throw error;
  } finally {
    switching = false;
    updateActions();
  }
}

importInput.addEventListener("change", () => {
  void (async () => {
    await save();
    for (const file of Array.from(importInput.files ?? [])) {
      if (file.size > MAX_DOCUMENT_BYTES)
        throw new Error(`${file.name} exceeds 50 MiB.`);
      await request("create", {
        name: file.name,
        base64: toBase64(new Uint8Array(await file.arrayBuffer())),
      });
    }
    importInput.value = "";
    await refresh();
    status.textContent = "Files imported locally.";
  })().catch(showError);
});

function showHistory() {
  if (!active) return;
  history.replaceChildren(
    node("h2", "Saved versions"),
    button("Close history", () => {
      history.close();
    }),
  );
  for (const version of [...active.versions].reverse()) {
    history.append(
      button(
        `Version ${version.revision} · ${new Date(version.savedAt).toLocaleString()} · ${version.author} · ${version.reason}`,
        () => restoreVersion(version),
      ),
    );
  }
  history.showModal();
}

async function restoreVersion(version: StudioVersion) {
  assertCanNavigate();
  const id = active?.id;
  await documentOperation(async () => {
    if (!active || active.id !== id) return;
    active = await request<StudioDocument>("restore", {
      id: active.id,
      expectedRevision: active.revision,
      revision: version.revision,
    });
    await refresh();
  });
  if (id) await openDocument(id);
}

async function showInsertionHistory() {
  await save();
  const dialog = node("dialog");
  dialog.setAttribute("aria-label", "Inserted output history");
  dialog.append(
    node("h2", "Inserted output history"),
    node(
      "p",
      "These records link the snapshots inserted into this draft to their original versions. They do not assert that an object remains in the draft after manual deletion. Inspect a snapshot to check for source reruns or changed inputs.",
    ),
  );
  const history = active?.versions.at(-1)?.insertions ?? [];
  if (!history.length)
    dialog.append(
      node("p", "No recorded project-output insertions in this draft version."),
    );
  for (const entry of history) {
    const asset = manifest.documents.find((doc) => doc.id === entry.assetID);
    dialog.append(
      button(
        `Inspect ${asset?.name ?? entry.assetID} · revision ${entry.assetRevision}`,
        async () => {
          dialog.close();
          await showOutputOrigin(entry.assetID, entry.assetRevision);
        },
      ),
    );
  }
  dialog.append(button("Close insertion history", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function showOutputOrigin(id: string, revision?: number) {
  await save();
  const saved = await request<{ version: { origin?: OutputOrigin } }>("read", {
    id,
    revision,
  });
  const origin = saved.version.origin;
  const dialog = node("dialog");
  dialog.setAttribute("aria-label", "Output provenance");
  dialog.append(node("h2", "Output provenance"));
  if (!origin)
    dialog.append(
      node(
        "p",
        "This version has no recorded notebook execution. Imported files and manually edited outputs keep their bytes without claiming an execution origin.",
      ),
    );
  else {
    let notebook;
    let hash: string | undefined;
    try {
      const source = await request<{ base64: string }>("read", {
        id: origin.execution.notebookID,
      });
      notebook = parseNotebook(
        new TextDecoder().decode(fromBase64(source.base64)),
      );
      const output = notebook.cells.find((cell) => cell.id === origin.cellID)
        ?.outputs?.[origin.outputIndex];
      if (output) hash = await notebookOutputHash(output);
    } catch {
      /* A missing/damaged source is reported as unavailable below. */
    }
    await refresh();
    for (const input of origin.execution.inputs) {
      const doc = manifest.documents.find((entry) => entry.id === input.id);
      const version = doc?.versions.at(-1);
      if (doc && version && !version.sha256) {
        const bytes = await request<{ base64: string }>("read", {
          id: doc.id,
          revision: version.revision,
        });
        version.sha256 = await documentHash(bytes.base64);
      }
    }
    const reasons = outputFreshness(origin, manifest, notebook, hash);
    dialog.append(
      node(
        "p",
        reasons.length
          ? "Snapshot needs review"
          : "Matches the recorded execution and captured inputs",
      ),
    );
    if (reasons.length) {
      const list = node("ul");
      for (const reason of reasons) list.append(node("li", reason));
      dialog.append(list);
    }
    dialog.append(
      node(
        "p",
        `${origin.execution.kernel} · ${origin.execution.completedAt} · execution ${origin.execution.id}`,
      ),
      node("pre", origin.execution.code),
      node(
        "p",
        "Inputs are the project files copied when this kernel started. This is a historical snapshot, not proof of every dependency read. External files, packages and later kernel state are not captured. Embedded draft figures and tables do not refresh automatically.",
      ),
    );
    const inputs = node("details");
    inputs.append(
      node("summary", `Captured inputs (${origin.execution.inputs.length})`),
    );
    for (const input of origin.execution.inputs)
      inputs.append(
        node(
          "p",
          `${input.name} · revision ${input.revision} · SHA-256 ${input.sha256}`,
        ),
      );
    dialog.append(
      inputs,
      button("Open source notebook", async () => {
        dialog.close();
        await openDocument(origin.execution.notebookID);
      }),
    );
  }
  dialog.append(button("Close provenance", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function applyAIChange(
  change: StudioChange,
  editedAfter?: string,
): Promise<StudioConversation> {
  if (editedAfter !== undefined) change = { ...change, after: editedAfter };
  assertCanNavigate();
  const target = manifest.documents.find((doc) => doc.id === change.documentID);
  const isDocx =
    ["replace", "draft"].includes(change.kind) &&
    /\.docx$/i.test(target?.name ?? "");
  if (isDocx && active?.id !== change.documentID)
    await openDocument(change.documentID);
  let result: StudioConversation | undefined;
  await documentOperation(async () => {
    let docxBase64: string | undefined;
    let original: string | undefined;
    if (isDocx) {
      if (active?.revision !== change.expectedRevision)
        throw new Error(
          "This DOCX changed after the proposal. Ask for a fresh proposal.",
        );
      const engine = editor?.activeEditor;
      if (!engine)
        throw new Error("Open this DOCX before applying a proposal.");
      const ranges: Array<{ from: number; to: number }> = [];
      engine.state.doc.descendants((paragraph: any, position: number) => {
        if (paragraph.type.name !== "paragraph") return;
        let text = "";
        const positions: number[] = [];
        paragraph.descendants((part: any, offset: number) => {
          if (part.isText) {
            for (let i = 0; i < part.text.length; i++) {
              text += part.text[i];
              positions.push(position + 1 + offset + i);
            }
          } else if (part.isLeaf) {
            text += "\uFFFC";
            positions.push(position + 1 + offset);
          }
        });
        for (
          let at = text.indexOf(change.before);
          change.before && at >= 0;
          at = text.indexOf(change.before, at + 1)
        ) {
          ranges.push({
            from: positions[at],
            to: positions[at + change.before.length - 1] + 1,
          });
        }
        return false;
      });
      if (change.kind === "replace" && ranges.length !== 1)
        throw new Error(
          "The proposed text must match exactly one editable paragraph.",
        );
      original = await currentBytes();
      ready = false;
      clearTimeout(timer);
      try {
        // Narrow the pinned editor's public command API; its bundled recursive
        // command-map declarations exceed TypeScript's inference depth.
        const commands = (
          engine as unknown as {
            commands: {
              insertContentAt(
                range: number | { from: number; to: number },
                value: string | ReturnType<typeof academicDraft>["content"],
                options?: { asText: boolean },
              ): boolean;
            };
          }
        ).commands;
        if (
          !(change.kind === "draft"
            ? commands.insertContentAt(
                engine.state.doc.content.size,
                academicDraft(change.after).content,
              )
            : commands.insertContentAt(ranges[0], change.after, {
                asText: true,
              }))
        )
          throw new Error("The DOCX editor rejected this proposal.");
        docxBase64 = await currentBytes();
      } catch (error) {
        destroyEditor();
        await mountDocx(fromBase64(original));
        throw error;
      }
    }
    try {
      result = await request<StudioConversation>("ai.decide", {
        changeID: change.id,
        decision: "apply",
        docxBase64,
        editedAfter,
      });
    } catch (error) {
      if (original) {
        destroyEditor();
        await mountDocx(fromBase64(original));
      }
      throw error;
    } finally {
      if (isDocx) ready = true;
    }
    await refresh();
  });
  if (!result) throw new Error("Another document operation is in progress.");
  if (active) await openDocument(active.id);
  return result;
}

window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
      const focused = document.activeElement;
      if (focused?.closest(".ai-panel")) {
        event.preventDefault();
        event.stopPropagation();
        assistant.dismiss();
        return;
      }
      if (focused?.closest(".reference-panel")) {
        event.preventDefault();
        event.stopPropagation();
        references.close();
        return;
      }
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save().catch(showError);
    } else if (
      event.key.toLowerCase() === "p" &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      shell.classList.remove("files-hidden");
      filesButton.textContent = "Hide files";
      filesButton.setAttribute("aria-expanded", "true");
      fileSearch.focus();
      fileSearch.select();
    }
  },
  true,
);
window.addEventListener("beforeunload", (event) => {
  if (editRevision !== savedEditRevision) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("unload", () => {
  hostPort?.close();
  destroyEditor();
  for (const call of pending.values()) clearTimeout(call.timer);
  pending.clear();
});
window.dispatchEvent(new Event("paperpilot-studio-ready"));
void refresh()
  .then(() => {
    status.textContent = "Local project · files stay on this device";
  })
  .catch(showError);
