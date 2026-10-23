import { researchProjectDirectory } from "../researchWorkspace/persistence/paths";
import type { ResearchWorkspaceFileOps } from "../researchWorkspace/persistence/contracts";
import { assertStudioID } from "./contracts";
import {
  parseStudioResponse,
  replaceOnce,
  studioPrompt,
  validateAIConfig,
  TEXT_DOCUMENT,
  type ContextDocument,
  type StudioAIConfig,
  type StudioConversation,
  type StudioTurn,
} from "./aiContracts";
import type { StudioRepository } from "./repository";
import { portableConversation, parseProjectContext } from "./projectBundle";

export interface StudioAIPorts {
  createAbortController?(): AbortController;
  files: ResearchWorkspaceFileOps;
  root: string;
  id(): string;
  text(
    name: string,
    base64: string,
    signal?: AbortSignal,
  ): string | Promise<string>;
  encode(text: string): string;
  run(
    config: StudioAIConfig,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string>;
}

/** Project conversation and cancellation are independent of paper item run state. */
export class StudioAIService {
  private static owners = new Map<string, StudioAIService>();
  private running?: AbortController;
  private activeTurnID?: string;
  constructor(
    private projectID: string,
    private repository: StudioRepository,
    private ports: StudioAIPorts,
  ) {
    assertStudioID(projectID);
  }
  private path() {
    return `${researchProjectDirectory(this.ports.root, this.projectID)}/studio-conversation-v1.json`;
  }
  private async readConversation(path: string): Promise<StudioConversation> {
    if (!(await this.ports.files.exists(path)))
      return { schemaVersion: 1, projectID: this.projectID, turns: [] };
    const text = await this.ports.files.readText(path);
    if (text === undefined)
      return { schemaVersion: 1, projectID: this.projectID, turns: [] };
    const data = JSON.parse(text) as StudioConversation;
    return this.reconcileConversation(data);
  }
  private async reconcileConversation(data: StudioConversation) {
    if (
      data?.schemaVersion !== 1 ||
      data.projectID !== this.projectID ||
      !Array.isArray(data.turns)
    )
      throw new Error(
        "Unsupported or damaged project conversation. The original was preserved.",
      );
    for (const turn of data.turns) {
      assertStudioID(turn?.id);
      if (
        typeof turn.question !== "string" ||
        typeof turn.reply !== "string" ||
        !Array.isArray(turn.context) ||
        !Array.isArray(turn.changes) ||
        !["running", "complete", "failed", "canceled"].includes(turn.status)
      )
        throw new Error("Invalid conversation turn.");
      // A prior process/window cannot still own this service's run.
      if (
        turn.status === "running" &&
        turn.id !== StudioAIService.owners.get(this.path())?.activeTurnID
      ) {
        turn.status = "failed";
        turn.error = "The previous window closed before this run completed.";
      }
    }
    const receipts =
      (await this.repository.list(this.projectID)).appliedChanges ?? {};
    for (const turn of data.turns)
      for (const change of turn.changes)
        if (Object.prototype.hasOwnProperty.call(receipts, change.id))
          change.decision = "applied";
    return data;
  }
  async history() {
    if (await this.ports.files.exists(this.path()))
      return this.readConversation(this.path());
    const imported = await this.repository.importedContext(this.projectID);
    if (imported)
      return this.reconcileConversation({
        ...portableConversation(
          imported.currentConversation,
          imported.sourceProjectID,
        ),
        projectID: this.projectID,
      });
    return { schemaVersion: 1 as const, projectID: this.projectID, turns: [] };
  }

  async conversations() {
    const directory = `${researchProjectDirectory(this.ports.root, this.projectID)}/conversations`;
    const imported = await this.repository.importedContext(this.projectID);
    const summaries = (imported?.conversations ?? []).map((archive, index) => ({
      id: `imported-${index}`,
      title:
        archive.conversation.turns[0]?.question.slice(0, 100) ||
        "Empty conversation",
      createdAt: archive.conversation.turns[0]?.createdAt || "",
      turns: archive.conversation.turns.length,
    }));
    for (const path of (await this.ports.files.exists(directory))
      ? await this.ports.files.listDirectory(directory)
      : []) {
      const filename = path.replace(/\\/g, "/").split("/").at(-1)!;
      if (!/^[a-zA-Z0-9_-]{1,128}\.json$/.test(filename)) continue;
      const data = await this.readConversation(`${directory}/${filename}`);
      summaries.push({
        id: filename.slice(0, -5),
        title: data.turns[0]?.question.slice(0, 100) || "Empty conversation",
        createdAt: data.turns[0]?.createdAt || "",
        turns: data.turns.length,
      });
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async resumeConversation(id: string) {
    assertStudioID(id);
    this.reserve();
    try {
      const restored = await this.readArchive(id);
      const current = await this.history();
      if (current.turns.length) await this.archive(current);
      await this.write(restored);
      return restored;
    } finally {
      this.release();
    }
  }

  private async readArchive(id: string) {
    assertStudioID(id);
    if (/^imported-\d+$/.test(id)) {
      const imported = await this.repository.importedContext(this.projectID);
      const archive = imported?.conversations[Number(id.slice(9))];
      if (!archive || !imported)
        throw new Error("Imported conversation archive was not found.");
      return this.reconcileConversation({
        ...portableConversation(archive.conversation, imported.sourceProjectID),
        projectID: this.projectID,
      });
    }
    const path = `${researchProjectDirectory(this.ports.root, this.projectID)}/conversations/${id}.json`;
    if (!(await this.ports.files.exists(path)))
      throw new Error("This conversation archive was not found.");
    return this.readConversation(path);
  }

  async exportProjectContext(
    projectName: string,
    researchSnapshot: Record<string, unknown>,
  ) {
    this.reserve();
    try {
      const imported = await this.repository.importedContext(this.projectID);
      const conversations = [];
      for (const archive of await this.conversations())
        conversations.push({
          id: archive.id,
          conversation: await this.readArchive(archive.id),
        });
      return parseProjectContext({
        schemaVersion: 1,
        sourceProjectID: this.projectID,
        projectName,
        researchSnapshots: [
          ...(imported?.researchSnapshots ?? []),
          researchSnapshot,
        ],
        currentConversation: await this.history(),
        conversations,
      });
    } finally {
      this.release();
    }
  }

  async restoreProjectBundle(text: string) {
    this.reserve();
    try {
      if (
        (await this.ports.files.exists(this.path())) ||
        (await this.conversations()).length
      )
        throw new Error(
          "Restore into a new project without conversations or documents. Existing history was preserved.",
        );
      return await this.repository.restoreProjectBundle(this.projectID, text);
    } finally {
      this.release();
    }
  }

  private archive(data: StudioConversation) {
    return this.ports.files.writeTextAtomic(
      `${researchProjectDirectory(this.ports.root, this.projectID)}/conversations/${this.ports.id()}.json`,
      JSON.stringify(data),
    );
  }
  private write(data: StudioConversation) {
    return this.ports.files.writeTextAtomic(this.path(), JSON.stringify(data));
  }
  private reserve() {
    if (StudioAIService.owners.has(this.path()))
      throw new Error("Wait for the current project AI operation to finish.");
    StudioAIService.owners.set(this.path(), this);
  }
  private release() {
    if (StudioAIService.owners.get(this.path()) === this)
      StudioAIService.owners.delete(this.path());
  }
  async ask(config: StudioAIConfig, question: string, documentIDs: string[]) {
    validateAIConfig(config);
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 20000
    )
      throw new Error("Enter a question of at most 20,000 characters.");
    if (
      !Array.isArray(documentIDs) ||
      documentIDs.length > 30 ||
      new Set(documentIDs).size !== documentIDs.length
    )
      throw new Error("Select at most 30 distinct context files.");
    const controller =
      this.ports.createAbortController?.() ?? new AbortController();
    this.reserve();
    let data: StudioConversation | undefined;
    let turn: StudioTurn | undefined;
    this.running = controller;
    try {
      data = await this.history();
      const context: ContextDocument[] = [];
      for (const id of documentIDs) {
        assertStudioID(id);
        const saved = await this.repository.read(this.projectID, id);
        if (saved.document.archived)
          throw new Error("Archived files cannot be AI context.");
        context.push({
          id,
          name: saved.document.name,
          revision: saved.document.revision,
          text: await this.ports.text(
            saved.document.name,
            saved.base64,
            controller.signal,
          ),
        });
      }
      if (controller.signal.aborted) throw new Error("AI run canceled.");
      const prompt = studioPrompt(question, context, data.turns);
      turn = {
        id: this.ports.id(),
        createdAt: new Date().toISOString(),
        question,
        provider: config.provider,
        model: config.model,
        context: context.map(({ text: _text, ...doc }) => doc),
        status: "running",
        reply: "",
        changes: [],
      };
      data.turns.push(turn);
      this.activeTurnID = turn.id;
      await this.write(data);
      const raw = await this.ports.run(config, prompt, controller.signal);
      if (controller.signal.aborted) throw new Error("AI run canceled.");
      Object.assign(turn, parseStudioResponse(raw, context, this.ports.id));
      turn.status = "complete";
      await this.write(data);
      return data;
    } catch (error) {
      if (data && turn) {
        turn.status = controller.signal.aborted ? "canceled" : "failed";
        turn.error = error instanceof Error ? error.message : String(error);
        await this.write(data);
      }
      throw error;
    } finally {
      this.running = undefined;
      this.activeTurnID = undefined;
      this.release();
    }
  }
  cancel() {
    this.running?.abort();
  }
  async decide(
    changeID: string,
    decision: "apply" | "reject",
    docxBase64?: string,
    editedAfter?: string,
  ) {
    assertStudioID(changeID);
    if (decision !== "apply" && decision !== "reject")
      throw new Error("Invalid review decision.");
    this.reserve();
    try {
      const data = await this.history();
      const change = data.turns
        .flatMap((turn) => turn.changes)
        .find((change) => change.id === changeID);
      if (!change) throw new Error("Change proposal was not found.");
      if (change.decision !== "pending") return data;
      if (editedAfter !== undefined && decision === "apply") {
        if (
          typeof editedAfter !== "string" ||
          editedAfter.length > 1_000_000 ||
          !["replace", "append", "create"].includes(change.kind)
        )
          throw new Error("Invalid edited proposal.");
        if (change.kind === "replace") {
          const target = await this.repository.read(
            this.projectID,
            change.documentID,
          );
          if (
            /\.docx$/i.test(target.document.name) &&
            /[\r\n]/.test(editedAfter)
          )
            throw new Error("DOCX proposals must stay within one paragraph.");
        }
        if (editedAfter !== change.after) {
          change.proposedAfter ??= change.after;
          change.after = editedAfter;
          // Persist the exact reviewed text before the file commit. A recovered
          // manifest receipt must never attribute user wording to the model.
          await this.write(data);
        }
      }
      if (decision === "reject") change.decision = "rejected";
      else {
        let base64: string | undefined;
        if (change.kind === "create") base64 = this.ports.encode(change.after);
        else if (change.kind === "replace" || change.kind === "append") {
          const saved = await this.repository.read(
            this.projectID,
            change.documentID,
          );
          if (/\.docx$/i.test(saved.document.name)) {
            if (change.kind !== "replace" || !docxBase64)
              throw new Error(
                "Open this DOCX and apply the paragraph proposal in the editor.",
              );
            const before = await this.ports.text(
              saved.document.name,
              saved.base64,
            );
            const after = await this.ports.text(
              saved.document.name,
              docxBase64,
            );
            if (replaceOnce(before, change.before, change.after) !== after)
              throw new Error(
                "DOCX text differs from the reviewed proposal. No bytes were saved.",
              );
            base64 = docxBase64;
          } else {
            if (!TEXT_DOCUMENT.test(saved.document.name))
              throw new Error(
                "Binary document contents are read-only for AI proposals.",
              );
            const text = await this.ports.text(
              saved.document.name,
              saved.base64,
            );
            base64 = this.ports.encode(
              change.kind === "append"
                ? text + change.after
                : replaceOnce(text, change.before, change.after),
            );
          }
        }
        await this.repository.applyChange(this.projectID, change, base64);
        change.decision = "applied";
      }
      await this.write(data);
      return data;
    } finally {
      this.release();
    }
  }
  async newConversation() {
    this.reserve();
    try {
      const data = await this.history();
      if (data.turns.length) await this.archive(data);
      const fresh: StudioConversation = {
        schemaVersion: 1,
        projectID: this.projectID,
        turns: [],
      };
      await this.write(fresh);
      return fresh;
    } finally {
      this.release();
    }
  }
}
