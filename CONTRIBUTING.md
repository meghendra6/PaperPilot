# Contributing to Paper Pilot

Thanks for contributing to Paper Pilot.

## Scope

This repository contains a Zotero 7 plugin that adds an AI reader workbench with local CLI integrations such as Codex CLI and Gemini CLI.

## Development environment

Recommended baseline:

- Zotero 7
- Node.js 20+
- npm
- at least one local provider CLI if you want to validate real provider flows

## Core local commands

Please make sure you can run the core local workflows:

```bash
npm install
npm test
npm run build
```

## Project map

Important areas to understand before making changes:

- `src/modules/readerPane.ts` — main reader UI and workflow wiring
- `src/modules/codex/` — Codex CLI execution, status, shell, parsing, and command building
- `src/modules/gemini/` — Gemini CLI execution flow
- `src/modules/context/` — paper context retrieval and workspace artifact generation
- `src/modules/autoHighlight/` — highlight extraction workflow
- `src/modules/researchBrief.ts` — structured brief generation
- `src/modules/paperTools.ts` — contributions/limitations/follow-ups prompts and parsing
- `src/modules/relatedRecommendations.ts` — grouped paper recommendation flow
- `src/modules/paperCompare.ts` — bounded paper comparison flow
- `test/` — regression tests for prompts, parsing, and workflow logic

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
