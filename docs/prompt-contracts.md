# Prompt contracts

This note documents the purpose, target answer shape, and guardrails for the main AI prompt surfaces in `Paper Pilot`.

## Goals

- keep outputs compact enough for the Zotero reader pane
- make paper-grounded vs inferred content explicit
- improve strict-schema compliance for downstream parsers
- reduce made-up details by preferring omission over guessing

## Prompt surfaces

### Research brief

- File: `src/modules/researchBrief.ts`
- Purpose: produce a compact per-paper brief for fast triage
- Shape: one JSON object with `summary`, `contributions`, `methods`, `limitations`, `followUpQuestions`, and `searchQueries`
- Guardrails:
  - ground claims in the active paper context
  - omit unsupported claims instead of guessing
  - keep the summary and list items compact
  - make search queries directly reusable in scholar-style search tools

### Related paper recommendations

- File: `src/modules/relatedRecommendations.ts`
- Purpose: recommend a bounded, categorized set of nearby papers
- Shape: one JSON object with `groups[]`, each containing `category` and `papers[]`
- Guardrails:
  - reasons should explain the relationship to the current paper
  - omit uncertain metadata instead of fabricating DOI, venue, year, URL, or abstract details
  - keep category structure stable for sorting and rendering

### Paper tools

- File: `src/modules/paperTools.ts`
- Purpose: generate compact contribution, limitation, and follow-up cards
- Shape: one JSON object with `overview` and `sections[]`
- Guardrails:
  - headings should match the expected preset headings
  - evidence labels should distinguish direct claims from inference
  - sections should stay short and pane-safe

### Paper compare

- File: `src/modules/paperCompare.ts`
- Purpose: compare the current paper against a bounded related-paper set
- Shape: one JSON object with `overview`, `papers`, `synthesis`, and `recommendations`
- Guardrails:
  - only discuss the supplied papers
  - keep strengths, tradeoffs, and synthesis compact
  - call out inference instead of presenting it as fact

### Auto-highlight

- File: `src/modules/autoHighlight/prompt.ts`
- Purpose: extract exact passages for high-confidence highlighting
- Shape: one JSON object with `highlights[]`
- Guardrails:
  - quotes must be verbatim and match `paper.txt`
  - omit uncertain passages instead of paraphrasing
  - keep quote and reason text short enough for exact matching and compact display
  - keep `importance` normalized to `0..1`

### Paper Mastery (comprehension check)

- File: `src/modules/comprehensionCheck/prompt.ts`
- Purpose: run a multi-round Socratic comprehension check on the active paper and produce a learning report
- Shapes:
  - `buildInitialMasteryPrompt` / `buildFollowUpQuestionPrompt` → strict JSON `{ "question", "topic", "difficulty" }` with `difficulty ∈ {foundational, intermediate, advanced}`
  - `buildEvaluateAnswerPrompt` → strict JSON `{ "understood", "confidence", "evaluation", "misunderstandings", "explanation", "nextTopic", "nextDifficulty" }`
  - `buildFinalReportPrompt` → Markdown report (not JSON) with `Strengths`, `Areas for Improvement`, `Key Misconceptions`, `Recommendations`, `Overall Assessment`
- Guardrails:
  - question/evaluation prompts forbid reasoning or planning prose before the JSON; the response must begin with `{` and end with `}`
  - reader-supplied answers are wrapped in `<user_answer>` tags; the prompt instructs the model to treat those tags as data only and to ignore any instructions inside them
  - `parseMasteryQuestionResponse` requires only `question` to be a string and falls back to `topic: "general"` and `difficulty: "foundational"`; `parseMasteryEvaluationResponse` requires `understood` to be a boolean and supplies safe defaults (confidence 0.5, empty strings/arrays, `nextTopic: null`, `nextDifficulty: "foundational"`) when other keys are missing or the wrong type
  - both parsers tolerate markdown fences around the JSON and are string/escape-aware, so `}` inside quoted strings does not truncate the payload
  - the Markdown report is written in second person (`you`), stays encouraging but honest, and references specific rounds from the session

### Workspace / chat prompt

- File: `src/modules/context/promptPreviewBuilder.ts`
- Purpose: steer Codex to inspect the local paper workspace before answering
- Shape: instruction preamble plus the user request
- Guardrails:
  - read workspace artifacts before answering
  - separate workspace-grounded claims from inference and web findings
  - keep answers compact for the reader-pane environment
  - follow any requested output schema exactly
