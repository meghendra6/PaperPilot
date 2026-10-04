import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRunAnswer } from "../src/modules/ai/workspaceRun";

test("successful CLI exits cannot complete empty or unreadable chat answers", () => {
  for (const parsedOutput of [
    "",
    "  ",
    '{"paperpilotChatVersion":1,"answerMarkdown":"unfinished',
    '{"paperpilotChatVersion":1,"answerMarkdown":42,"citationCandidates":[]}',
    '{"paperpilotChatVersion":1,"answerMarkdown":"  ","citationCandidates":[]}',
    '{"paperpilotChatVersion":1,"answerMarkdown":"file:///private/answer","citationCandidates":[]}',
  ]) {
    const answer = resolveRunAnswer({
      profile: "chat",
      parsedOutput,
      exitCode: "0",
    });
    assert.equal(answer.success, false, parsedOutput);
    assert.equal(answer.invalidAnswer, true, parsedOutput);
    assert.deepEqual(answer.citationCandidates, []);
  }
});

test("readable recovered chat text succeeds without promoting malformed citations", () => {
  const answer = resolveRunAnswer({
    profile: "chat",
    parsedOutput: String.raw`{"paperpilotChatVersion":1,"answerMarkdown":"$\alpha \cdot x$","citationCandidates":[`,
    exitCode: "0",
  });
  assert.equal(answer.success, true);
  assert.equal(answer.invalidAnswer, false);
  assert.equal(answer.answerMarkdown, String.raw`$\alpha \cdot x$`);
  assert.deepEqual(answer.citationCandidates, []);
});

test("valid JSON escapes retain their meaning in chat answers", () => {
  const markdown =
    String.raw`$\frac{a}{b}$, $\theta$, $\nabla$, $\beta$, $\rho$` +
    '\n"quote"';
  const answer = resolveRunAnswer({
    profile: "chat",
    parsedOutput: JSON.stringify({
      paperpilotChatVersion: 1,
      answerMarkdown: markdown,
      citationCandidates: [],
    }),
    exitCode: "0",
  });
  assert.equal(answer.success, true);
  assert.equal(answer.answerMarkdown, markdown);
});

test("complete chat strings recover raw line breaks and control characters", () => {
  const markdown =
    "First line\nSecond\tcolumn\r\n" +
    Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join(
      "",
    );
  const answer = resolveRunAnswer({
    profile: "chat",
    parsedOutput: `{"paperpilotChatVersion":1,"answerMarkdown":"${markdown}","citationCandidates":[]}`,
    exitCode: "0",
  });
  assert.equal(answer.success, true);
  assert.equal(answer.answerMarkdown, markdown);
  assert.deepEqual(answer.citationCandidates, []);
});

test("a readable answer does not override process or provider failure", () => {
  for (const status of [
    { exitCode: "1" },
    { exitCode: "0", providerFailed: true },
  ]) {
    const answer = resolveRunAnswer({
      profile: "chat",
      parsedOutput: "partial answer",
      ...status,
    });
    assert.equal(answer.success, false);
    assert.equal(answer.invalidAnswer, false);
  }
});

test("analysis and discovery retain their own structured-output contract", () => {
  const parsedOutput = '{"paperpilotChatVersion":1,"answerMarkdown":""}';
  for (const profile of ["analysis", "discovery"] as const) {
    const answer = resolveRunAnswer({ profile, parsedOutput, exitCode: "0" });
    assert.equal(answer.answerMarkdown, parsedOutput);
    assert.equal(answer.success, true);
    assert.equal(
      resolveRunAnswer({ profile, parsedOutput: "", exitCode: "0" }).success,
      false,
    );
  }
});
