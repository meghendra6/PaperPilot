# Architecture

How Paper Pilot is put together. Read this before changing engine, workspace, or
reader-pane code.

Related notes:

- [`prompt-contracts.md`](./prompt-contracts.md) — required output shapes per prompt surface
- [`manual-qa.md`](./manual-qa.md) — real-Zotero runtime checklist
- [`../AGENTS.md`](../AGENTS.md) — working agreements and verification expectations

## Runtime shape

Paper Pilot is a Zotero 7-9 bootstrapped add-on. There is no server and no
network client for model calls: every AI run shells out to a **local CLI**
already installed and authenticated on the user's machine.

```text
Zotero Reader (XUL/HTML pane)
  └── src/modules/readerPane.ts        pane assembly and workflow wiring
        ├── modules/ui/                header, sections, composer sizing
        └── <engine>/controller.ts     run lifecycle + polling
              └── <engine>/runner.ts   workspace build + process launch
                    └── /bin/zsh -lc "<background script>"
                          └── codex | claude | gemini CLI
                                └── reads the paper workspace directory
```

`src/index.ts` installs a singleton `Addon` onto `Zotero[config.addonInstance]`.
`src/addon.ts` holds all cross-call mutable state in `addon.data` — run states,
pollers, per-item mode overrides, card state, session id. `src/hooks.ts` wires
Zotero lifecycle events (`onStartup`, `onMainWindowLoad`, `onShutdown`) and
registers the preference pane and reader pane section.

Because state lives on `addon.data` keyed by `itemID`, **almost everything is
paper-scoped**. Preserve that when adding features: leaking state across papers
is the most common regression in this codebase.

The pane itself uses a bounded flex column. `ui/paneHeader.ts` owns the compact
engine/model header and its settings popover, `ui/collapsibleSection.ts` owns
the accessible Workbench, Related papers, and Past sessions disclosures, and
`ui/chatComposerSizing.ts` preserves textarea auto-sizing without changing the
pane height. Disclosure state is serialized in the internal
`paneSectionState` preference through the pure helpers in
`ui/paneSectionState.ts`. The chat transcript takes the remaining space and
scrolls independently from expanded section bodies.

## Engine abstraction

`src/modules/ai/` is the thin layer over the three engines.

| File                  | Role                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `types.ts`            | `EngineMode = "codex_cli" \| "claude_code" \| "gemini_cli"`              |
| `modeStore.ts`        | default mode from prefs, per-item override in `addon.data.modeOverrides` |
| `providerRegistry.ts` | mode → provider descriptor (label, status)                               |
| `runCompletion.ts`    | cleanup-before-callback ordering for terminal controller transitions     |
| `runPresentation.ts`  | item-scoped active-run events that reconnect rebuilt pane DOM            |
| `workspaceRun.ts`     | mode-dispatching helpers: start a run, read progress, extract text       |

`workspaceRun.ts` is the shared entry point used by non-chat workflows (research
brief, paper tools, compare, auto-highlight, mastery). It dynamically imports
the engine runner so the three engine modules stay independently loadable.

Each engine then has a parallel module with the same five files:

```text
src/modules/{codex,claude,gemini}/
  runner.ts      builds the workspace, builds the command, launches the process
  controller.ts  owns the run lifecycle: guard, poll, persist, clean up
  runState.ts    per-item run state in addon.data
  poller.ts      clears the setInterval for an item
  stopRun.ts     kills the process by recorded pid
```

Codex has extra modules because it exposes the most surface: `commandBuilder.ts`,
`executable.ts` / `executableSelection.ts`, `environment.ts`, `shell.ts`,
`outputParser.ts` (JSONL events), `status.ts` / `statusClassification.ts`
(login state), `modelOptions.ts` / `modelHistory.ts`, `diagnostics.ts`,
`authAction.ts`.

`modelOptions.ts` under `codex/` is shared by all three engines — it holds the
normalizers for Claude and Gemini model lists too. The filename is historical.

## How one run works

This is the single most important non-obvious mechanism in the repo.

Zotero's environment cannot stream a child process, so runs are **file-based and
polled**:

1. `controller.handleXQuestion` refuses to start if a run is already active for
   this `itemID`.
2. Before workspace preparation, the controller registers an item-scoped
   activity in `ai/runPresentation.ts`. This keeps provider and session guards
   active if Zotero rebuilds the pane during extraction or process spawn.
3. `runner.startXRunForQuestion`:
   - resolves the executable path and reads prefs (model, sandbox, permissions)
   - computes the workspace path: `{workspaceRoot}/{itemID}-{slugified-title}`
     (`workspace/pathBuilder.ts`)
   - extracts paper content via `tools/paperWorkspaceContent.ts` — OpenDataLoader
     when Java is available, falling back to Zotero `attachmentText`
   - chunks and retrieves top-K passages (`context/indexStore.ts`,
     `context/retriever.ts`)
   - writes the workspace artifacts (see below)
   - builds the CLI argv and wraps it in a **detached background shell script**
     (`codex/shell.ts` for Codex; inline in the runner for Claude and Gemini)
   - runs `Zotero.Utilities.Internal.exec("/bin/zsh", ["-lc", script])`
4. The script redirects stdout+stderr to an output file, writes the exit code to
   a separate file when done, and echoes the pid to a third file. `exec` returns
   as soon as the background job is spawned.
5. `controller` starts a `setInterval` at **800 ms** that reads the output file,
   renders partial text into the chat bubble, and stops once the exit-code file
   is non-empty.
6. On completion the controller sanitizes the text
   (`message/assistantOutput.ts`), persists the turn via
   `session/sessionHistoryService.ts`, updates run state, and calls
   `workspace/cleanup.ts`. `ai/runCompletion.ts` guarantees that cleanup
   finishes before a workflow callback can launch a nested run in the same
   stable per-paper workspace. The controller also closes the item-scoped
   activity in `ai/runPresentation.ts`; the currently mounted pane then
   re-renders from persisted session/workflow state. This keeps a run connected
   to the visible pane even when Zotero rebuilds its DOM during a paper or tab
   switch. Session replacement is blocked until this terminal transition has
   finished, and stale tokens cannot invoke workflow callbacks.

Per-engine file names inside the workspace:

| Engine | prompt              | output               | exit code         | pid              |
| ------ | ------------------- | -------------------- | ----------------- | ---------------- |
| Codex  | `prompt.txt`        | `codex-output.jsonl` | `codex-exit.txt`  | `codex-pid.txt`  |
| Claude | `claude-prompt.txt` | `claude-output.txt`  | `claude-exit.txt` | `claude-pid.txt` |
| Gemini | `gemini-prompt.txt` | `gemini-output.txt`  | `gemini-exit.txt` | `gemini-pid.txt` |

Codex emits JSONL events, so `outputParser.ts` extracts the assistant text and
the resumable `thread_id`. Claude runs with `-p --output-format text` and Gemini
returns plain text, so both are read directly.

## Paper workspace artifacts

`context/workspaceArtifacts.ts` builds the payload; the runner writes the files.

| File                | Written by     | Contents                                                            |
| ------------------- | -------------- | ------------------------------------------------------------------- |
| `paper.md`          | all engines    | structured Markdown, or full text if extraction fell back           |
| `paper.json`        | all engines    | structured elements + `extractionMethod` + `extractionNotes`        |
| `paper.txt`         | all engines    | compatibility snapshot: metadata header plus text                   |
| `metadata.json`     | all engines    | title, authors, year, item/attachment key, abstract                 |
| `selection.json`    | all engines    | `ContextPayload`: selection, page, retrieved chunks, prompt preview |
| `recent-turns.json` | all engines    | last 3 turns for follow-up continuity                               |
| `annotations.json`  | all engines    | annotation ids tied to this request                                 |
| `CONTEXT_INDEX.md`  | **Codex only** | reading-order file map                                              |
| `figures/`          | **Codex only** | empty directory for image assets                                    |

Only the Codex prompt instructs the model to read `CONTEXT_INDEX.md`, which is
why the other two engines do not write it. If you add an artifact, add it to the
engine's runner _and_ to the prompt that tells the model to read it — otherwise
it is dead weight in the workspace.

`extractionMethod` is `opendataloader-pdf` when Java 11+ ran the bundled JAR, and
`zotero-attachment-text` on fallback. Several prompts key their confidence
language off this, so keep it accurate.

## Prompt surfaces

Prompt construction and response parsing live next to the workflow they serve.
`context/promptPreviewBuilder.ts` holds the shared workspace preamble and the
common answer-style rules used by all three engines.

| Workflow         | Module                            | Output                                       |
| ---------------- | --------------------------------- | -------------------------------------------- |
| Chat / workspace | `context/promptPreviewBuilder.ts` | free text                                    |
| Research brief   | `researchBrief.ts`                | strict JSON                                  |
| Paper tools      | `paperTools.ts`                   | strict JSON                                  |
| Paper compare    | `paperCompare.ts`                 | strict JSON                                  |
| Related papers   | `relatedRecommendations.ts`       | strict JSON                                  |
| Auto-highlight   | `autoHighlight/prompt.ts`         | strict JSON                                  |
| Paper Mastery    | `comprehensionCheck/prompt.ts`    | strict JSON per round, Markdown final report |

Every shape is specified in [`prompt-contracts.md`](./prompt-contracts.md).
Parsers are deliberately tolerant — they strip markdown fences and are
string/escape-aware so a `}` inside a quoted value does not truncate the payload.

## Persistence

Two layers, easy to confuse:

- **`message/messageStore.ts`** — in-memory chat transcript for the live pane.
- **`session/sessionHistoryRepository.ts`** — on-disk, versioned
  (`SESSION_HISTORY_STORAGE_VERSION`), per-paper session index plus snapshots.
  `sessionHistoryService.ts` is the API the controllers call;
  `sessionSnapshot.ts` captures and reapplies pane state when a session reopens.

`silentTurnFilter.ts` hides assistant turns that are raw tool JSON. Structured
workflows pass `suppressChatMessages`, but sessions saved before that existed
still contain the JSON, so the filter detects it heuristically at replay time.
It ignores fenced code blocks so legitimate JSON in chat stays visible.

Paper Mastery state includes its completed Markdown report, so a custom-section
refresh can hydrate both an awaiting question and a completed session without
starting another model run. Restarting a completed mastery session is an
explicit, confirmed replacement of that saved state. Terminal workflow
callbacks persist the updated derived state after the silent assistant turn,
so the saved snapshot includes the report/card rather than the earlier
`running` state.

Zotero-facing persistence is separate: `note/paperArtifactNote.ts` writes child
notes, and `workspace/artifactBundle.ts` packages collection-linked artifact sets.

## Preferences

Preferences are declared in three places that must stay in sync:

1. `addon/prefs.js` — runtime defaults (`__prefsPrefix__` is substituted at build)
2. `typings/prefs.d.ts` — generated by zotero-plugin-scaffold, but committed
3. `addon/chrome/content/preferences.xhtml` — the settings UI

Read them through `utils/prefs.ts` (`getPref` / `setPref`), never
`Zotero.Prefs` directly. Groups: General, Claude Code, Gemini CLI, Codex CLI,
Retrieval, Privacy.

## Build and release

`zotero-plugin.config.ts` drives zotero-plugin-scaffold. `src/index.ts` is
esbuild-bundled to
`build/addon/chrome/content/scripts/paperpilot.js` targeting `firefox115`;
everything under `addon/**` is copied as-is and `__placeholder__` tokens are
substituted from `package.json.config`.

`scripts/prepare-opendataloader.mjs` vendors the OpenDataLoader JAR into
`addon/chrome/content/vendor/opendataloader/` before `start`, `build`, and
`release`. The JAR ships in the xpi; Java is still required at runtime.

Release is tag-driven. `.github/workflows/release.yml` runs
`scripts/check-release-tag-version.mjs`, which fails unless the ref is exactly
`v${package.json.version}`, then runs tests, build, and publish. It skips
publishing if the release already exists.

## Testing

`test/*.test.ts` runs on the Node test runner through `ts-node/register`. There
is no Zotero runtime in tests, so the suite covers **pure logic only**: prompt
builders, parsers, command builders, path/artifact construction, state machines.

Modules that touch Zotero read their globals lazily (see the
`getGlobalZotero()` pattern in `session/sessionHistoryRepository.ts`) so they can
be imported and exercised with injected fakes. Follow that pattern when you want
new code to be testable.

Anything requiring a real reader pane, real subprocess, or real Zotero item is
covered by [`manual-qa.md`](./manual-qa.md) instead.

## Known rough edges

- `src/modules/readerPane.ts` is still large and wires every pane workflow. Add
  new rendering logic in a focused `modules/ui/` module and wire it in, rather
  than growing this file.
- The three engine modules are near-duplicates by design (isolation over reuse).
  Shared behavior belongs in `ai/workspaceRun.ts`, not in cross-engine imports.
- `addon/` is excluded from `tsconfig.json`, so `bootstrap.js`,
  `preferences.xhtml`, and `prefs.js` get no typecheck. Validate them in Zotero.
- `scripts/*.mjs` is outside the ESLint config. Use `node --check <file>`.
