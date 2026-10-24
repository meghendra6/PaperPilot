import { portableConversation } from "../src/modules/studio/projectBundle";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  academicDraft,
  academicDraftRequest,
} from "../src/modules/studio/academicDraft";
import {
  parseStudioResponse,
  studioPrompt,
} from "../src/modules/studio/aiContracts";

test("academic drafts retain Unicode and citation placeholders with semantic document styles", () => {
  const draft = academicDraft(
    "# 한글 논문\r\n\r\n## Methods\nA proposed study\nwith [Evidence needed: sample].\n\n### Analysis\n[Citation needed: source]",
  );
  assert.equal(
    draft.text,
    "한글 논문\nMethods\nA proposed study with [Evidence needed: sample].\nAnalysis\n[Citation needed: source]",
  );
  assert.deepEqual(
    draft.content.map((node) => node.attrs.paragraphProperties.styleId),
    ["Title", "Heading1", "Normal", "Heading2", "Normal"],
  );
  for (const text of [
    "",
    "x".repeat(100001),
    "<img src=x>",
    "![figure](x)",
    "| a | b |",
    "```js\ncode\n```",
    "**claim**",
    "- bullet",
    "bad\u0000text",
    Array(501).fill("text").join("\n\n"),
  ])
    assert.throws(() => academicDraft(text));
});

test("draft proposals require the captured DOCX revision and an explicit append format", () => {
  const context = [
    { id: "doc", name: "paper.docx", revision: 2, text: "Existing findings" },
  ];
  const change = {
    kind: "draft",
    documentID: "doc",
    expectedRevision: 2,
    name: "",
    before: "",
    after: "## Results\n\n[Evidence needed: observed results]",
    reason: "Draft for review",
  };
  const parse = (patch: object = {}, docs = context) =>
    parseStudioResponse(
      JSON.stringify({
        reply: "Review the missing evidence",
        changes: [{ ...change, ...patch }],
      }),
      docs,
      () => "change",
    );
  assert.equal(parse().changes[0].decision, "pending");
  assert.throws(() => parse({ expectedRevision: 1 }), /revisions/);
  assert.throws(() => parse({ before: "Existing findings" }), /empty/);
  assert.throws(
    () => parse({}, [{ ...context[0], name: "source.pdf" }]),
    /DOCX/,
  );
  assert.throws(() => parse({ after: "<h1>Title</h1>" }), /plain paragraphs/);
  const prompt = studioPrompt(academicDraftRequest("paper.docx"), context, []);
  for (const contract of [
    "IMRaD",
    "journal",
    "[Evidence needed:",
    "[Citation needed:",
    "Never invent",
    "plain references are not live citation fields",
    "proposals reviewed individually",
  ])
    assert.ok(prompt.includes(contract), contract);
});

test("academic draft review history survives portable project export", () => {
  const data = {
    schemaVersion: 1,
    projectID: "project",
    turns: [
      {
        id: "turn",
        createdAt: "2026-10-24T00:00:00Z",
        question: "Draft",
        provider: "codex",
        model: "model",
        context: [{ id: "doc", name: "paper.docx", revision: 1 }],
        status: "complete",
        reply: "Review",
        changes: [
          {
            id: "change",
            kind: "draft",
            documentID: "doc",
            expectedRevision: 1,
            name: "",
            before: "",
            after: "# Paper",
            reason: "Draft",
            decision: "applied",
          },
        ],
      },
    ],
  };
  assert.equal(
    portableConversation(data, "project").turns[0].changes[0].kind,
    "draft",
  );
});
