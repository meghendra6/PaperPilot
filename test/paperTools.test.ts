import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  PAPER_TOOL_PRESETS,
  buildPaperToolQuestion,
  getPaperToolPreset,
  parsePaperToolResponse,
} from "../src/modules/paperTools";

test("paper tool presets expose the roadmap starter workflows", () => {
  assert.deepEqual(
    PAPER_TOOL_PRESETS.map((preset) => preset.id),
    ["summarize-contributions", "extract-limitations", "suggest-follow-ups"],
  );
});

test("getPaperToolPreset returns grounded prompts for the reader pane", () => {
  const summarize = getPaperToolPreset("summarize-contributions");
  const limitations = getPaperToolPreset("extract-limitations");
  const followUps = getPaperToolPreset("suggest-follow-ups");

  assert.ok(summarize);
  assert.match(summarize!.prompt, /Main contributions/);

  assert.ok(limitations);
  assert.match(
    limitations!.prompt,
    /limitations, assumptions, and likely failure modes/i,
  );

  assert.ok(followUps);
  assert.match(followUps!.prompt, /3 concrete follow-up experiments/i);
});

test("buildPaperToolQuestion adds strict JSON instructions and paper metadata", () => {
  const prompt = buildPaperToolQuestion(
    {
      getField: (field: string) => {
        if (field === "title") return "Structured Tooling for Papers";
        if (field === "year") return "2026";
        if (field === "abstractNote")
          return "A study of structured research workflows.";
        return "";
      },
      getCreators: () => [{ firstName: "Grace", lastName: "Hopper" }],
    } as any,
    "summarize-contributions",
  );

  assert.match(prompt, /Return ONLY one strict JSON object/i);
  assert.match(prompt, /Title: Structured Tooling for Papers/);
  assert.match(prompt, /Authors: Grace Hopper/);
  assert.match(prompt, /evidence":"explicit\|inference\|mixed/);
  assert.match(
    prompt,
    /omit the bullet instead of filling with generic advice/i,
  );
  assert.match(prompt, /reader-pane-safe/i);
  assert.match(prompt, /keep each section heading aligned with one of:/i);
  assert.match(prompt, /include at most 5 sections/i);
  assert.match(prompt, /include at most 4 bullets per section/i);
  assert.match(
    prompt,
    /use evidence=explicit for direct paper claims, inference for extrapolation, mixed when both are present/i,
  );
});

test("buildPaperToolQuestion includes preferred response language guidance", () => {
  const prompt = buildPaperToolQuestion(
    {
      getField: () => "",
      getCreators: () => [],
    } as any,
    "extract-limitations",
    "Chinese",
  );

  assert.match(prompt, /Respond in Chinese/i);
  assert.match(prompt, /Use English technical terms/i);
});

test("parsePaperToolResponse parses fenced JSON and preserves evidence labels", () => {
  const result = parsePaperToolResponse(
    `\`\`\`json\n${JSON.stringify({
      overview: "Useful overview.",
      sections: [
        {
          heading: "Problem",
          bullets: ["The paper addresses slow research review."],
          evidence: "explicit",
        },
        {
          heading: "Main contributions",
          bullets: ["Adds compact structured outputs."],
          evidence: "mixed",
        },
      ],
    })}\n\`\`\``,
    "summarize-contributions",
  );

  assert.equal(result.overview, "Useful overview.");
  assert.equal(result.sections[0].evidence, "explicit");
  assert.equal(result.sections[1].heading, "Main contributions");
});

test("parsePaperToolResponse rejects outputs without expected sections", () => {
  assert.throws(
    () =>
      parsePaperToolResponse(
        JSON.stringify({
          overview: "Overview only",
          sections: [
            {
              heading: "Unexpected section",
              bullets: ["Not grounded"],
              evidence: "explicit",
            },
          ],
        }),
        "extract-limitations",
      ),
    /expected sections/i,
  );
});

test("parsePaperToolResponse normalizes unsupported evidence labels to mixed", () => {
  const result = parsePaperToolResponse(
    JSON.stringify({
      overview: "Overview",
      sections: [
        {
          heading: "Idea 1",
          bullets: ["Test on broader benchmarks"],
          evidence: "unsupported",
        },
      ],
    }),
    "suggest-follow-ups",
  );

  assert.deepEqual(result.sections, [
    {
      heading: "Idea 1",
      bullets: ["Test on broader benchmarks"],
      evidence: "mixed",
    },
  ]);
});

test("parsePaperToolResponse rejects malformed JSON", () => {
  assert.throws(
    () => parsePaperToolResponse("not json", "extract-limitations"),
    /invalid paper tool json/i,
  );
});
