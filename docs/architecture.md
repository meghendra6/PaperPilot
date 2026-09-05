# Architecture

How Paper Pilot is put together. Read this before changing engine, workspace, or
reader-pane code.

Related notes:

- [`prompt-contracts.md`](./prompt-contracts.md) — required output shapes per prompt surface
- [`manual-qa.md`](./manual-qa.md) — real-Zotero runtime checklist
- [`research-workspace-redesign-spec.md`](./research-workspace-redesign-spec.md) — delivered Research Workspace phases plus remaining rollout and runtime-verification proposals
- [`agent-led-research-discovery-and-critical-read-spec.md`](./agent-led-research-discovery-and-critical-read-spec.md) — implemented verified-discovery and seven-step critical-reading specification
- [`../AGENTS.md`](../AGENTS.md) — working agreements and verification expectations

## Runtime shape

Paper Pilot is a Zotero 7-10 bootstrapped add-on. There is no server and no
network client for model calls: every AI run shells out to a **local CLI**
already installed and authenticated on the user's machine.

```text
Zotero item panes
  ├── src/modules/readerPane.ts              reader chat and workbench
  └── modules/researchWorkspace/view.ts      single- and multi-paper tools
        └── modules/researchWorkspace/       feature service and typed analysis core
              └── modules/ai/workspaceRun.ts
                    └── <engine>/runner.ts   workspace build + process launch
                          └── codex | claude | gemini CLI
                                └── reads the paper workspace directory
```

`src/index.ts` installs a singleton `Addon` onto `Zotero[config.addonInstance]`.
`src/addon.ts` holds all cross-call mutable state in `addon.data` — run states,
pollers, per-item mode overrides, card state, session id. `src/hooks.ts` wires
Zotero lifecycle events (`onStartup`, `onMainWindowLoad`, `onShutdown`) and
registers the preference pane, reader pane section, and integrated Research
Workspace section.

Because state lives on `addon.data` keyed by `itemID`, **almost everything is
paper-scoped**. Preserve that when adding features: leaking state across papers
is the most common regression in this codebase.

The pane itself uses a bounded flex column. `ui/paneHeader.ts` owns the compact
engine/model header and its settings popover, while `ui/collapsibleSection.ts`
owns the accessible Workbench, Find verified prior work, and Past sessions
surfaces. Critical Read is rendered within Workbench. `ui/chatComposerSizing.ts` preserves textarea auto-sizing
without changing the pane height. Disclosure state is serialized in the internal
`paneSectionState` preference through the pure helpers in
`ui/paneSectionState.ts`. The chat transcript takes the remaining space and
scrolls independently from expanded section bodies. `ui/chatTranscriptWindow.ts`
keeps a sliding 48-message DOM window, shifts it in 16-message steps near the
scroll boundaries, and restores suspended messages from the in-memory session
record when needed. The full transcript remains available to session
persistence and engine resume logic; only expensive rendered Markdown nodes are
detached.

## Integrated Research Workspace boundary

`src/modules/researchWorkspace/` owns the paper- and project-level research
features. `view.ts` renders the full single-paper operation surface and is also
embedded in the project window. `projectWindowView.ts` renders project UI,
`window.ts` owns the modeless-window singleton and captured state, and `menu.ts`
registers its launchers. Library selection is captured once by
`selectionSnapshot.ts` and handed to the project controller; project actions
never depend on a later live-selection read. This keeps the workflow reachable
when Zotero replaces the ordinary item pane for a multi-selection.

The feature service reuses `ai/workspaceRun.ts` with the `analysis` profile.
It therefore follows the active Paper Pilot engine choice, never resumes or
mutates visible-chat provider sessions, and shares the existing reservation,
cancellation, timeout, and workspace-cleanup contracts. Paper loading reuses
`tools/paperWorkspaceContent.ts`, preferring OpenDataLoader PDF and retaining the
Zotero attachment-text fallback. When a child attachment row is selected,
extraction is bound to that exact attachment rather than the parent item's first
PDF. A canonical `zotero:<libraryID>:<itemKey>:<attachmentKey>` source ID
prevents personal- and group-library collisions. The extraction cache is keyed
by that source ID plus an attachment version/mtime/size fingerprint; a changed
fingerprint marks persisted paper outputs stale without deleting them. There is
no second manifest, bootstrap, provider configuration, subprocess adapter, or
XPI.

Model-produced evidence is treated as a candidate locator. Before an artifact
is persisted, `researchWorkspace/evidenceVerification.ts` resolves only its
admitted library-scoped source and reuses the auto-highlight PDF matcher for an
exact local quote match. Page geometry is derived from that local match; model
bounding boxes are never promoted. Verified references are navigable through
`evidenceNavigation.ts`, which performs one `libraryID + attachmentKey` lookup
and never scans other libraries. Unverified, not-found, and unavailable-source
references remain labelled but have no Open in PDF action.
Structured element IDs can retain section and page metadata, but they remain
unverified unless the response also supplies text that is matched against the
local PDF. A locator alone never enters the verified claim or contradiction
sets.

Research Workspace durable state remains separate from transient run
workspaces under `<Zotero profile>/paperpilot-research-workspace/`. The current
store uses revisioned `catalog-v1.json` and `preferences-v1.json`, shared source
records, a legacy migration marker, and one directory per project containing
`project.json`, `members.json`, `change-inbox.json`, `sync-receipts/`, artifacts,
and runs. Derived caches and user-requested exports live under separate `cache/`
and `exports/` directories. Each file replacement is atomic and revision
guarded; a workflow that touches several files is not a transaction.
Startup recovery reconciles `project.json` with valid artifact and run files,
re-links files left behind by an interrupted write, quarantines unreadable
orphans, repairs missing membership files, and rebuilds stale catalog entries.
The legacy `workspace-v3.json`
is read only by the migration adapter, which preserves supported papers and
artifacts while dropping companion provider settings and Research Monitor
state.

Screening is a local user-decision workflow. Project criteria live in the
project scope; each include, exclude, or maybe action appends an immutable event
to the member record with a protocol snapshot, source snapshot, stage, reason,
and supersession link. Deterministic DOI or exact title-and-year duplicate
signals and missing-PDF signals are advisory only. The semantic review-log
projection and JSON/CSV exports include the complete decision history; they do
not invoke a model or silently finalize a decision.

The contradiction and evidence-gap dashboard is a selection-independent local
derivation over saved project artifacts. It admits only complete artifacts whose
source fingerprints match the current non-excluded project scope, then checks
each evidence reference for the current local verifier, a supported local
locator method, and exact library/attachment identity. A rule-detected
contradiction candidate requires one concrete shared outcome or metric,
opposite evidence-linked directions from different sources, and at least two
exactly matching stored design dimensions; explicit design differences are
labelled non-comparable and missing comparability remains uncertain. Locator
verification does not prove entailment or truth. Derived artifact lineage
records upstream artifact payload fingerprints and the member revision.
Updating, deleting, or superseding an upstream artifact recursively marks
dependent artifacts stale; source changes invalidate every project sharing that
source.
User confirmation, reclassification, and dismissal are append-only review
events and never overwrite the deterministic classification.

Living Review is a project-local, metadata-only freshness boundary. One Zotero
item observer is registered after persistence recovery and unregistered with
its exact handle at add-on shutdown. Notification bursts wake a serialized,
coalesced scan of active projects; notifier item IDs are not trusted as the
source set. Stable library and attachment keys resolve each source, PDF
version/mtime/size and annotation key/version/date metadata produce snapshots,
and the first scan is baselined without false alerts. A member added after that
baseline becomes an explicit `project-source-added` inbox event. PDF changes
and unavailable sources invalidate dependent artifacts in
every project sharing the source, while annotation-only changes remain visible
without invalidation because artifact lineage does not yet admit annotation
fingerprints. The path reads no PDF or annotation text and starts no model,
CLI, or network request. Review and dismissal are revision-guarded and
submission-idempotent.

Citation & Reference Health is a project-local deterministic derivation over
current, complete Citation Context, Citation Stance, Methodology Audit, and
Reproducibility artifacts. It rechecks reference identity against bounded local
Zotero bibliographic metadata, surfaces local correction/retraction terms only
as non-authoritative signals, groups contrasting citation purposes, and carries
saved method/reproduction risks forward with their existing evidence boundary.
An optional imported text/Markdown draft is reduced to a bounded fingerprint
and bounded excerpt before persistence; unsupported-statement candidates are a
lexical coverage check against admitted saved artifacts, not entailment or a
truth judgment. Optional external-provider snapshots are supplementary and
their coverage/limitations remain explicit. The derived artifact records every
upstream payload fingerprint and the current members revision through
`runDerived`; no aggregate truth or scientific-quality score is produced.

Research project templates are an immutable local registry with five starting
points: exploratory literature review, systematic review, reproduction project,
technology comparison, and paper reading group. The creation surface shows an
editable preview before any project is written. A project stores an immutable
snapshot of the registry definition plus separately editable assumptions and
capability preset IDs in additive schema-v1 fields. Presets only add visible
recommendation emphasis to existing controls; they never start a capability,
remove another capability, or change its permission boundary. JSON and Markdown
project exports retain both the original template snapshot and the current
editable settings.

Safe Zotero collection and tag sync is a separate project-scoped write path,
not a Research Workspace artifact. It resolves only stable `(libraryID,
itemKey)` bibliographic identities and an optional stable `(libraryID,
collectionKey)` target, lists existing collections and tags, and produces a
complete additive-only preview. The approval token is derived from the exact
preview, including project member revision and observed Zotero state; any
project or library drift rejects the preview. Before the first Zotero mutation,
Paper Pilot writes a revisioned receipt under the project `sync-receipts/`
directory. Apply and undo both require `Zotero.DB.executeTransaction`; missing
transaction support fails closed. The runtime never creates or deletes items,
collections, tags, attachments, notes, or annotations and never writes
bibliographic fields, PDF data, or annotation data. Per-item results record the
collection/tag additions actually made. The runtime records that it passed
Paper Pilot notifier metadata to APIs with an options position; it does not
claim Zotero consumed that metadata. Undo may remove only additions recorded as
owned by that receipt and preserves pre-existing and later unrelated
collection/tag state. A prepared receipt without committed ownership results
is shown as unresolved and is not eligible for undo or reapplication.

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
| `runProfile.ts`         | explicit `chat`, `analysis`, and `discovery` capability/session boundary |
| `structuredOutput.ts`   | native-schema validation and capability probe with parser fallback       |
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

Before controller admission, reader chat locks its composer, changes Send to
Stop, and shows progress while resolving selection and saving the user turn.
Cancellation retains the per-paper admission until this preparation settles,
and a cancelled preparation never starts a CLI. Preparation errors become a
visible terminal status and restore the composer. Selection popup styles are
installed in the reader's own document because the pane stylesheet cannot cross
that document boundary.

1. `controller.handleXQuestion` refuses to start if a run is already active for
   this `itemID`.
2. Before workspace preparation, the controller registers an item-scoped
   activity in `ai/runPresentation.ts`. This keeps provider and session guards
   active if Zotero rebuilds the pane during extraction or process spawn. It
   also creates `addon.data.runProgressStates[itemID]` in `Preparing workspace`.
3. `runner.startXRunForQuestion`:
   - resolves the executable path and reads prefs (model, sandbox, permissions)
   - applies the explicit run profile: visible `chat` may resume its provider
     session, while hidden `analysis` and `discovery` runs never resume or
     update it and use separate profile-suffixed workspace paths
   - computes the workspace path: `{workspaceRoot}/{itemID}-{slugified-title}`
     (`workspace/pathBuilder.ts`); an empty preference resolves below
     `Zotero.getTempDirectory()` instead of a shared `/tmp` root, and analysis
     and discovery add their profile to the title before slugging
   - extracts paper content via `tools/paperWorkspaceContent.ts` — OpenDataLoader
     when Java is available, falling back to Zotero `attachmentText`; the Java
     subprocess records its pid and exit code and is terminated after a
     two-minute extraction limit, with the fallback reason kept in
     `extractionNotes`
   - chunks and retrieves top-K passages (`context/indexStore.ts`,
     `context/retriever.ts`)
   - writes the workspace artifacts (see below)
   - for a structured workflow, first verifies that the JSON Schema uses
     explicit types and a closed, fully-required object shape, then probes the
     installed CLI help
     once and supplies it through Codex `--output-schema` or Claude
     `--json-schema` when supported; an incompatible schema, missing flag, or
     failed probe falls back to the prompt plus validating parser without
     blocking the run
   - builds the CLI argv and wraps it in a **detached background shell script**;
     first and resumed Codex turns carry the same configured approval and
     sandbox modes, and every engine prepends its executable directory to PATH
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
   failed manual stop leaves its exit-file poller and absolute watchdog armed,
   so a later natural exit is still reconciled. Add-on shutdown snapshots all
   run-state, poller, pending-completion, direct-workspace, and presentation owners,
   awaits best-effort termination for every recorded pid, and only then
   clears local observers and state. A started result or run state must provide
   a numeric pid—missing pid data is a
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
three CLIs. Process-exit classification reads stderr plus explicit CLI error
events, never the full stdout/tool-event stream. Session history stores the safe `userMessage` as replayable text and
keeps raw stderr only in `rawEvent`, which the run card exposes under a collapsed
Raw logs disclosure. Direct workspace workflows likewise derive visible text
only from parsed stdout; a non-zero exit without parsed stdout becomes a generic
workflow error instead of exposing stderr. `ui/runProgressCard.ts` renders the
same progress, cancel, retry, settings, and login-help surface for every engine.
Only normal chat turns enter `addon.data.lastEngineRequests`; silent Workbench
Paper Mastery, and Critical Read runs continue to use their own workflow buttons.
Normal chat uses the configured provider permissions. Gemini's default approval
mode prompts instead of accepting actions automatically, and Paper Pilot adds
Gemini's sandbox flag when the installed CLI advertises it. Analysis is
read-only (Codex read-only sandbox, Claude plan permission, Gemini plan
approval) and has no web search. Discovery keeps the same filesystem boundary
while admitting the verified web-search path. Hidden completion can persist
workflow state without changing the visible session's provider resume id.

Per-engine file names inside the workspace:

| Engine | prompt              | stdout               | stderr              | exit code         | pid              |
| ------ | ------------------- | -------------------- | ------------------- | ----------------- | ---------------- |
| Codex  | `prompt.txt`        | `codex-output.jsonl` | `codex-stderr.log`  | `codex-exit.txt`  | `codex-pid.txt`  |
| Claude | `claude-prompt.txt` | `claude-output.txt`  | `claude-stderr.log` | `claude-exit.txt` | `claude-pid.txt` |
| Gemini | `gemini-prompt.txt` | `gemini-output.txt`  | `gemini-stderr.log` | `gemini-exit.txt` | `gemini-pid.txt` |

Codex emits JSONL events, so `outputParser.ts` extracts assistant text and
`codex/controller.ts` extracts the resumable `thread_id`. Claude runs with
`-p --output-format text` and Gemini returns plain text, so both are read
directly.

The current local-process adapter is macOS/POSIX-specific: it launches
`/bin/zsh` and uses `/usr/bin/pgrep` and `/bin/ps`. Windows is not a supported
runtime until those process-control assumptions have a platform adapter.

## Paper workspace artifacts

`context/workspaceArtifacts.ts` builds the payload; the runner writes the files.

| File                        | Written by                      | Contents                                                                         |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `paper.md`                  | all engines                     | structured Markdown, or full text if extraction fell back                        |
| `paper.json`                | all engines                     | structured elements + `extractionMethod` + `extractionNotes`                     |
| `paper.txt`                 | all engines                     | compatibility snapshot: metadata header plus text                                |
| `metadata.json`             | all engines                     | title, authors, year, item/attachment key, abstract, extraction method and notes |
| `selection.json`            | all engines                     | selected text, actual nearby context, page, annotations, retrieved chunks        |
| `recent-turns.json`         | all engines                     | last 3 privacy-eligible turns for follow-up continuity                           |
| `annotations.json`          | all engines                     | annotation ids tied to this request                                              |
| `CONTEXT_INDEX.md`          | all engines                     | reading-order file map                                                           |
| `discovery-request.json`    | discovery runs                  | normalized research concern and current-paper context                            |
| `discovery-plan.json`       | discovery runs                  | agent-owned field, venue, and query planning scaffold                            |
| `discovery-candidates.json` | discovery runs                  | deterministic scholarly-provider candidates                                      |
| `discovery-evidence.json`   | discovery runs                  | official-evidence collection scaffold                                            |
| `figures/`                  | Codex only                      | empty directory for image assets                                                 |
| `output-schema.json`        | supported Codex structured runs | native final-output JSON Schema                                                  |

All three engine prompts instruct the agent to read `CONTEXT_INDEX.md`. Discovery
runs additionally stage the four `discovery-*.json` files for a reproducible
candidate-discovery and publication-verification protocol. The agent owns field
and venue judgment; these files standardize inputs and evidence boundaries rather
than imposing a closed conference list. If you add an artifact, add it to every
applicable runner _and_ to the prompt that tells the model to read it.

The prompt preview owns only the explicit request and response-language
instruction. Selection, retrieval, and annotation data appear once in
`selection.json`; visible conversation context appears once in
`recent-turns.json`. Prompts-only persistence omits assistant turns from that
file. Disabling history persistence forces workspace cleanup after the run even
when the general auto-clean preference is off. When nearby context is enabled,
the runner finds the
selection inside extracted full text and writes bounded text before and after
it. A failed match omits nearby context instead of copying the selection.

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

The Gecko DNS service is mandatory for production official-evidence requests;
an unavailable resolver or an empty answer fails closed. The connected-remote
address is observable only after the request begins, so a DNS-rebinding peer
can still receive a blind GET before Paper Pilot aborts it. Response content is
withheld in that case, preventing response-body exfiltration, but the residual
request-delivery risk remains. Address pinning is not exposed by the Zotero
HTTP API used here.

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

The message store and on-disk snapshot remain authoritative even when the chat
view suspends older entries. Windowing is presentation-only: it must not trim
records, change the three-turn engine context policy, or alter snapshot counts.

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

## Analysis consistency and maintenance boundaries

`ai/executionSettings.ts` captures the provider, CLI model argument, Codex reasoning
level, and response language before analysis preparation. The facade shares that
immutable snapshot with prompt construction, every incremental unit, run history, and artifact
lineage. Provider aliases such as `sonnet` record the CLI argument, not a resolved
server-side model revision. Local extraction and corrections use `local` lineage.
Older artifacts may omit these optional fields.

Before execution and around result persistence, the operation coordinator checks
that each admitted source still belongs to the project, is ready, and retains its
identity and content fingerprint. A change prevents successful completion and makes
any newly saved result stale. Incremental reuse additionally requires matching
context projection fingerprints and execution settings; old rows cannot inherit a
new projection or model label. Completed rows remain available after cancellation.

Direct workspace reservations retain their provider and process ID until confirmed
completion or cleanup. Shutdown blocks new admissions and collects those IDs in
addition to controller-managed runs. Preparation that finishes after shutdown stops
its newly returned process before workspace cleanup. Termination remains best effort
when Zotero itself is exiting.

The profile OpenDataLoader cache is named
`paperpilot-tools/opendataloader-pdf-cli-<version>.jar`. Each resolution compares it
with the installed bundle and atomically replaces missing or different bytes;
concurrent requests share the copy. Older unversioned copies are ignored and
preserved. Java/extraction failure still falls back to Zotero attachment text.

`artifactView.ts` owns payload normalization and evidence view models;
`artifactRenderer.ts` owns DOM rendering. `projectWindowView.ts` composes the project
shell, with template, sync, and review panels in separate modules. Navigation is
passed to panels explicitly, while `projectSurfaceShared.ts` owns surface lifecycle
and controls. `ui/readerWorkbench.ts` owns reader workbench card state and rendering.
The three CLI engine modules remain separate for provider isolation.

All previously unchecked ported core modules and `service.ts` participate in strict
TypeScript checks. `serviceState.ts` describes admitted analysis state; legacy
migration still treats stored payloads as unknown. Persisted cross-paper sessions
must pass nested shape checks before entering the analysis engine. The unused
`retainRawRunLogs` preference is ignored on read and omitted on serialization.

`test/fixtures/hybrid-retrieval.json` is a hand-labelled, deterministic multilingual
regression corpus, checked by `npm test` (and therefore CI). Its quality floors are
Recall@3 ≥ 0.95, MRR ≥ 0.90, and nDCG@3 ≥ 0.90. This small local gate catches ranking
regressions; it is not evidence of general semantic or cross-language retrieval
quality.

For setup diagnosis, run `bash scripts/doctor.sh . [Zotero-profile-directory]`.
The bounded runtime probes check the actual `/bin/zsh` login-shell CLI paths,
versions, Codex/Claude authentication status, and optionally the profile JAR.
Authentication details are not printed. Gemini has no read-only auth-status command
in the supported CLI surface, so the doctor reports it as unverified; a user-triggered
analysis is the runtime check. The detached runner needs Unix tools and `/bin/zsh`;
native Windows execution is not supported, and Linux needs those tools installed.

Zotero shutdown listeners await best-effort termination of registered CLI process
trees before the runtime closes. The bootstrap application-shutdown path invokes
the same idempotent stop hook; disabling the add-on then performs UI cleanup.

### Critical Read display language

`criticalRead/localization.ts` supplies presentation copy for the canonical
seven-step reader workflow. Step IDs and persisted workflow/output values remain
stable. Feature names and action buttons retain their English labels; guidance
and report labels follow the response language.
`ui/criticalReadSection.ts` resolves labels at render time; report previews
and new notes rebuild headings from structured state in the selected response
language. Preference changes notify open reader panes through
`translation/responseLanguage.ts`, with subscriptions disposed with the pane and
unsent Critical Read input preserved during the language refresh. This does not
regenerate saved AI prose or translate verbatim paper evidence.
