# Paper Pilot for Zotero 7

> Languages: [English](./README.md) | [한국어](./README.ko.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

**Paper Pilot turns the Zotero 7 PDF reader into an AI-assisted paper workbench.**

Paper Pilot is an AI reading workbench for the Zotero 7 PDF reader. It adds a paper-scoped chat pane, structured paper tools, related-paper discovery, and local CLI-based AI execution directly inside Zotero.

![Zotero 7](https://img.shields.io/badge/Zotero-7-cc2936) ![Node 20+](https://img.shields.io/badge/Node-20%2B-339933) ![Java 11+](https://img.shields.io/badge/Java-11%2B-007396) ![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue) ![Engines](https://img.shields.io/badge/Engines-Codex%20CLI%20%7C%20Gemini%20CLI-6f42c1)

## At a glance

- AI chat directly inside the Zotero Reader
- Two local engine modes: **Codex CLI** and **Gemini CLI**
- Structured paper workbench for brief, compare, contributions, limitations, and follow-ups
- Structured PDF workspace extraction via **OpenDataLoader PDF**
- Related-paper discovery with open/add-to-collection flows
- Auto-highlight plus persisted paper-scoped session history
- **Paper Mastery** — multi-round Socratic comprehension check with a final Markdown learning report
- Automated local verification is in place; full Zotero runtime QA is still pending

## Screenshots and demo

Screenshots and demo clips are **not checked into the repository yet**.

Recommended visuals to add next:

- the Zotero reader pane with the AI sidebar visible
- a structured **Research brief** card
- grouped **Related papers** recommendations
- the **Compare** workflow and saved artifact flow

If you want to document the UI visually, a good future convention is `docs/images/` plus short linked captions in this section.

## Status

Paper Pilot is under active development.

What is already in place:

- automated local test coverage for core logic
- production build generation for the Zotero add-on
- reader-pane workflows for chat, paper tools, recommendations, and highlighting

What is still required before calling it fully production-ready:

- end-to-end manual QA inside a real Zotero 7 runtime
- broader install and environment validation across real user setups

See [`docs/manual-qa.md`](./docs/manual-qa.md) for the current runtime checklist.

## What the plugin does

### 1. Reader-side AI chat

- Adds an AI pane to the Zotero reader/item pane
- Keeps conversations scoped to the active paper
- Supports per-paper engine switching between Codex CLI and Gemini CLI
- Preserves follow-up continuity within the same paper/session
- Supports **Past sessions** for reopening, renaming, deleting, and clearing saved sessions for the current paper
- Uses **New session** to preserve the current session and start a blank draft for the same paper

### 2. Paper-aware actions from the reader

From PDF selections or annotations, the plugin can seed AI workflows such as:

- **Ask AI**
- **Explain**
- **Summarize**
- **Translate**

### 3. Paper workbench tools

The reader pane includes structured paper workflows for the active paper:

- **Research brief**
- **Compare**
- **Contributions**
- **Limitations**
- **Follow-ups**
- **Save latest to note**
- **Save for collection**
- **Clear cards**

These workflows are designed to produce compact, reader-pane-safe outputs rather than long generic chat responses.

### 4. Related paper discovery

Paper Pilot can generate grouped related-paper recommendations and help you:

- inspect nearby papers by category
- open recommended papers
- add recommended papers to a Zotero collection
- use recommended papers as bounded input for comparison workflows

### 5. Auto-highlight workflow

The plugin includes an auto-highlight path for extracting high-confidence passages from the active paper and surfacing key passages back in the reader workflow.

### 6. Paper Mastery (comprehension check)

The reader pane includes a **Paper Mastery** workflow that drives a multi-round Socratic comprehension check on the active paper:

- The AI generates one open-ended question at a time, scoped to the paper's core contributions, methodology, or assumptions.
- The reader answers in free text; the AI evaluates each answer and records whether a topic was understood.
- When the session ends, a Markdown learning report summarizes strengths, areas for improvement, key misconceptions, and recommended re-reading.

Mastery prompts enforce strict JSON responses for questions and evaluations (no reasoning prose), wrap reader answers in `<user_answer>` tags, and instruct the model not to emit markdown fences around the JSON — while the parser still recovers if a fence slips through. Parsing is string/escape-aware so that a `}` inside a quoted string never truncates a valid response.

### 7. Local workspace artifacts for Codex

When you ask a question in **Codex CLI** mode, Paper Pilot writes a per-paper workspace so the CLI can inspect local paper context before answering.

Typical artifacts include:

- `CONTEXT_INDEX.md`
- `paper.md`
- `paper.json`
- `paper.txt`
- `selection.json`
- `recent-turns.json`
- `metadata.json`
- `annotations.json`
- `figures/`

`paper.md` is the structured Markdown view, `paper.json` carries structured PDF elements plus extraction metadata, and `paper.txt` remains as the compatibility/plain-text fallback. When Java is unavailable, Paper Pilot records the fallback in `metadata.json`.

This keeps Codex grounded in the current paper, selection context, and recent conversation history.
When Java 11+ is available, `paper.md` and `paper.json` come from the bundled OpenDataLoader runtime. If structured extraction is unavailable, Paper Pilot falls back to Zotero `attachmentText` and records that in `metadata.json`.

## Feature overview

| Area              | Current support                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Reader chat       | Paper-scoped AI chat inside Zotero Reader                                                                    |
| Engines           | Codex CLI and Gemini CLI                                                                                     |
| Paper workbench   | Research brief, compare, contributions, limitations, follow-ups                                              |
| Discovery         | Grouped related-paper recommendations                                                                        |
| Persistence       | Save latest output to note, save workbench artifacts for collections                                         |
| Context grounding | Workspace artifacts, OpenDataLoader-backed structured PDF context, retrieval context, recent-turn continuity |
| Highlighting      | Auto-highlight workflow for key passages                                                                     |
| Comprehension     | Paper Mastery multi-round comprehension check with Markdown learning report                                  |

## Engine modes

| Mode         | Best for                       | Current strengths                                                                               |
| ------------ | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Codex CLI`  | workspace-aware paper analysis | local workspace artifacts, resumable runs, model/sandbox/approval controls, optional web search |
| `Gemini CLI` | lighter local paper Q&A        | simpler executable/model setup, paper-scoped continuity, local retrieval/context assembly       |

### Codex CLI mode

Codex mode is the more workspace-oriented path. The current codebase includes support for:

- executable discovery and validation
- login/status checks
- workspace writability checks
- `gpt-5.5` model selection with `low`, `medium`, `high`, and `xhigh` reasoning effort options
- sandbox and approval settings
- optional web-search toggle
- resumable follow-up runs tied to the current paper

### Gemini CLI mode

Gemini mode is the lighter local-CLI path. The current codebase includes support for:

- configurable executable path
- configurable default model
- paper-scoped follow-up continuity
- retrieval/context assembly for the active paper

## How Paper Pilot shapes AI output

Several reader-pane workflows expect structured outputs instead of free-form chat.

Current prompt surfaces include:

- **Research brief**
- **Related paper recommendations**
- **Paper tools**
- **Paper compare**
- **Auto-highlight**
- **Paper Mastery (comprehension check)**
- **Workspace/chat prompt assembly**

See [`docs/prompt-contracts.md`](./docs/prompt-contracts.md) for the exact output-shape intent and guardrails.

## Requirements

- **Zotero 7**
- **Node.js 20+** for development
- **npm** for dependency and build workflows
- **Java 11+** at runtime for OpenDataLoader PDF extraction
- At least one local AI CLI:
  - **Codex CLI**, or
  - **Gemini CLI**

## Development quick start

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build the add-on:

```bash
npm run build
```

OpenDataLoader packaging note:

- `npm run build` copies the OpenDataLoader JAR into `addon/chrome/content/vendor/opendataloader/` before the xpi is packed
- the built add-on bundles that JAR, but still requires a local Java runtime to execute it

`npm start`, `npm run build`, and `npm run release` now vendor the OpenDataLoader runtime JAR into the add-on automatically via [`scripts/prepare-opendataloader.mjs`](./scripts/prepare-opendataloader.mjs).

## Creating a GitHub release

Release publishing is tag-driven. Keep the package version and the tag aligned:

1. Update `package.json` and `package-lock.json` to the release version on `main`.
2. Merge that version bump to `main`.
3. Create and push the matching tag, for example `git tag v0.1.0 && git push origin v0.1.0`.
4. The Release workflow now runs `scripts/check-release-tag-version.mjs` before publishing. It fails fast if the ref name does not exactly match `v${package.json.version}`.

If you use `workflow_dispatch`, run it from the matching release tag ref. Branch refs are rejected by the same guard.

## Build output

A successful build generates the Zotero add-on package in `build/`.

Typical outputs include:

- `build/paper-pilot.xpi`
- `build/update.json`
- `build/update-beta.json`

## Install in Zotero

1. Build the project with `npm run build`.
2. Open Zotero.
3. Install the generated `.xpi` through Zotero's add-on installation flow.
4. Restart Zotero if required.
5. Open a PDF attachment and confirm the **Paper Pilot** reader pane appears.
6. Ask a paper question and inspect the newest workspace to confirm `paper.md`, `paper.json`, and `paper.txt` were written together.
7. Check `metadata.json` and confirm `extractionMethod` is `opendataloader-pdf` when Java is available, or `zotero-attachment-text` when fallback was used.

## First-run checklist

After installing the `.xpi`, this is the fastest way to validate the plugin:

1. Open Zotero settings and configure a local **Codex CLI** or **Gemini CLI** executable path.
2. Open a PDF attachment in Zotero Reader.
3. Open the **Paper Pilot** pane.
4. Select **Codex CLI** or **Gemini CLI**.
5. Ask a question about the current paper.
6. Try one structured workbench action such as **Research brief** or **Compare**.

## Configuration notes

The preferences UI currently exposes settings across these areas:

- **General**
- **Gemini CLI**
- **Codex CLI**
- **Retrieval**
- **Privacy**

Important current details:

- response language is normalized to **English**, **Korean**, or **Chinese**
- runtime code already reads many engine, retrieval, workspace, and privacy preferences
- structured PDF extraction uses a bundled OpenDataLoader JAR and falls back to Zotero `attachmentText` if Java/runtime extraction is unavailable
- full real-runtime QA of every preference path is still part of the remaining manual verification work

## Typical usage flow

1. Open a PDF in Zotero Reader.
2. Open the **Paper Pilot** pane.
3. Choose **Codex CLI** or **Gemini CLI**.
4. Ask a question about the paper.
5. Optionally use a selection or annotation action to seed the next prompt.
6. Use the workbench buttons for structured outputs such as brief, compare, contributions, or follow-ups.
7. Save useful outputs to a note or collection-linked artifact when needed.

## Project structure

```text
addon/      Zotero add-on manifest, locales, preferences UI, static assets
src/        TypeScript source for reader UI, engine integrations, context, tools, and workflows
test/       Node-based regression tests for prompt builders, parsing, storage, and workflow logic
docs/       Manual QA checklist, prompt contracts, and supporting product notes
scripts/    Local Zotero plugin scaffold CLI entrypoint
build/      Generated add-on artifacts
```

Key source areas:

- `src/modules/readerPane.ts` — main reader pane UI and workflow wiring
- `src/modules/codex/` — Codex CLI execution, status, parsing, and command building
- `src/modules/gemini/` — Gemini CLI execution flow
- `src/modules/context/` — paper context retrieval and workspace artifact generation
- `src/modules/autoHighlight/` — highlight extraction workflow
- `src/modules/paperTools.ts` — structured contribution/limitation/follow-up prompts
- `src/modules/researchBrief.ts` — compact per-paper brief generation
- `src/modules/relatedRecommendations.ts` — grouped related-paper recommendations
- `src/modules/paperCompare.ts` — bounded multi-paper comparison flow

## Verification

The repository currently includes automated checks for core logic such as:

- engine mode selection
- Codex command building and shell behavior
- workspace artifact generation, including `paper.md` / `paper.json`
- research brief parsing
- paper-tool parsing
- related-paper recommendation parsing
- compare and artifact-save flows
- auto-highlight parsing/matching

Core commands used during local verification:

```bash
npm test
npm run build
```

Manual runtime verification is still required in Zotero itself. Use [`docs/manual-qa.md`](./docs/manual-qa.md).

## Known limitations

- The project is not yet claiming full production readiness.
- Real Zotero runtime QA is still an explicit remaining step.

## Roadmap

Near-term priorities that are already reflected by the current repo state:

- complete real Zotero runtime QA using [`docs/manual-qa.md`](./docs/manual-qa.md)
- add screenshots and short demo assets under [`docs/images/`](./docs/images/README.md)
- broaden install and environment verification across more real setups
- keep documentation aligned with the evolving reader-pane workflows

## Contributing

Contributions are welcome.

For setup, workflow expectations, and documentation guidance, see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

This project is licensed under **AGPL-3.0-or-later**.

## Additional docs

- [`docs/images/CAPTURE-CHECKLIST.md`](./docs/images/CAPTURE-CHECKLIST.md)
- [`docs/images/README.md`](./docs/images/README.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`docs/manual-qa.md`](./docs/manual-qa.md)
- [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)
