import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { zipSync, strToU8 } from "fflate";
import { StudioRepository } from "../src/modules/studio/repository";
import {
  StudioAIService,
  type StudioAIPorts,
} from "../src/modules/studio/aiService";
import {
  parseStudioResponse,
  replaceOnce,
  STUDIO_AI_SCHEMA,
  validateAIConfig,
} from "../src/modules/studio/aiContracts";
import { nativeStructuredOutputSchemaIssue } from "../src/modules/ai/structuredOutput";
import { documentText } from "../src/modules/studio/documentText";
import {
  runStudioAI,
  studioCLICommand,
  type StudioRunnerPorts,
} from "../src/modules/studio/aiRunner";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";

const encode = (text: string) => Buffer.from(text).toString("base64");
const config = {
  provider: "local" as const,
  model: "fixture-model",
  endpoint: "http://127.0.0.1:11434/v1",
  apiKey: "must-never-persist",
};

test("PDF context can be cited but its original bytes cannot receive text proposals", () => {
  const context = [
    {
      id: "pdf",
      name: "source.pdf",
      revision: 1,
      text: "Evidence from page 1",
    },
  ];
  assert.deepEqual(
    parseStudioResponse(
      JSON.stringify({ reply: "The page reports evidence.", changes: [] }),
      context,
      () => "change",
    ).changes,
    [],
  );
  assert.throws(
    () =>
      parseStudioResponse(
        JSON.stringify({
          reply: "Proposed edit",
          changes: [
            {
              kind: "replace",
              documentID: "pdf",
              expectedRevision: 1,
              name: "",
              before: "Evidence",
              after: "Changed",
              reason: "edit",
            },
          ],
        }),
        context,
        () => "change",
      ),
    /read-only/,
  );
});
function fixture(run: StudioAIPorts["run"]) {
  const disk = new Map<string, string>();
  let counter = 0;
  let failHistory = false;
  const files: ResearchWorkspaceFileOps = {
    exists: async (path) =>
      disk.has(path) ||
      [...disk.keys()].some((key) => key.startsWith(`${path}/`)),
    readText: async (path) => disk.get(path),
    writeTextAtomic: async (path, text) => {
      if (failHistory && path.includes("conversation-v1"))
        throw new Error("disk full");
      disk.set(path, text);
    },
    ensureDirectory: async () => {},
    listDirectory: async (path) =>
      [...disk.keys()].filter((key) => key.startsWith(`${path}/`)),
    remove: async (path) => {
      disk.delete(path);
    },
  };
  const id = () => `fixture-${++counter}`;
  const repository = new StudioRepository("/owned", files, id);
  const service = new StudioAIService("project", repository, {
    root: "/owned",
    files,
    id,
    encode,
    text: (_name, base64) => Buffer.from(base64, "base64").toString("utf8"),
    run,
  });
  return {
    service,
    repository,
    disk,
    fail: () => {
      failHistory = true;
    },
    recover: () => {
      failHistory = false;
    },
  };
}
const proposal = (id: string, revision = 1) => ({
  kind: "replace",
  documentID: id,
  expectedRevision: revision,
  name: "",
  before: "old claim",
  after: "revised claim",
  reason: "Clarify the wording.",
});

test("Studio proposals require unique exact evidence, captured revisions, and strict native schema", () => {
  assert.equal(nativeStructuredOutputSchemaIssue(STUDIO_AI_SCHEMA), undefined);
  assert.throws(
    () => replaceOnce("repeat repeat", "repeat", "edit"),
    /exactly once/,
  );
  assert.throws(() => replaceOnce("missing", "", "edit"), /exactly once/);
  const context = [
    { id: "doc", revision: 1, name: "draft.md", text: "old claim" },
  ];
  assert.throws(
    () =>
      parseStudioResponse(
        JSON.stringify({ reply: "", changes: [proposal("other")] }),
        context,
        () => "change",
      ),
    /outside/,
  );
  assert.throws(
    () =>
      parseStudioResponse(
        JSON.stringify({ reply: "", changes: [proposal("doc", 2)] }),
        context,
        () => "change",
      ),
    /revisions/,
  );
  assert.throws(
    () =>
      parseStudioResponse(
        JSON.stringify({
          reply: "",
          changes: [proposal("doc"), proposal("doc")],
        }),
        context,
        () => "change",
      ),
    /combined/,
  );
});

test("AI runs preserve originals until reviewed; applied changes are versioned and idempotent", async () => {
  let docID = "";
  const { service, repository, disk } = fixture(async (_config, prompt) => {
    assert.match(prompt, /CAPTURED DOCUMENTS/);
    assert.match(prompt, /old claim/);
    return JSON.stringify({
      reply: "Proposed wording.",
      changes: [proposal(docID)],
    });
  });
  const doc = await repository.create(
    "project",
    "draft.md",
    encode("old claim"),
    "You",
  );
  docID = doc.id;
  const history = await service.ask(config, "Clarify this.", [doc.id]);
  assert.equal(
    (await repository.read("project", doc.id)).base64,
    encode("old claim"),
  );
  assert.equal(history.turns[0].context[0].revision, 1);
  const change = history.turns[0].changes[0];
  await service.decide(change.id, "apply");
  await service.decide(change.id, "apply");
  const saved = await repository.read("project", doc.id);
  assert.equal(saved.base64, encode("revised claim"));
  assert.equal(saved.document.revision, 2);
  assert.equal(saved.version.reason, "ai");
  assert.ok([...disk.values()].every((text) => !text.includes(config.apiKey)));
});

test("a newer manual version blocks a stale AI proposal without losing either", async () => {
  let docID = "";
  const { service, repository } = fixture(async () =>
    JSON.stringify({ reply: "", changes: [proposal(docID)] }),
  );
  const doc = await repository.create(
    "project",
    "draft.md",
    encode("old claim"),
    "You",
  );
  docID = doc.id;
  const history = await service.ask(config, "Edit.", [doc.id]);
  await repository.save("project", doc.id, 1, encode("manual edit"), "You");
  await assert.rejects(service.decide(history.turns[0].changes[0].id, "apply"));
  assert.equal(
    (await repository.read("project", doc.id)).base64,
    encode("manual edit"),
  );
  assert.equal(
    (await service.history()).turns[0].changes[0].decision,
    "pending",
  );
});

test("reviewed wording is saved with original AI wording and survives an idempotent retry", async () => {
  let docID = "";
  const { service, repository } = fixture(async () =>
    JSON.stringify({ reply: "", changes: [proposal(docID)] }),
  );
  const doc = await repository.create(
    "project",
    "draft.md",
    encode("old claim"),
    "You",
  );
  docID = doc.id;
  const history = await service.ask(config, "Edit.", [doc.id]);
  const id = history.turns[0].changes[0].id;
  await service.decide(id, "apply", undefined, "User verified wording");
  await service.decide(id, "apply", undefined, "Ignored retry");
  const change = (await service.history()).turns[0].changes[0];
  assert.equal(change.after, "User verified wording");
  assert.equal(change.proposedAfter, "revised claim");
  assert.equal(
    (await repository.read("project", doc.id)).base64,
    encode(change.after),
  );
  assert.equal((await repository.read("project", doc.id)).document.revision, 2);
});

test("an edited proposal cannot commit before its reviewed wording is persisted", async () => {
  let docID = "";
  const { service, repository, fail, recover } = fixture(async () =>
    JSON.stringify({ reply: "", changes: [proposal(docID)] }),
  );
  const doc = await repository.create(
    "project",
    "draft.md",
    encode("old claim"),
    "You",
  );
  docID = doc.id;
  const history = await service.ask(config, "Edit.", [doc.id]);
  fail();
  await assert.rejects(
    service.decide(
      history.turns[0].changes[0].id,
      "apply",
      undefined,
      "user edit",
    ),
    /disk full/,
  );
  recover();
  assert.equal((await repository.read("project", doc.id)).document.revision, 1);
  assert.equal(
    (await service.history()).turns[0].changes[0].after,
    "revised claim",
  );
});

test("manifest receipt recovers a crash between file commit and conversation decision", async () => {
  let docID = "";
  const { service, repository, fail, recover } = fixture(async () =>
    JSON.stringify({ reply: "", changes: [proposal(docID)] }),
  );
  const doc = await repository.create(
    "project",
    "draft.md",
    encode("old claim"),
    "You",
  );
  docID = doc.id;
  const history = await service.ask(config, "Edit.", [doc.id]);
  const change = history.turns[0].changes[0];
  fail();
  await assert.rejects(service.decide(change.id, "apply"), /disk full/);
  recover();
  assert.equal(
    (await service.history()).turns[0].changes[0].decision,
    "applied",
  );
  await service.decide(change.id, "apply");
  assert.equal((await repository.read("project", doc.id)).document.revision, 2);
});

test("cancellation persists canceled state, blocks concurrent operations, and keeps files untouched", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { service } = fixture(async (_config, _prompt, signal) => {
    started();
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("canceled")), {
        once: true,
      }),
    );
  });
  const run = service.ask(config, "Explain.", []);
  await ready;
  await assert.rejects(service.ask(config, "Another.", []), /current/);
  await assert.rejects(service.newConversation(), /current/);
  service.cancel();
  await assert.rejects(run, /canceled/);
  assert.equal((await service.history()).turns[0].status, "canceled");
});

test("local endpoint rejects external hosts and embedded credentials", () => {
  for (const endpoint of [
    "https://example.org/v1",
    "http://localhost.evil.test/v1",
    "file:///tmp/model",
    "http://user:secret@localhost/v1",
    "http://localhost/v1?token=secret",
  ])
    assert.throws(() => validateAIConfig({ ...config, endpoint }));
  validateAIConfig({ ...config, endpoint: "http://[::1]:1234/v1" });
});

test("DOCX context preserves paragraph order, run text, tabs, and excludes deleted text", () => {
  const bytes = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>한글 </w:t></w:r><w:del><w:r><w:t>deleted</w:t></w:r></w:del><w:r><w:t>text</w:t><w:tab/><w:t>value</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  assert.equal(
    documentText(
      "draft.docx",
      bytes,
      (xml) =>
        new DOMParser().parseFromString(
          xml,
          "application/xml",
        ) as unknown as Document,
    ),
    "한글 text\tvalue\nNext",
  );
});

test("CLI commands keep project work read-only or tool-free and isolate customization", () => {
  const job = { directory: "/owned/project/run", executable: "codex" };
  const codex = studioCLICommand({ provider: "codex", model: "fixture" }, job);
  assert.ok(codex.includes("read-only"));
  assert.ok(codex.includes("--ignore-user-config"));
  assert.ok(codex.includes("--ephemeral"));
  const claude = studioCLICommand(
    { provider: "claude", model: "fixture" },
    { ...job, executable: "claude" },
  );
  assert.equal(claude[claude.indexOf("--tools") + 1], "");
  assert.ok(claude.includes("--safe-mode"));
  assert.ok(!claude.includes("--bare"));
});

test("network requests do not follow redirects or silently retry and reject truncated completions", async () => {
  let calls = 0;
  const ports: StudioRunnerPorts = {
    scope: "/owned/network-project/ai",
    prepare: async () => {
      throw new Error("not a CLI");
    },
    read: async () => undefined,
    write: async () => {},
    launch: async () => {},
    stop: async () => {},
    delay: async () => {},
    fetch: async (_url, options) => {
      calls++;
      assert.equal(options?.redirect, "error");
      const body = JSON.parse(String(options?.body));
      assert.deepEqual(body.response_format, {
        type: "json_schema",
        json_schema: {
          name: "paperpilot_studio_response",
          strict: true,
          schema: STUDIO_AI_SCHEMA,
        },
      });
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "length", message: { content: "partial" } },
          ],
        }),
      );
    },
  };
  await assert.rejects(
    runStudioAI(config, "prompt", ports, new AbortController().signal),
    /output limit/,
  );
  assert.equal(calls, 1);
});

test("archived conversations resume without losing the current conversation or crossing projects", async () => {
  const f = fixture(async () =>
    JSON.stringify({ reply: "Recorded", changes: [] }),
  );
  await f.service.ask(config, "First conversation", []);
  await f.service.newConversation();
  const archives = await f.service.conversations();
  assert.equal(archives.length, 1);
  assert.equal(archives[0].title, "First conversation");
  await f.service.ask(config, "Second conversation", []);
  const restored = await f.service.resumeConversation(archives[0].id);
  assert.equal(restored.turns[0].question, "First conversation");
  assert.ok(
    (await f.service.conversations()).some(
      (entry) => entry.title === "Second conversation",
    ),
  );
  await assert.rejects(f.service.resumeConversation("../other"), /identifier/);
  await assert.rejects(f.service.resumeConversation("missing"), /not found/);
  assert.equal(
    (await f.service.history()).turns[0].question,
    "First conversation",
  );
});

test("unconfirmed AI cleanup blocks a replacement runner for the same project", async () => {
  let prepared = 0;
  let allowStop = false;
  const stopped: string[] = [];
  const disk = new Map<string, string>();
  const ports: StudioRunnerPorts = {
    scope: "/owned/cleanup-project/ai",
    prepare: async () => ({
      directory: `/owned/run-${++prepared}`,
      executable: "codex",
    }),
    read: async (path) => disk.get(path),
    write: async (path, text) => {
      disk.set(path, text);
    },
    launch: async () => {
      throw new Error("launch receipt lost");
    },
    stop: async (job) => {
      stopped.push(job.directory);
      if (!allowStop) throw new Error("process still running");
    },
    delay: async () => {},
    fetch: globalThis.fetch,
  };
  const cli = { provider: "codex" as const, model: "fixture" };
  const run = (runnerPorts = ports) =>
    runStudioAI(cli, "prompt", runnerPorts, new AbortController().signal);
  await assert.rejects(run(), /process still running/);
  const recoveredPorts = {
    ...ports,
    launch: async (job: { directory: string }) => {
      disk.set(`${job.directory}/exit-code`, "0");
      disk.set(
        `${job.directory}/stdout.txt`,
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "ok" },
        }),
      );
    },
  };
  await assert.rejects(run(recoveredPorts), /cleanup.*unconfirmed/i);
  assert.equal(prepared, 1);
  allowStop = true;
  assert.equal(await run(recoveredPorts), "ok");
  assert.deepEqual(stopped, ["/owned/run-1", "/owned/run-1", "/owned/run-1"]);
  assert.equal(prepared, 2);
});

test("reviewed DOCX drafts preserve original text and reject altered or incomplete editor bytes", async () => {
  let docID = "";
  const { service, repository } = fixture(async () =>
    JSON.stringify({
      reply: "Evidence is still needed.",
      changes: [
        {
          kind: "draft",
          documentID: docID,
          expectedRevision: 1,
          name: "",
          before: "",
          after: "# Paper\n\n## Results\n\n[Evidence needed: data]",
          reason: "Academic draft",
        },
      ],
    }),
  );
  const doc = await repository.create(
    "project",
    "draft.docx",
    encode("Original paragraph"),
    "You",
  );
  docID = doc.id;
  const history = await service.ask(config, "Draft a paper", [docID]);
  const changeID = history.turns[0].changes[0].id;
  await assert.rejects(service.decide(changeID, "apply"), /Open this DOCX/);
  await assert.rejects(
    service.decide(
      changeID,
      "apply",
      encode("Paper\nResults\n[Evidence needed: data]"),
    ),
    /differs/,
  );
  assert.equal((await repository.read("project", docID)).document.revision, 1);
  const edited = "# Paper\n\n## Results\n\n[Evidence needed: verified data]";
  const bytes = encode(
    "Original paragraph\nPaper\nResults\n[Evidence needed: verified data]",
  );
  await service.decide(changeID, "apply", bytes, edited);
  await service.decide(changeID, "apply", bytes, edited);
  const saved = await repository.read("project", docID);
  assert.equal(saved.document.revision, 2);
  assert.equal(saved.base64, bytes);
  assert.equal(
    (await service.history()).turns[0].changes[0].proposedAfter,
    "# Paper\n\n## Results\n\n[Evidence needed: data]",
  );
});
