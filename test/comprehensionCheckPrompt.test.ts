import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildInitialMasteryPrompt,
  buildEvaluateAnswerPrompt,
  buildFollowUpQuestionPrompt,
  parseMasteryQuestionResponse,
  parseMasteryEvaluationResponse,
} from "../src/modules/comprehensionCheck/prompt";

// --- parseMasteryQuestionResponse ---

test("parseMasteryQuestionResponse extracts valid JSON from raw text", () => {
  const raw = 'Here is a question: {"question":"What is the core contribution?","topic":"contribution","difficulty":"foundational"}';
  const result = parseMasteryQuestionResponse(raw);
  assert.ok(result);
  assert.equal(result.question, "What is the core contribution?");
  assert.equal(result.topic, "contribution");
  assert.equal(result.difficulty, "foundational");
});

test("parseMasteryQuestionResponse returns undefined for missing question field", () => {
  const raw = '{"topic":"methodology","difficulty":"advanced"}';
  const result = parseMasteryQuestionResponse(raw);
  assert.equal(result, undefined);
});

test("parseMasteryQuestionResponse returns undefined for garbage input", () => {
  assert.equal(parseMasteryQuestionResponse("no json here"), undefined);
  assert.equal(parseMasteryQuestionResponse(""), undefined);
});

test("parseMasteryQuestionResponse defaults topic and difficulty when missing", () => {
  const raw = '{"question":"Explain the method"}';
  const result = parseMasteryQuestionResponse(raw);
  assert.ok(result);
  assert.equal(result.topic, "general");
  assert.equal(result.difficulty, "foundational");
});

test("parseMasteryQuestionResponse handles multiple JSON objects (non-greedy)", () => {
  const raw = 'Result: {"question":"Q1","topic":"t","difficulty":"foundational"} and also {"extra":"stuff"}';
  const result = parseMasteryQuestionResponse(raw);
  assert.ok(result);
  assert.equal(result.question, "Q1");
});

test("parseMasteryQuestionResponse handles nested braces in values", () => {
  const raw = '{"question":"Explain {x: 1} format","topic":"syntax","difficulty":"foundational"}';
  const result = parseMasteryQuestionResponse(raw);
  assert.ok(result);
  assert.equal(result.question, "Explain {x: 1} format");
});

// --- parseMasteryEvaluationResponse ---

test("parseMasteryEvaluationResponse extracts a complete evaluation", () => {
  const raw = `{"understood":true,"confidence":0.85,"evaluation":"Good explanation.","misunderstandings":[],"explanation":"","nextTopic":"results","nextDifficulty":"intermediate"}`;
  const result = parseMasteryEvaluationResponse(raw);
  assert.ok(result);
  assert.equal(result.understood, true);
  assert.equal(result.confidence, 0.85);
  assert.equal(result.evaluation, "Good explanation.");
  assert.deepEqual(result.misunderstandings, []);
  assert.equal(result.nextTopic, "results");
  assert.equal(result.nextDifficulty, "intermediate");
});

test("parseMasteryEvaluationResponse handles null nextTopic for mastery", () => {
  const raw = `{"understood":true,"confidence":0.95,"evaluation":"Excellent.","misunderstandings":[],"explanation":"","nextTopic":null,"nextDifficulty":"advanced"}`;
  const result = parseMasteryEvaluationResponse(raw);
  assert.ok(result);
  assert.equal(result.nextTopic, null);
});

test("parseMasteryEvaluationResponse returns undefined when understood is not boolean", () => {
  const raw = `{"understood":"yes","confidence":0.5,"evaluation":"ok"}`;
  assert.equal(parseMasteryEvaluationResponse(raw), undefined);
});

test("parseMasteryEvaluationResponse returns undefined for garbage", () => {
  assert.equal(parseMasteryEvaluationResponse("nope"), undefined);
});

test("parseMasteryEvaluationResponse defaults missing optional fields", () => {
  const raw = `{"understood":false}`;
  const result = parseMasteryEvaluationResponse(raw);
  assert.ok(result);
  assert.equal(result.confidence, 0.5);
  assert.equal(result.evaluation, "");
  assert.deepEqual(result.misunderstandings, []);
  assert.equal(result.explanation, "");
  assert.equal(result.nextTopic, null);
  assert.equal(result.nextDifficulty, "foundational");
});

// --- buildInitialMasteryPrompt ---

test("buildInitialMasteryPrompt returns a prompt asking for JSON", () => {
  const prompt = buildInitialMasteryPrompt();
  assert.match(prompt, /JSON/);
  assert.match(prompt, /question/);
  assert.match(prompt, /topic/);
  assert.match(prompt, /difficulty/);
});

// --- buildEvaluateAnswerPrompt ---

test("buildEvaluateAnswerPrompt includes question, answer, and history", () => {
  const prompt = buildEvaluateAnswerPrompt(
    "What is attention?",
    "It is a mechanism for weighting inputs",
    [{ question: "Prev Q", userAnswer: "Prev A", evaluation: "Good", understood: true }],
  );
  assert.match(prompt, /What is attention\?/);
  assert.match(prompt, /weighting inputs/);
  assert.match(prompt, /Prev Q/);
  assert.match(prompt, /Round 1/);
});

test("buildEvaluateAnswerPrompt works with empty history", () => {
  const prompt = buildEvaluateAnswerPrompt("Q?", "A.", []);
  assert.match(prompt, /Q\?/);
  assert.match(prompt, /A\./);
  assert.ok(!prompt.includes("Previous Q&A rounds"));
});

// --- buildFollowUpQuestionPrompt ---

test("buildFollowUpQuestionPrompt includes topic and difficulty", () => {
  const prompt = buildFollowUpQuestionPrompt(
    [{ question: "Q1", userAnswer: "A1", evaluation: "OK", understood: false }],
    "methodology",
    "intermediate",
  );
  assert.match(prompt, /methodology/);
  assert.match(prompt, /intermediate/);
  assert.match(prompt, /Round 1/);
});

// --- History trimming (MAX_HISTORY = 6) ---

function makeRounds(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Q${i + 1}`,
    userAnswer: `A${i + 1}`,
    evaluation: `Eval${i + 1}`,
    understood: i % 2 === 0,
  }));
}

test("buildEvaluateAnswerPrompt trims history beyond 6 rounds", () => {
  const rounds = makeRounds(8);
  const prompt = buildEvaluateAnswerPrompt("Current Q", "Current A", rounds);
  // Should indicate skipped rounds
  assert.match(prompt, /2 earlier rounds omitted/);
  // Should NOT contain the first 2 rounds
  assert.ok(!prompt.includes("Q1\nA:"), "Round 1 should be trimmed");
  assert.ok(!prompt.includes("Q2\nA:"), "Round 2 should be trimmed");
  // Should contain rounds 3-8 with correct numbering
  assert.match(prompt, /Round 3/);
  assert.match(prompt, /Round 8/);
});

test("buildEvaluateAnswerPrompt shows all rounds when <= 6", () => {
  const rounds = makeRounds(5);
  const prompt = buildEvaluateAnswerPrompt("Q?", "A.", rounds);
  assert.ok(!prompt.includes("earlier rounds omitted"));
  assert.match(prompt, /Round 1/);
  assert.match(prompt, /Round 5/);
});

test("buildFollowUpQuestionPrompt trims history beyond 6 rounds", () => {
  const rounds = makeRounds(9);
  const prompt = buildFollowUpQuestionPrompt(rounds, "results", "advanced");
  assert.match(prompt, /3 earlier rounds omitted/);
  assert.match(prompt, /Round 4/);
  assert.match(prompt, /Round 9/);
  assert.ok(!prompt.includes("Q1\nA:"), "Round 1 should be trimmed");
});

test("buildEvaluateAnswerPrompt includes round counter", () => {
  const rounds = makeRounds(4);
  const prompt = buildEvaluateAnswerPrompt("Q?", "A.", rounds);
  assert.match(prompt, /round 5/i);
});
