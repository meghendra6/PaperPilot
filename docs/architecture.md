# Architecture

How Paper Pilot is put together. Read this before changing engine, workspace, or
reader-pane code.

Related notes:

- [`prompt-contracts.md`](./prompt-contracts.md) — required output shapes per prompt surface
- [`manual-qa.md`](./manual-qa.md) — real-Zotero runtime checklist
- [`agent-led-research-discovery-and-critical-read-spec.md`](./agent-led-research-discovery-and-critical-read-spec.md) — implemented verified-discovery and seven-step critical-reading specification
- [`../AGENTS.md`](../AGENTS.md) — working agreements and verification expectations

## Runtime shape

Paper Pilot is a Zotero 7-10 bootstrapped add-on. There is no server and no
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
engine/model header and its settings popover, while `ui/collapsibleSection.ts`
owns the accessible Workbench, Find verified prior work, Critical Read, and Past
sessions surfaces. `ui/chatComposerSizing.ts` preserves textarea auto-sizing
without changing the pane height. Disclosure state is serialized in the internal
`paneSectionState` preference through the pure helpers in
`ui/paneSectionState.ts`. The chat transcript takes the remaining space and
scrolls independently from expanded section bodies.

## Engine abstraction

`src/modules/ai/` is the thin layer over the three engines.

| File                    | Role                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `types.ts`              | `EngineMode = "codex_cli" \| "claude_code" \| "gemini_cli"`              |
| `modeStore.ts`          | default mode from prefs, per-item override in `addon.data.modeOverrides` |
| `providerRegistry.ts`   | mode → provider descriptor (label, status)                               |
| `runCompletion.ts`      | cleanup-before-callback ordering for terminal controller transitions     |
| `runControl.ts`         | engine-neutral cancellation and silent-workflow release                  |
| `runFailure.ts`         | source-first failure classification and safe user messages               |
| `runLifecycle.ts`       | shared progress, retry, and token-aware completion state                 |
| `runPresentation.ts`    | item-scoped active-run events that reconnect rebuilt pane DOM            |
| `runProgress.ts`        | pure phase transitions and absolute-deadline calculation                 |
| `runTimeout.ts`         | one watchdog and timeout completion path shared by all engines           |
| `retryEngineRequest.ts` | engine-neutral retry dispatch for the last normal chat request           |
| `workspaceRun.ts`       | mode-dispatching helpers: start a run, read progress, extract text       |

`workspaceRun.ts` is the shared entry point used by non-chat workflows (research
brief, paper tools, compare, verified discovery, Critical Read, auto-highlight,
mastery). It dynamically imports
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
   active if Zotero rebuilds the pane during extraction or process spawn. It
   also creates `addon.data.runProgressStates[itemID]` in `Preparing workspace`.
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
4. The script writes stdout and stderr to separate files, writes the exit code
   when done, and records the detached shell pid. `exec` returns as soon as the
   background job is spawned. Cancellation sends `TERM` to the recorded process
   tree, waits for a bounded grace period, then freezes and `KILL`s any survivors
   before verifying termination and clearing engine state. Pipeline children
   therefore do not outlive the card, including wrappers that ignore `TERM`.
   If the executor cannot confirm termination, the active owner and pid (or the
   direct-workflow reservation) remain in place and workspace cleanup is not
   claimed; the UI reports the stop failure instead of unlocking unsafely. A
   started result or run state must provide a numeric pid—missing pid data is a
   stop failure, not a successful no-op. The no-pid no-op is reserved for a
   cancellation that happens before any process exists.
   Terminal Codex state never retains a killable pid; session cleanup only
   signals a pid while a poller, running state, or active presentation token
   proves that it still belongs to the current run. Codex terminalizes that
   process state before session persistence, so a persistence failure cannot
   leave a stale killable pid after pending ownership is released. If a process appears after
   preparation was cancelled and its first stop cannot be confirmed, the same
   run token is restored to `Running` with Cancel available for another bounded
   termination attempt; ownership is not released in between.
5. `controller` starts a `setInterval` at **800 ms** that reads the output file,
   advances the shared card to `Running`, and stops once the exit-code file is
   non-empty. Codex displays structured assistant output when one is available;
   no controller renders raw in-flight output. A separate card timer updates
   only the elapsed-time node every second. The shared watchdog enforces a
   30-minute absolute limit from workspace preparation onward without treating
   an empty Claude/Gemini output file as a stall.
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
   finished, and stale tokens cannot invoke workflow callbacks. A workflow that
   intentionally chains another run (Paper Mastery follow-up or final report)
   passes the active parent token as an explicit continuation guard; unrelated
   requests remain blocked. Progress and terminal completion are generation
   owned: one controller/timeout/cancel path can claim a token, and an older
   parent finalizer cannot overwrite a chained child. Cancellation during
   workspace preparation keeps a per-item barrier until the old runner settles
   and finishes cleanup, preventing a retry from sharing or deleting its stable
   workspace. Direct Auto Highlight, verified-discovery, and Critical Read runs use the same
   item-scoped reservation boundary, so controller and direct workspace runs
   cannot overlap either. Pending controller completion, direct reservations,
   and Retry claims also block session replacement until their owner settles;
   Normal chat acquires an admission token before reader-context and user-turn
   persistence awaits; Retry and direct workflows acquire the same mutually
   exclusive item-token kind before their first side effect. Silent Workbench,
   Compare, and Mastery workflows enter `running` and enable their persistence
   callback only after that chat admission succeeds; rejected admission invokes
   no completion callback. Session
   Open/New/Delete acquires its own item token before the first cleanup await and
   keeps it until the session mutation and pane rerender complete. Verified discovery
   invokes its state/persistence callback before releasing the direct
   reservation, and a rejected reservation invokes no workflow persistence
   callback.
   If preparation throws after creating a stable workspace, the controller or
   direct-run dispatcher computes that same path and applies configured cleanup.

Failures are classified in `ai/runFailure.ts`. Workspace and timeout sources
take precedence over string matching; executable and login patterns cover all
three CLIs. Session history stores the safe `userMessage` as replayable text and
keeps raw stderr only in `rawEvent`, which the run card exposes under a collapsed
Raw logs disclosure. Direct workspace workflows likewise derive visible text
only from parsed stdout; a non-zero exit without parsed stdout becomes a generic
workflow error instead of exposing stderr. `ui/runProgressCard.ts` renders the
same progress, cancel, retry, settings, and login-help surface for every engine.
Only normal chat turns enter `addon.data.lastEngineRequests`; silent Workbench
Paper Mastery, and Critical Read runs continue to use their own workflow buttons.

Per-engine file names inside the workspace:

| Engine | prompt              | stdout               | stderr              | exit code         | pid              |
| ------ | ------------------- | -------------------- | ------------------- | ----------------- | ---------------- |
| Codex  | `prompt.txt`        | `codex-output.jsonl` | `codex-stderr.log`  | `codex-exit.txt`  | `codex-pid.txt`  |
| Claude | `claude-prompt.txt` | `claude-output.txt`  | `claude-stderr.log` | `claude-exit.txt` | `claude-pid.txt` |
| Gemini | `gemini-prompt.txt` | `gemini-output.txt`  | `gemini-stderr.log` | `gemini-exit.txt` | `gemini-pid.txt` |

Codex emits JSONL events, so `outputParser.ts` extracts the assistant text and
the resumable `thread_id`. Claude runs with `-p --output-format text` and Gemini
returns plain text, so both are read directly.

## Paper workspace artifacts

`context/workspaceArtifacts.ts` builds the payload; the runner writes the files.

| File                        | Written by     | Contents                                                            |
| --------------------------- | -------------- | ------------------------------------------------------------------- |
| `paper.md`                  | all engines    | structured Markdown, or full text if extraction fell back           |
| `paper.json`                | all engines    | structured elements + `extractionMethod` + `extractionNotes`        |
| `paper.txt`                 | all engines    | compatibility snapshot: metadata header plus text                   |
| `metadata.json`             | all engines    | title, authors, year, item/attachment key, abstract                 |
| `selection.json`            | all engines    | `ContextPayload`: selection, page, retrieved chunks, prompt preview |
| `recent-turns.json`         | all engines    | last 3 turns for follow-up continuity                               |
| `annotations.json`          | all engines    | annotation ids tied to this request                                 |
| `CONTEXT_INDEX.md`          | all engines    | reading-order file map                                              |
| `discovery-request.json`    | discovery runs | normalized research concern and current-paper context               |
| `discovery-plan.json`       | discovery runs | agent-owned field, venue, and query planning scaffold               |
| `discovery-candidates.json` | discovery runs | deterministic scholarly-provider candidates                         |
| `discovery-evidence.json`   | discovery runs | official-evidence collection scaffold                               |
| `figures/`                  | Codex only     | empty directory for image assets                                    |

All three engine prompts instruct the agent to read `CONTEXT_INDEX.md`. Discovery
runs additionally stage the four `discovery-*.json` files for a reproducible
candidate-discovery and publication-verification protocol. The agent owns field
and venue judgment; these files standardize inputs and evidence boundaries rather
than imposing a closed conference list. If you add an artifact, add it to every
applicable runner _and_ to the prompt that tells the model to read it.

`discovery/providers/` is the read-only network boundary. Semantic Scholar,
OpenAlex, DBLP, and Crossref receive only bounded query strings and bibliographic
identifiers; they never receive full PDF text, annotations, recent turns, local
paths, or unrelated Zotero metadata. Official-evidence inspection accepts public
HTTPS URLs only, resolves the host through Zotero, rejects private,
link-local, metadata, and special-purpose addresses (including IPv4 embedded
through mapped, NAT64, 6to4, and Teredo IPv6), disables automatic
redirects, and repeats URL, DNS, and connected-remote address checks at every
redirect hop. It reads at most 200 KB of HTML/JSON and cancels PDF bodies.
Timeouts and cancellation remain active through body consumption, and one
absolute discovery deadline covers provider search, the agent run, and live
evidence recheck. Raw pages and review text are not persisted.

The fetched page is authoritative only as inspected source data: Paper Pilot
reconstructs title, venue, track, decision, and review availability from that
page instead of retaining the agent's claimed `supports` fields. OpenReview is
the exception: forum prose is writable by any user, so decision, track, and
review availability come from the official OpenReview API notes (API v2 with a
legacy v1 fallback), fetched for the forum id of the final inspected URL, and
an official decision or track binds only to the API-reported venue surface.
Candidate identity requires DOI or compatible title/year/author evidence, and
venue identity must agree across the plan, paper metadata, assessment, and
inspected page. Open-world hosts qualify only when venue-owned structural
program or proceedings authority is established. Public-review links stay
hidden until this live reconstruction succeeds.

Discovery admission uses one observed capability snapshot for the whole run.
Codex binds its configured web-search state at admission; Claude Code and Gemini
fail closed for verified discovery until Paper Pilot can observe a usable web
capability instead of assuming one from the executable alone.

`extractionMethod` is `opendataloader-pdf` when Java 11+ ran the bundled JAR, and
`zotero-attachment-text` on fallback. Several prompts key their confidence
language off this, so keep it accurate.

## Prompt surfaces

Prompt construction and response parsing live next to the workflow they serve.
`context/promptPreviewBuilder.ts` holds the shared workspace preamble and the
common answer-style rules used by all three engines.

| Workflow           | Module                                             | Output                                       |
| ------------------ | -------------------------------------------------- | -------------------------------------------- |
| Chat / workspace   | `context/promptPreviewBuilder.ts`                  | free text                                    |
| Research brief     | `researchBrief.ts`                                 | strict JSON                                  |
| Paper tools        | `paperTools.ts`                                    | strict JSON                                  |
| Paper compare      | `paperCompare.ts`                                  | strict JSON                                  |
| Verified discovery | `discovery/prompt.ts`, `relatedRecommendations.ts` | strict JSON in three evidence lanes          |
| Review insight     | `discovery/prompt.ts`                              | strict JSON from public review content       |
| Critical Read      | `criticalRead/prompt.ts`                           | strict JSON per step, Markdown final report  |
| Auto-highlight     | `autoHighlight/prompt.ts`                          | strict JSON                                  |
| Paper Mastery      | `comprehensionCheck/prompt.ts`                     | strict JSON per round, Markdown final report |

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

Snapshots also retain the inferred discovery scope, optional user concern,
three result lanes, evidence links, and Critical Read step/report state. A live
Critical Read run is serialized as resumable, non-running state so reopening
Zotero never starts a second model process implicitly. Public review text is not
stored; only generated insight summaries and their public source links may be
saved. Current live-verifier provenance permits reconstructed publication
evidence to survive a restart; legacy or model-authored claims without that
marker reopen for verification. The marker is generation-specific, so verifier
hardening invalidates older reconstructed evidence. Critical Read step outputs are parsed again on
migration, and reports are rebuilt from that validated state rather than shown
from serialized Markdown.

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
