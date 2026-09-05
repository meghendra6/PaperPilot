import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  createCriticalReadLocalizer,
  localizeCriticalReadStatus,
} from "../src/modules/criticalRead/localization";
import { buildCriticalReadNoteHtml } from "../src/modules/note/criticalReadNote";
import { buildInitialCriticalReadState } from "../src/modules/criticalRead/workflow";

test("known discovery and restored-session statuses localize; unknown diagnostics remain intact", () => {
  for (const language of ["Korean", "Chinese"]) {
    for (const status of [
      "Understanding the research question",
      "Selecting fields and leading venues",
      "Searching scholarly sources",
      "Verifying publication status",
      "Analyzing relevance and novelty",
      "Preparing results",
      "The previous Critical Read run was interrupted. Resume the current step.",
      "Critical Read complete. Review or save the report.",
    ]) {
      assert.notEqual(localizeCriticalReadStatus(status, language), status);
    }
    assert.equal(
      localizeCriticalReadStatus(
        "Provider E42: /tmp/output.json {detail}",
        language,
      ),
      "Provider E42: /tmp/output.json {detail}",
    );
  }
  assert.equal(
    localizeCriticalReadStatus("Save failed: disk full", "Korean"),
    "저장 실패: disk full",
  );
  assert.equal(
    createCriticalReadLocalizer("unknown")("Critical Read"),
    "Critical Read",
  );
  assert.equal(
    createCriticalReadLocalizer("Korean")(
      "Step {step} reopened. Only dependent outputs were invalidated.",
      {
        step: "{step}",
      },
    ),
    "{step}단계를 다시 열었습니다. 이 단계에 의존하는 결과만 초기화했습니다.",
    "template values must not be interpolated recursively",
  );
});

test("saved note labels follow the selected language without translating or unescaping evidence", () => {
  const state = buildInitialCriticalReadState();
  state.steps[0].readerInput =
    "Reader assessment <script>keep as text</script>";
  state.steps[0].output = {
    summary: "Original English synthesis",
    items: [],
    sourceLocators: ["p. 2"],
    limitations: [],
    scanObservations: {
      abstractSignal: "Original quote",
      figureTableSignals: [],
      openQuestions: [],
    },
  };
  const before = JSON.stringify(state);
  for (const [responseLanguage, heading, empty] of [
    ["Korean", "Critical Read", "기록 없음"],
    ["Chinese", "Critical Read", "未记录"],
    ["English", "Critical Read", "Not recorded"],
  ]) {
    const html = buildCriticalReadNoteHtml({
      paperTitle: "An English Paper",
      state,
      responseLanguage,
    });
    assert.ok(html.includes(`# ${heading}: An English Paper`));
    assert.ok(html.includes(empty));
    assert.ok(html.includes("Original English synthesis"));
    assert.ok(html.includes("Original quote"));
    assert.ok(
      html.includes(
        "Reader assessment &lt;script&gt;keep as text&lt;/script&gt;",
      ),
    );
    assert.ok(!html.includes("<script>"));
  }
  assert.equal(JSON.stringify(state), before);
});
