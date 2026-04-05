import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildResearchBriefQuestion,
  parseResearchBriefResponse,
} from "../src/modules/researchBrief";

test("buildResearchBriefQuestion includes strict JSON instructions and paper metadata", () => {
  const prompt = buildResearchBriefQuestion({
    getField: (field: string) => {
      if (field === "title") return "A Paper About Tooling";
      if (field === "year") return "2026";
      if (field === "abstractNote")
        return "This paper studies research workflows.";
      return "";
    },
    getCreators: () => [{ firstName: "Ada", lastName: "Lovelace" }],
  } as any);

  assert.match(prompt, /Return ONLY one strict JSON object/i);
  assert.match(prompt, /Title: A Paper About Tooling/);
  assert.match(prompt, /Authors: Ada Lovelace/);
  assert.match(prompt, /Abstract: This paper studies research workflows\./);
  assert.match(prompt, /searchQueries/);
  assert.match(prompt, /omit the claim instead of guessing/i);
  assert.match(prompt, /reader-pane-safe/i);
  assert.match(prompt, /no markdown fences/i);
  assert.match(prompt, /include at most 5 items per list/i);
  assert.match(
    prompt,
    /summarize explicit paper claims first; reserve follow-up questions for gaps or next checks/i,
  );
});

test("buildResearchBriefQuestion includes preferred response language guidance", () => {
  const prompt = buildResearchBriefQuestion(
    {
      getField: () => "",
      getCreators: () => [],
    } as any,
    "Korean",
  );

  assert.match(prompt, /Respond in Korean/i);
  assert.match(prompt, /Use English technical terms/i);
});

test("parseResearchBriefResponse parses direct JSON and trims empty entries", () => {
  const brief = parseResearchBriefResponse(
    JSON.stringify({
      summary: "  Useful summary. ",
      contributions: [" Contribution 1 ", ""],
      methods: ["Method 1"],
      limitations: ["Limitation 1"],
      followUpQuestions: ["Question 1"],
      searchQueries: [
        { query: "query one", rationale: "why" },
        { query: "  " },
      ],
    }),
  );

  assert.deepEqual(brief, {
    summary: "Useful summary.",
    contributions: ["Contribution 1"],
    methods: ["Method 1"],
    limitations: ["Limitation 1"],
    followUpQuestions: ["Question 1"],
    searchQueries: [{ query: "query one", rationale: "why" }],
  });
});

test("parseResearchBriefResponse parses fenced JSON and clamps long lists", () => {
  const brief = parseResearchBriefResponse(
    `\`\`\`json\n${JSON.stringify({
      summary: "Summary.",
      contributions: Array.from(
        { length: 7 },
        (_, index) => `Contribution ${index}`,
      ),
      methods: ["Method"],
    })}\n\`\`\``,
  );

  assert.equal(brief.contributions.length, 5);
  assert.equal(brief.contributions[0], "Contribution 0");
});

test("parseResearchBriefResponse extracts JSON embedded in prose", () => {
  const brief = parseResearchBriefResponse(
    `Here is your brief:\n${JSON.stringify({
      summary: "Embedded summary.",
      methods: ["Embedded method"],
    })}\nUse it well.`,
  );

  assert.equal(brief.summary, "Embedded summary.");
  assert.deepEqual(brief.methods, ["Embedded method"]);
});

test("parseResearchBriefResponse rejects malformed JSON", () => {
  assert.throws(
    () => parseResearchBriefResponse("not json"),
    /invalid research brief json/i,
  );
});

test("parseResearchBriefResponse rejects responses without usable sections", () => {
  assert.throws(
    () =>
      parseResearchBriefResponse(
        JSON.stringify({
          summary: "Summary only.",
          contributions: [],
          methods: [],
          limitations: [],
          followUpQuestions: [],
          searchQueries: [],
        }),
      ),
    /did not include any usable sections/i,
  );
});
