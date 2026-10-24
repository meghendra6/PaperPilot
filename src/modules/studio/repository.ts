import { researchProjectDirectory } from "../researchWorkspace/persistence/paths";
import type { ResearchWorkspaceFileOps } from "../researchWorkspace/persistence/contracts";
import type { StudioChange } from "./aiContracts";
import { documentHash } from "./documentHash";
import { assertOutputOrigin, type OutputOrigin } from "./outputProvenance";
import {
  LINK_DOCUMENT,
  decodeProjectText,
  projectLinkTargets,
  rewriteProjectLinks,
} from "./projectLinks";
import { parseBoard } from "./board";
import {
  parseProjectBundle,
  parseProjectContext,
  encodeProjectText,
} from "./projectBundle";
import {
  MAX_BACKUP_TEXT,
  parseDocumentBackup,
  type StudioDocumentBackup,
} from "./backup";
import {
  assertDocumentName,
  assertStudioID,
  assertInsertions,
  documentByteLength,
  parseStudioManifest,
  StudioRevisionConflict,
  type StudioDocument,
  type StudioManifest,
  type StudioVersion,
  type StudioInsertion,
} from "./contracts";

/** One instance per profile. Manifest publication is the only commit point. */
export class StudioRepository {
  private queues = new Map<string, Promise<void>>();
  constructor(
    private root: string,
    private files: ResearchWorkspaceFileOps,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
    private hash: (base64: string) => Promise<string> = documentHash,
  ) {}

  private directory(projectID: string) {
    assertStudioID(projectID);
    return `${researchProjectDirectory(this.root, projectID)}/documents`;
  }

  private async exclusive<T>(
    projectID: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(projectID) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(projectID, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(projectID) === queued) this.queues.delete(projectID);
    }
  }

  async list(projectID: string): Promise<StudioManifest> {
    const path = `${this.directory(projectID)}/manifest-v1.json`;
    if (!(await this.files.exists(path))) {
      return { schemaVersion: 1, projectID, revision: 0, documents: [] };
    }
    const text = await this.files.readText(path);
    if (text === undefined)
      throw new Error("Document catalog disappeared while reading.");
    return parseStudioManifest(JSON.parse(text), projectID);
  }

  private document(manifest: StudioManifest, id: string) {
    assertStudioID(id);
    const doc = manifest.documents.find((entry) => entry.id === id);
    if (!doc) throw new Error("Document was not found in this project.");
    return doc;
  }

  private check(doc: StudioDocument, expectedRevision: number) {
    if (doc.revision !== expectedRevision) throw new StudioRevisionConflict();
  }

  private async publish(manifest: StudioManifest) {
    manifest.revision += 1;
    parseStudioManifest(manifest, manifest.projectID);
    await this.files.writeTextAtomic(
      `${this.directory(manifest.projectID)}/manifest-v1.json`,
      JSON.stringify(manifest),
    );
    return manifest;
  }

  private async version(
    projectID: string,
    revision: number,
    base64: string,
    author: string,
    reason: StudioVersion["reason"],
  ) {
    const bytes = documentByteLength(base64);
    if (!author.trim() || author.length > 200)
      throw new Error("A document author is required.");
    const blobID = this.id();
    assertStudioID(blobID);
    const path = `${this.directory(projectID)}/blobs/${blobID}.json`;
    if (await this.files.exists(path))
      throw new Error("Document version identifier collision.");
    await this.files.writeTextAtomic(
      path,
      JSON.stringify({ schemaVersion: 1, base64 }),
    );
    return {
      revision,
      blobID,
      bytes,
      savedAt: this.now(),
      author,
      reason,
      sha256: await this.hash(base64),
    };
  }

  async create(
    projectID: string,
    name: string,
    base64: string,
    author: string,
    origin?: OutputOrigin,
  ) {
    if (origin !== undefined) assertOutputOrigin(origin);
    assertDocumentName(name);
    documentByteLength(base64);
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      if (manifest.documents.some((entry) => entry.name === name))
        throw new Error(
          "A document with this name already exists, including in the archive.",
        );
      const id = this.id();
      assertStudioID(id);
      if (manifest.documents.some((entry) => entry.id === id))
        throw new Error("Document identifier collision.");
      const version = await this.version(
        projectID,
        1,
        base64,
        author,
        "import",
      );
      const doc: StudioDocument = {
        id,
        name,
        revision: 1,
        archived: false,
        versions: [{ ...version, ...(origin ? { origin } : {}) }],
      };
      manifest.documents.push(doc);
      await this.publish(manifest);
      return doc;
    });
  }

  async read(projectID: string, id: string, revision?: number) {
    const doc = this.document(await this.list(projectID), id);
    const version =
      revision === undefined
        ? doc.versions.at(-1)!
        : doc.versions.find((entry) => entry.revision === revision);
    if (!version) throw new Error("Document version was not found.");
    const text = await this.files.readText(
      `${this.directory(projectID)}/blobs/${version.blobID}.json`,
    );
    if (text === undefined)
      throw new Error(
        "Saved document bytes are missing. Previous versions were preserved.",
      );
    const payload = JSON.parse(text);
    if (
      payload?.schemaVersion !== 1 ||
      documentByteLength(payload.base64) !== version.bytes ||
      (version.sha256 !== undefined &&
        (await this.hash(payload.base64)) !== version.sha256)
    )
      throw new Error("Saved document version is damaged.");
    return { document: doc, version, base64: payload.base64 as string };
  }

  async save(
    projectID: string,
    id: string,
    expectedRevision: number,
    base64: string,
    author: string,
    reason: "edit" | "ai" = "edit",
    insertions: StudioInsertion[] = [],
  ) {
    assertInsertions(insertions);
    documentByteLength(base64);
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      const doc = this.document(manifest, id);
      this.check(doc, expectedRevision);
      if (doc.archived)
        throw new Error(
          "Restore this document from the archive before editing.",
        );
      doc.revision += 1;
      const history = [
        ...(doc.versions.at(-1)?.insertions ?? []),
        ...insertions,
      ];
      assertInsertions(history);
      for (const insertion of insertions) {
        const asset = this.document(manifest, insertion.assetID);
        if (
          !asset.versions.some(
            (version) => version.revision === insertion.assetRevision,
          )
        )
          throw new Error("The inserted asset version is unavailable.");
      }
      doc.versions.push({
        ...(await this.version(
          projectID,
          doc.revision,
          base64,
          author,
          reason,
        )),
        ...(history.length ? { insertions: history } : {}),
      });
      await this.publish(manifest);
      return doc;
    });
  }

  async exportDocuments(projectID: string, allowEmpty = false) {
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      if (!manifest.documents.length && !allowEmpty)
        throw new Error("This project has no documents to back up.");
      if (!manifest.revision) manifest.revision = 1;
      const blobs: Record<string, string> = Object.create(null);
      let size = JSON.stringify(manifest).length;
      for (const doc of manifest.documents)
        for (const version of doc.versions) {
          if (Object.prototype.hasOwnProperty.call(blobs, version.blobID))
            continue;
          const saved = await this.read(projectID, doc.id, version.revision);
          size += saved.base64.length;
          if (size > MAX_BACKUP_TEXT - 65536)
            throw new Error(
              "Document history exceeds the 96 MiB backup limit. Export individual files separately.",
            );
          blobs[version.blobID] = saved.base64;
          version.sha256 ??= await this.hash(saved.base64);
        }
      const backup: StudioDocumentBackup = {
        format: "paperpilot-studio-documents",
        schemaVersion: 1,
        exportedAt: this.now(),
        manifest,
        blobs,
      };
      return JSON.stringify(backup);
    });
  }

  async restoreDocuments(projectID: string, text: string) {
    const backup = parseDocumentBackup(text);
    const context = backup.manifest.importedContext;
    if (context) {
      const doc = backup.manifest.documents.find(
        (entry) => entry.id === context.documentID,
      )!;
      const version = doc.versions.find(
        (entry) => entry.revision === context.revision,
      )!;
      parseProjectContext(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(backup.blobs[version.blobID]), (c) =>
              c.charCodeAt(0),
            ),
          ),
        ),
      );
    }
    // Validate every digest before writing any destination blob.
    for (const doc of backup.manifest.documents)
      for (const version of doc.versions) {
        const digest = await this.hash(backup.blobs[version.blobID]);
        if (version.sha256 && version.sha256 !== digest)
          throw new Error("The backup failed its document checksum.");
        version.sha256 = digest;
      }
    return this.exclusive(projectID, async () => {
      const current = await this.list(projectID);
      if (current.documents.length)
        throw new Error(
          "Restore into a project with no documents, including archived documents. Existing files were preserved.",
        );
      // Fresh blob IDs avoid clobbering remnants of an interrupted restore.
      const remapped = new Map<string, string>();
      for (const doc of backup.manifest.documents)
        for (const version of doc.versions) {
          const original = version.blobID;
          if (!remapped.has(original)) {
            const id = this.id();
            assertStudioID(id);
            const path = `${this.directory(projectID)}/blobs/${id}.json`;
            if (await this.files.exists(path))
              throw new Error("Document version identifier collision.");
            await this.files.writeTextAtomic(
              path,
              JSON.stringify({
                schemaVersion: 1,
                base64: backup.blobs[original],
              }),
            );
            remapped.set(original, id);
          }
          version.blobID = remapped.get(original)!;
        }
      const manifest = {
        ...backup.manifest,
        projectID,
        revision: current.revision,
      };
      await this.publish(manifest);
      return manifest;
    });
  }

  async importedContext(projectID: string) {
    const pointer = (await this.list(projectID)).importedContext;
    if (!pointer) return undefined;
    const saved = await this.read(
      projectID,
      pointer.documentID,
      pointer.revision,
    );
    return parseProjectContext(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(saved.base64), (c) => c.charCodeAt(0)),
        ),
      ),
    );
  }

  async restoreProjectBundle(projectID: string, text: string) {
    const { documents, context } = parseProjectBundle(text);
    const id = this.id(),
      blobID = this.id();
    assertStudioID(id);
    assertStudioID(blobID);
    if (
      documents.manifest.documents.some((doc) => doc.id === id) ||
      Object.prototype.hasOwnProperty.call(documents.blobs, blobID)
    )
      throw new Error("Project context identifier collision.");
    const base64 = encodeProjectText(JSON.stringify(context, null, 2));
    documents.manifest.documents.push({
      id,
      name: `imports/project-context-${id}.json`,
      revision: 1,
      archived: false,
      versions: [
        {
          revision: 1,
          blobID,
          bytes: documentByteLength(base64),
          savedAt: this.now(),
          author: "Imported project",
          reason: "import",
          sha256: await this.hash(base64),
        },
      ],
    });
    documents.blobs[blobID] = base64;
    documents.manifest.importedContext = { documentID: id, revision: 1 };
    return this.restoreDocuments(projectID, JSON.stringify(documents));
  }

  async rename(
    projectID: string,
    id: string,
    expectedRevision: number,
    name: string,
  ) {
    assertDocumentName(name);
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      const doc = this.document(manifest, id);
      this.check(doc, expectedRevision);
      await this.renameWithin(manifest, doc, name, "You");
      await this.publish(manifest);
      return doc;
    });
  }

  private async renameWithin(
    manifest: StudioManifest,
    doc: StudioDocument,
    name: string,
    author: string,
  ) {
    assertDocumentName(name);
    if (
      manifest.documents.some(
        (entry) => entry.id !== doc.id && entry.name === name,
      )
    )
      throw new Error("A document with this name already exists.");
    const extension = (value: string) =>
      /\.[^./]+$/.exec(value)?.[0].toLowerCase() ?? "";
    if (extension(doc.name) !== extension(name))
      throw new Error(
        "Renaming does not convert formats. Keep the file extension.",
      );
    const oldName = doc.name;
    let total = 0;
    for (const entry of manifest.documents.filter(
      (entry) => !entry.archived && LINK_DOCUMENT.test(entry.name),
    )) {
      const saved = await this.read(manifest.projectID, entry.id);
      total += saved.version.bytes;
      if (total > 64 * 1024 * 1024)
        throw new Error(
          "Linked text files exceed the 64 MiB rename scan limit. No names or references were changed.",
        );
      const before = decodeProjectText(saved.base64);
      const after = rewriteProjectLinks(
        before,
        entry.name,
        entry.id === doc.id ? name : entry.name,
        oldName,
        name,
      );
      if (after !== before) {
        const insertions = entry.versions.at(-1)?.insertions;
        entry.versions.push({
          ...(await this.version(
            manifest.projectID,
            entry.revision + 1,
            encodeProjectText(after),
            author,
            "edit",
          )),
          ...(insertions ? { insertions } : {}),
        });
        if (entry.id !== doc.id) entry.revision++;
      }
    }
    doc.name = name;
    doc.revision++;
  }

  async links(projectID: string) {
    const manifest = await this.list(projectID);
    const edges: Array<{
      from: string;
      to?: string;
      label: string;
      kind: string;
    }> = [];
    let total = 0;
    for (const doc of manifest.documents.filter((entry) => !entry.archived)) {
      const origin = doc.versions.at(-1)?.origin;
      for (const insertion of doc.versions.at(-1)?.insertions ?? [])
        edges.push({
          from: doc.id,
          to: insertion.assetID,
          label: `Historical insertion of asset revision ${insertion.assetRevision}`,
          kind: "insertion",
        });
      if (origin)
        edges.push({
          from: doc.id,
          to: origin.execution.notebookID,
          label: "Notebook execution",
          kind: "output",
        });
      if (!LINK_DOCUMENT.test(doc.name) && !/\.kanban$/i.test(doc.name))
        continue;
      const saved = await this.read(
        projectID,
        doc.id,
        doc.versions.at(-1)!.revision,
      );
      total += saved.version.bytes;
      if (total > 64 * 1024 * 1024)
        throw new Error(
          "Linked text files exceed the 64 MiB graph scan limit.",
        );
      const text = decodeProjectText(saved.base64);
      if (/\.kanban$/i.test(doc.name)) {
        for (const card of parseBoard(text).cards.filter(
          (card) => !card.archived,
        ))
          for (const id of card.documentIDs)
            edges.push({
              from: doc.id,
              to: id,
              label: card.title,
              kind: "card",
            });
      } else
        for (const path of projectLinkTargets(doc.name, text)) {
          const target = manifest.documents.find(
            (entry) => entry.name === path,
          );
          edges.push({
            from: doc.id,
            to: target?.id,
            label: path,
            kind: "file",
          });
        }
    }
    return { manifest, edges };
  }

  async archive(
    projectID: string,
    id: string,
    expectedRevision: number,
    archived: boolean,
  ) {
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      const doc = this.document(manifest, id);
      this.check(doc, expectedRevision);
      doc.archived = archived;
      doc.revision += 1;
      await this.publish(manifest);
      return doc;
    });
  }

  async restore(
    projectID: string,
    id: string,
    expectedRevision: number,
    revision: number,
    author: string,
  ) {
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      const doc = this.document(manifest, id);
      this.check(doc, expectedRevision);
      const saved = await this.read(projectID, id, revision);
      doc.revision += 1;
      doc.archived = false;
      doc.versions.push({
        ...(await this.version(
          projectID,
          doc.revision,
          saved.base64,
          author,
          "restore",
        )),
        ...(saved.version.origin ? { origin: saved.version.origin } : {}),
        ...(saved.version.insertions
          ? { insertions: saved.version.insertions }
          : {}),
      });
      await this.publish(manifest);
      return doc;
    });
  }

  /** Receipt and mutation share the manifest commit point, so retry cannot apply twice. */
  async applyChange(projectID: string, change: StudioChange, base64?: string) {
    assertStudioID(change.id);
    return this.exclusive(projectID, async () => {
      const manifest = await this.list(projectID);
      const receipt = Object.prototype.hasOwnProperty.call(
        manifest.appliedChanges ?? {},
        change.id,
      )
        ? manifest.appliedChanges![change.id]
        : undefined;
      if (receipt) return this.document(manifest, receipt.documentID);
      let doc: StudioDocument;
      if (change.kind === "create") {
        assertDocumentName(change.name);
        if (manifest.documents.some((entry) => entry.name === change.name))
          throw new Error("A file with this name already exists.");
        if (base64 === undefined)
          throw new Error("Missing proposed document bytes.");
        const id = this.id();
        assertStudioID(id);
        if (manifest.documents.some((entry) => entry.id === id))
          throw new Error("Document identifier collision.");
        doc = {
          id,
          name: change.name,
          revision: 1,
          archived: false,
          versions: [
            await this.version(projectID, 1, base64, "You · AI proposal", "ai"),
          ],
        };
        manifest.documents.push(doc);
      } else {
        doc = this.document(manifest, change.documentID);
        this.check(doc, change.expectedRevision);
        if (doc.archived)
          throw new Error("Restore this file before applying changes.");
        if (change.kind === "rename") {
          await this.renameWithin(
            manifest,
            doc,
            change.name,
            "You · AI proposal",
          );
        } else if (change.kind === "archive") doc.archived = true;
        else if (["replace", "append", "draft"].includes(change.kind)) {
          if (base64 === undefined)
            throw new Error("Missing proposed document bytes.");
          const insertions = doc.versions.at(-1)?.insertions;
          doc.versions.push({
            ...(await this.version(
              projectID,
              doc.revision + 1,
              base64,
              "You · AI proposal",
              "ai",
            )),
            ...(insertions ? { insertions } : {}),
          });
        } else throw new Error("Unknown change operation.");
        if (change.kind !== "rename") doc.revision++;
      }
      manifest.appliedChanges ??= {};
      Object.defineProperty(manifest.appliedChanges, change.id, {
        value: { documentID: doc.id, revision: doc.revision },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      await this.publish(manifest);
      return doc;
    });
  }
}
