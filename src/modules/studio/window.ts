import { DialogHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import { loadResearchWorkspaceProject } from "../researchWorkspace/facade";
import {
  createResearchWorkspaceStorage,
  getResearchWorkspaceStorageRoot,
  getResearchWorkspaceProjectRepository,
} from "../researchWorkspace/storage";
import { element } from "../researchWorkspace/dom";
import { assertStudioID, documentByteLength } from "./contracts";
import { StudioRepository } from "./repository";
import { nativeKernel } from "./nativeKernel";
import { nativeAI, studioAIDefaults } from "./nativeAI";
import { nativeCompiler } from "./nativeCompiler";
import { documentHash } from "./documentHash";
import { projectBundle, assertProjectSnapshotRevision } from "./projectBundle";
import { referencePassages } from "./referenceEvidence";
import { openVerifiedResearchWorkspaceEvidence } from "../researchWorkspace/evidenceNavigation";
import {
  projectZoteroReferences,
  studioCitationStyles,
  studioCitationStyleXML,
} from "./nativeReferences";

const windows = new Map<string, DialogHelper>();
const opening = new Map<string, Promise<void>>();
let repository: StudioRepository | undefined;

function storage() {
  return (repository ??= new StudioRepository(
    getResearchWorkspaceStorageRoot(),
    createResearchWorkspaceStorage(),
    () => Zotero.getMainWindow().crypto.randomUUID(),
    undefined,
    (base64) => documentHash(base64, Zotero.getMainWindow().crypto.subtle),
  ));
}

export function openStudio(projectID: string) {
  assertStudioID(projectID);
  const pending = opening.get(projectID);
  if (pending) return pending;
  const promise = openStudioWindow(projectID).finally(() =>
    opening.delete(projectID),
  );
  opening.set(projectID, promise);
  return promise;
}

async function openStudioWindow(projectID: string) {
  assertStudioID(projectID);
  const existing = windows.get(projectID);
  if (existing && !existing.window.closed) {
    existing.window.focus();
    return;
  }
  const details = await loadResearchWorkspaceProject(projectID);
  let dispose: (() => void) | undefined;
  const dialog = new DialogHelper(1, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      id: "paperpilot-studio-host",
    })
    .setDialogData({
      loadCallback: () => {
        const win = dialog.window as Window;
        const doc = win.document;
        const host = doc.getElementById("paperpilot-studio-host")!;
        doc.title = `${details.project.name} · Paper Pilot`;
        const style = element(doc, "style");
        style.textContent =
          "html,body{margin:0!important;padding:0!important;height:100%;overflow:hidden}#paperpilot-studio-host{position:fixed;inset:0;display:flex}#paperpilot-studio-host iframe{flex:1;border:0;width:100%;height:100%}";
        doc.head.append(style);
        const frame = element(doc, "iframe");
        frame.title = "Paper Pilot project documents";
        frame.setAttribute("sandbox", "allow-scripts allow-downloads");
        const channel = win.crypto.randomUUID();
        const frameURL = `chrome://${config.addonRef}-studio/content/index.html#${channel}`;
        let port: MessagePort | undefined;
        let connectionTimer: number | undefined;
        let dirty = false;
        let disposed = false;
        let lastExport: string | undefined;
        const files = storage();
        const kernels = nativeKernel(projectID, files, win);
        const assistant = nativeAI(projectID, files, win);
        const compiler = nativeCompiler(projectID, files, win);
        const onMessage = async (event: MessageEvent) => {
          const message = event.data;
          Zotero.debug(`Research Studio request: ${message?.method}`);
          if (
            disposed ||
            message?.channel !== channel ||
            message?.protocol !== "paperpilot-studio/1"
          )
            return;
          if (message.method === "dirty") {
            dirty = message.dirty === true;
            return;
          }
          if (message.method === "startup.error") {
            Zotero.logError(
              new Error(
                `Research Studio: ${String(message.error).slice(0, 2000)}`,
              ),
            );
            return;
          }
          if (
            typeof message.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,80}$/.test(message.id)
          )
            return;
          try {
            // Recheck membership authority; a removed project cannot be recreated by the editor.
            const current = await loadResearchWorkspaceProject(projectID);
            if (disposed) return;
            const payload = message.payload ?? {};
            let result: unknown;
            switch (message.method) {
              case "backup.project.export": {
                const documents = JSON.parse(
                  await files.exportDocuments(projectID, true),
                );
                const evidence =
                  await getResearchWorkspaceProjectRepository().exportProject(
                    projectID,
                  );
                const context = await assistant.exportProjectContext(
                  current.project.name,
                  { ...evidence },
                );
                assertProjectSnapshotRevision(
                  documents,
                  (await files.list(projectID)).revision,
                );
                const path = `${getResearchWorkspaceStorageRoot()}/exports/documents/${projectID}/project-${win.crypto.randomUUID()}.paperpilot.json`;
                await createResearchWorkspaceStorage().writeTextAtomic(
                  path,
                  projectBundle(documents, context),
                );
                lastExport = path;
                result = { path };
                break;
              }
              case "backup.project.restore":
                if (
                  current.members.length ||
                  (
                    await getResearchWorkspaceProjectRepository().getCandidates(
                      projectID,
                    )
                  ).candidates.length ||
                  current.project.artifactIDs.length ||
                  current.project.runIDs.length
                )
                  throw new Error(
                    "Restore into a new project without existing research records.",
                  );
                result = await assistant.restoreProjectBundle(payload.text);
                break;
              case "assets.pdf-worker":
                result = (
                  await Zotero.HTTP.request(
                    "GET",
                    `chrome://${config.addonRef}-studio/content/pdf-worker.js`,
                  )
                ).responseText;
                break;
              case "backup.export": {
                const text = await files.exportDocuments(projectID);
                const path = `${getResearchWorkspaceStorageRoot()}/exports/documents/${projectID}/documents-${win.crypto.randomUUID()}.paperpilot.json`;
                await createResearchWorkspaceStorage().writeTextAtomic(
                  path,
                  text,
                );
                lastExport = path;
                result = { path };
                break;
              }
              case "backup.restore":
                result = await files.restoreDocuments(projectID, payload.text);
                break;
              case "compiler.build":
                result = await compiler.build(
                  payload.id,
                  payload.expectedRevision,
                );
                break;
              case "compiler.cancel":
                compiler.cancel();
                result = true;
                break;
              case "references.zotero":
                result = await projectZoteroReferences(projectID);
                break;
              case "references.styles":
                result = await studioCitationStyles();
                break;
              case "references.style":
                result = await studioCitationStyleXML(payload.id);
                break;
              case "ai.defaults":
                result = studioAIDefaults();
                break;
              case "ai.history":
                result = await assistant.history();
                break;
              case "ai.conversations":
                result = await assistant.conversations();
                break;
              case "ai.resume":
                result = await assistant.resumeConversation(payload.id);
                break;
              case "ai.ask":
                result = await assistant.ask(
                  payload.config,
                  payload.question,
                  payload.documentIDs,
                );
                break;
              case "ai.cancel":
                assistant.cancel();
                result = true;
                break;
              case "ai.decide":
                result = await assistant.decide(
                  payload.changeID,
                  payload.decision,
                  payload.docxBase64,
                  payload.editedAfter,
                );
                break;
              case "ai.new":
                result = await assistant.newConversation();
                break;
              case "kernel.execute":
                await files.read(projectID, payload.id);
                result = await kernels.execute(
                  payload.id,
                  payload.kernel,
                  payload.code,
                );
                break;
              case "kernel.interrupt":
                result = await kernels.interrupt(payload.id);
                break;
              case "kernel.restart":
                result = await kernels.restart(payload.id);
                break;
              case "list":
                result = {
                  name: current.project.name,
                  manifest: await files.list(projectID),
                };
                break;
              case "read":
                result = await files.read(
                  projectID,
                  payload.id,
                  payload.revision,
                );
                break;
              case "create":
                result = await files.create(
                  projectID,
                  payload.name,
                  payload.base64,
                  "You",
                  payload.origin,
                );
                break;
              case "links":
                result = await files.links(projectID);
                break;
              case "references.passages":
                result = referencePassages(current, payload.citationKey).map(
                  ({ reference: _reference, ...entry }) => entry,
                );
                break;
              case "references.openPassage": {
                const entry = referencePassages(
                  current,
                  payload.citationKey,
                ).find(
                  (entry) =>
                    entry.atomID === payload.atomID &&
                    entry.evidenceIndex === payload.evidenceIndex,
                );
                if (!entry)
                  throw new Error(
                    "This passage no longer belongs to the current verified project evidence.",
                  );
                await openVerifiedResearchWorkspaceEvidence(entry.reference);
                result = true;
                break;
              }
              case "save":
                result = await files.save(
                  projectID,
                  payload.id,
                  payload.expectedRevision,
                  payload.base64,
                  "You",
                  "edit",
                  payload.insertions,
                );
                break;
              case "rename":
                result = await files.rename(
                  projectID,
                  payload.id,
                  payload.expectedRevision,
                  payload.name,
                );
                break;
              case "archive":
                if (typeof payload.archived !== "boolean")
                  throw new Error("Invalid archive request.");
                result = await files.archive(
                  projectID,
                  payload.id,
                  payload.expectedRevision,
                  payload.archived,
                );
                break;
              case "restore":
                result = await files.restore(
                  projectID,
                  payload.id,
                  payload.expectedRevision,
                  payload.revision,
                  "You",
                );
                break;
              case "export": {
                const saved = await files.read(projectID, payload.id);
                documentByteLength(saved.base64);
                const bytes = Uint8Array.from(win.atob(saved.base64), (c) =>
                  c.charCodeAt(0),
                );
                const directory = `${getResearchWorkspaceStorageRoot()}/exports/documents/${projectID}/${saved.document.id}`;
                await IOUtils.makeDirectory(directory, {
                  ignoreExisting: true,
                  createAncestors: true,
                });
                const name = saved.document.name.split("/").at(-1)!;
                const path = `${directory}/${name}`;
                await IOUtils.write(path, bytes, {
                  tmpPath: `${path}.tmp`,
                  flush: true,
                });
                lastExport = path;
                result = { path };
                break;
              }
              case "reveal":
                if (!lastExport) throw new Error("Export a document first.");
                Zotero.File.reveal(lastExport);
                result = true;
                break;
              default:
                throw new Error("Unsupported project operation.");
            }
            if (!disposed)
              port?.postMessage({
                protocol: "paperpilot-studio/1",
                channel,
                id: message.id,
                result,
              });
          } catch (error) {
            if (!disposed)
              port?.postMessage({
                protocol: "paperpilot-studio/1",
                channel,
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
              });
          }
        };
        const close = (event: Event) => {
          if (
            dirty &&
            !win.confirm(
              "This document has unsaved changes. Close and discard those changes?",
            )
          )
            event.preventDefault();
        };
        const connect = () => {
          if (disposed || port) return;
          const frameDocument = frame.contentDocument;
          if (
            frameDocument?.documentURI !== frameURL ||
            frameDocument.readyState !== "complete"
          )
            return;
          Zotero.debug("Research Studio frame ready; connecting message port");
          const bridge = new (win as any).MessageChannel() as MessageChannel;
          port = bridge.port1;
          (port.addEventListener as any)("message", onMessage, false, true);
          port.start();
          frame.contentWindow?.postMessage(
            { protocol: "paperpilot-studio/1", channel, method: "connect" },
            "*",
            [bridge.port2],
          );
          Zotero.debug("Research Studio message port transferred");
        };
        // Gecko does not consistently expose a sandboxed chrome iframe's load
        // event to the modeless chrome host. Read readiness from this exact
        // packaged document; never transfer authority to a navigated page.
        const deadline = Date.now() + 20000;
        const awaitFrame = () => {
          try {
            connect();
          } catch (error) {
            Zotero.logError(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          if (disposed || port) return;
          if (Date.now() < deadline)
            connectionTimer = win.setTimeout(awaitFrame, 100);
          else
            Zotero.logError(
              new Error(
                `Research Studio frame did not connect: ${frame.contentDocument?.documentURI} (${frame.contentDocument?.readyState})`,
              ),
            );
        };
        win.addEventListener("close", close);
        dispose = () => {
          disposed = true;
          assistant.cancel();
          compiler.cancel();
          void kernels.close().catch((error) => Zotero.logError(error));
          port?.close();
          win.clearTimeout(connectionTimer);
          win.removeEventListener("close", close);
        };
        frame.src = frameURL;
        host.append(frame);
        connectionTimer = win.setTimeout(awaitFrame, 0);
      },
      unloadCallback: () => {
        dispose?.();
        if (windows.get(projectID) === dialog) windows.delete(projectID);
      },
    })
    .open(`Paper Pilot · ${details.project.name}`, {
      width: 1320,
      height: 900,
      centerscreen: true,
      resizable: true,
      fitContent: false,
      noDialogMode: true,
      alwaysRaised: false,
    });
  windows.set(projectID, dialog);
}

export function closeStudioWindows() {
  for (const dialog of windows.values()) dialog.window?.close();
  windows.clear();
  repository = undefined;
}
