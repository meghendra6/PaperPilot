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

### Workspace / chat prompt

- File: `src/modules/context/promptPreviewBuilder.ts`
- Purpose: steer Codex to inspect the local paper workspace before answering
- Shape: instruction preamble plus the user request
- Guardrails:
  - read workspace artifacts before answering
  - separate workspace-grounded claims from inference and web findings
  - keep answers compact for the reader-pane environment
  - follow any requested output schema exactly
