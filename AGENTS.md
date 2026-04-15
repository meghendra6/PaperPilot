# AGENTS.md

This file guides coding agents and contributors working in the Paper Pilot repository.

## Project intent

Paper Pilot is a Zotero 7 plugin that turns the PDF reader into an AI-assisted paper workbench. The repo mixes reader-pane UI code, local CLI provider integration, paper-context/workspace generation, and structured prompt/parsing logic.

Default goal: make small, verifiable changes that keep the reader experience compact, paper-grounded, and honest about runtime limitations.

## Repository map

- `src/`
  - `modules/readerPane.ts`, `readerActions.ts`: reader UI wiring and action flow
  - `modules/researchBrief.ts`, `paperTools.ts`, `paperCompare.ts`, `relatedRecommendations.ts`: structured paper workflows
  - `modules/comprehensionCheck/`: Paper Mastery prompts, parser, and round/topic state
  - `modules/session/`: paper-scoped session history service, snapshot capture/apply, and the silent-turn filter that keeps tool JSON out of replayed chat
  - `modules/.../prompt*.ts`, `modules/context/promptPreviewBuilder.ts`: prompt assembly and output-shape guardrails
  - `modules/paperArtifact*.ts`: persistence/reuse of paper artifacts
  - `utils/`: shared helpers
- `addon/`: Zotero addon bootstrap, prefs, and packaged addon resources
- `scripts/prepare-opendataloader.mjs`: vendors the OpenDataLoader runtime before build/release
- `scripts/zotero-plugin-cli.mjs`: development/build/release entrypoint
- `typings/`: Zotero and project-specific type shims
- `test/`: Node-based regression tests for prompts, parsing, workflow logic, CLI integration, and artifact generation
- `docs/manual-qa.md`: required real-Zotero runtime checklist
- `docs/prompt-contracts.md`: expected structured output shapes and prompt guardrails
- `README*.md`: user-facing product and setup docs in multiple languages

## Core command surface

- `npm install`: local development setup
- `npm ci`: clean reproducible install for verification or worktrees
- `npm test`: Node-based regression suite
- `npx tsc --noEmit`: TypeScript typecheck (`addon/` is excluded by `tsconfig.json`)
- `npm run build`: packages the Zotero add-on and vendors the OpenDataLoader runtime
- `npx eslint <paths>` / `npx prettier --check <paths>`: preferred read-only lint/style checks on touched files
- Avoid `npm run lint` as a default verification step because it runs write/fix operations across the repo

## Working principles

- Prefer focused diffs over broad rewrites.
- Preserve paper-scoped behavior, compact reader-pane output, and clear separation between evidence and inference.
- Keep docs aligned with the codebase; do not describe roadmap ideas as shipped features.
- Prefer omission over fabrication when changing prompts, parsers, or paper summaries.
- Reuse existing patterns and utilities before introducing new abstractions.

## Change guidance by area

### Reader/UI changes

- Keep the Zotero reader pane usable on limited vertical space.
- Avoid introducing layouts that crowd chat history, controls, or workbench cards.
- If behavior is user-visible, update README/docs when the change affects setup, limitations, or workflows.
- Changes under `addon/` are not covered by `tsc`; review them carefully and prefer real Zotero validation when behavior or packaging changes.

### Prompt / structured-output changes

- Read `docs/prompt-contracts.md` before editing prompt or parser code.
- Preserve the required output shape for the touched workflow.
- Keep outputs compact and paper-grounded.
- Make unsupported or inferred content explicit rather than presenting it as a fact.
- Add or update focused regression tests whenever prompt contracts, parsing, or structured rendering changes.
- If a contract changes, update `docs/prompt-contracts.md` in the same PR.

### Provider / workspace / CLI changes

- Keep Codex CLI and Gemini CLI behavior scoped to the active paper.
- Preserve workspace grounding behavior and compatibility fallbacks.
- If you touch OpenDataLoader or packaging flow, verify the build path still vendors the runtime correctly.
- Changes under `scripts/` are not covered by the repo ESLint config, so review changed `.mjs` files carefully and use targeted checks such as `node --check <file>` when relevant.

### Docs changes

- Keep readiness claims conservative.
- Preserve the distinction between automated verification and real Zotero runtime QA.
- If shared product positioning or setup guidance changes, update translated README files that exist in-tree when the shared meaning changes.

## Verification expectations

Run the lightest set that proves the change, then report exactly what ran. Prefer read-only checks before auto-fixing commands.

- Baseline environment setup when dependencies are missing: `npm ci`
- Documentation-only changes: manual review of links, commands, and consistency
- Prompt/parser/workflow logic: `npm test` plus focused test updates
- Type-sensitive changes under `src/` or `typings/`: `npx tsc --noEmit`
- Build/packaging changes: `npm run build`
- Lint/format validation: prefer targeted `npx eslint <paths>` and `npx prettier --check <paths>` to avoid unrelated repo-wide churn on a dirty tree; do not run `npm run lint` unless you intentionally want repo-wide writes/fixes
- Runtime-sensitive reader changes: use `docs/manual-qa.md` for Zotero checks when feasible

If you cannot run a relevant check, say so explicitly and explain why.

## Git hygiene

- Work on a focused branch.
- Do not mix unrelated workspace changes into the same commit or PR.
- If the main checkout is dirty, prefer a clean worktree or otherwise isolate your changes before editing.
- Before committing, inspect `git diff --stat` and `git status --short` to ensure only intended files are included.

## Pull request expectations

PRs should include:

- what changed and why
- files/areas touched
- verification performed
- any manual QA not performed yet
- screenshots or demo updates if the user-visible reader UI changed materially

## Avoid stale or generic guidance

Do not turn this file into a generic orchestration manifesto. Keep it repository-specific.
Avoid hardcoding volatile details such as temporary branches, one-off task plans, model marketing copy, or speculative future architecture.
