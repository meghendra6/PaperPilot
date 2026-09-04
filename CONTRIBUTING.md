# Contributing to Paper Pilot

Thanks for contributing to Paper Pilot.

## Scope

This repository contains a Zotero 7-10 plugin that adds an AI reader workbench with local CLI integrations: Codex CLI, Claude Code, and Gemini CLI.

## Development environment

Recommended baseline:

- Zotero 7, 8, 9, or 10
- Node.js 20+
- npm
- Java 11+ if you want OpenDataLoader-backed structured PDF extraction instead of the text fallback
- at least one local provider CLI if you want to validate real provider flows

`scripts/doctor.sh` runs a quick local setup check.

## Core local commands

Please make sure you can run the core local workflows:

```bash
npm install
npm test
npm run build
```

## Project map

Start with [`docs/architecture.md`](./docs/architecture.md) for how the pieces fit together and how a single AI run actually executes.

Important areas to understand before making changes:

- `src/modules/readerPane.ts` — main reader UI and workflow wiring
- `src/modules/ai/` — engine mode union, per-paper mode override, provider registry, shared run helpers
- `src/modules/codex/` — Codex CLI execution, status, shell, parsing, and command building
- `src/modules/claude/` — Claude Code execution flow
- `src/modules/gemini/` — Gemini CLI execution flow
- `src/modules/context/` — paper context retrieval and workspace artifact generation
- `src/modules/workspace/` — workspace paths, writability probe, cleanup, collection artifact bundles
- `src/modules/researchWorkspace/` — project persistence, verified evidence, multi-paper capabilities, and project-window UI
- `src/modules/discovery/` — provider search, evidence verification, ranking, prompts, and parsing
- `src/modules/criticalRead/` — reader-first Critical Read workflow
- `src/modules/ui/` — reusable pane controls, transcript windowing, and popover behavior
- `src/modules/components/`, `message/`, `note/` — reusable rendering and note/message output
- `src/modules/tools/` — PDF extraction, paper workspace content, and paper actions
- `src/modules/translation/` — response-language and translation helpers
- `src/modules/autoHighlight/` — highlight extraction workflow
- `src/modules/researchBrief.ts` — structured brief generation
- `src/modules/paperTools.ts` — contributions/limitations/follow-ups prompts and parsing
- `src/modules/relatedRecommendations.ts` — grouped paper recommendation flow
- `src/modules/paperCompare.ts` — bounded paper comparison flow
- `src/modules/comprehensionCheck/` — Paper Mastery prompts, parser, and session state
- `src/modules/session/` — paper-scoped session history, snapshot apply/capture, silent-turn filter
- `test/` — regression tests for prompts, parsing, and workflow logic

Coding agents should also read [`AGENTS.md`](./AGENTS.md), which carries the same expectations in agent-facing form.

## Contribution guidelines

When making changes, please:

- keep claims in docs aligned with the current codebase
- avoid describing features as complete unless they are actually implemented and verified
- keep reader-pane output compact and paper-grounded where applicable
- update tests when changing parsing, prompt-shape, or workflow logic
- update docs when changing user-facing behavior, setup, limitations, or screenshots
- preserve the distinction between automated verification and real Zotero runtime QA

## What to verify

Use the lightest verification that still proves the change.

### Documentation-only changes

- review links, headings, and examples manually
- update multilingual docs together when the shared meaning changes

### Parser / prompt / workflow logic changes

- run `npm test`
- add or update focused tests under `test/`

### Build or packaging changes

- run `npm run build`
- confirm expected artifacts still appear in `build/`

### Reader-pane or runtime-sensitive changes

- use [`docs/manual-qa.md`](./docs/manual-qa.md) for manual Zotero validation where relevant

## Suggested workflow

1. Create a focused branch.
2. Make your changes.
3. Run the relevant verification commands.
4. Update documentation if user-facing behavior changed.
5. Include testing notes in your pull request.

## Documentation and translation notes

The repo now includes multilingual README files:

- `README.md`
- `README.ko.md`
- `README.zh-CN.md`
- `README.zh-TW.md`

If you change shared product positioning, major feature descriptions, installation guidance, or known limitations, update the translated README files as well.
Keep the four `At a glance` lists aligned to the same number of product capabilities.

## Screenshot and demo assets

If you add screenshots or demo assets, use these references:

- [`docs/images/README.md`](./docs/images/README.md)
- [`docs/images/CAPTURE-CHECKLIST.md`](./docs/images/CAPTURE-CHECKLIST.md)

## Pull request checklist

Before opening a PR, confirm:

- changes are scoped and explained clearly
- relevant tests/build steps were run
- docs were updated where needed
- screenshots/demo assets were refreshed if UI changed materially
- claims about readiness or completeness remain accurate

## Runtime validation note

Automated tests cover a large part of the core logic, but real Zotero runtime QA is still important for reader-pane behavior, provider setup, and end-to-end usability.
