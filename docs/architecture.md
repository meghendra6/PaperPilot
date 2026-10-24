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

Paper Pilot is a Zotero 7-10 bootstrapped add-on. Reader and evidence-workspace
AI runs use an authenticated **local CLI**. The separate Research Studio window
also offers explicit loopback OpenAI-compatible requests; these
do not change the reader's engine registry. No hosted service is required for
local document editing. Studio is under implementation; its full target and
verification boundaries are in [research-studio-spec.md](./research-studio-spec.md).

```text
Zotero item panes
  ├── src/modules/readerPane.ts              reader chat and workbench
  └── modules/researchWorkspace/view.ts      single- and multi-paper tools
        └── modules/researchWorkspace/       feature service and typed analysis core
              └── modules/ai/workspaceRun.ts
                    └── <engine>/runner.ts   workspace build + process launch
                          └── codex | claude CLI
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

### Research Studio project documents

`studio/window.ts` opens one modeless Research Studio window per existing project.
The project page and every home project card open it through **Open Studio**.
Its packaged browser surface runs in an opaque-origin sandbox with a local CSP.
The host transfers a project-bound MessagePort only after the exact packaged
iframe URL finishes loading. Requests validate the channel nonce and live project
existence. A separate chrome namespace exposes static editor assets, keeping the
privileged bootstrap private. Document operations never invent a Zotero `itemID` or occupy a
paper run reservation. A separate npm workspace pins the AGPL SuperDoc 1.47.2
editor and its PDF.js peer, keeping the reader's PDF.js dependency independent.

`StudioRepository` stores a revisioned `documents/manifest-v1.json` and immutable
base64 blobs beneath the existing project directory. The manifest is the commit
point. Save, rename, archive, restore and reviewed AI writes are serialized and
check the caller's revision. Restore appends history. AI receipts and document
versions share the same atomic manifest write, so retry after a conversation
write failure cannot apply the change twice. `SaveCoordinator` drains edits made
during a save and lets navigation wait for the same confirmed operation.
The shared `researchProjectDirectory` helper keeps Studio data under the existing
Research Workspace directory naming contract.

The browser mounts SuperDoc for DOCX, CodeMirror for source documents, typed
CSV/TSV/JSONL grids, and nbformat-preserving notebook cells. Unknown files retain
their original bytes for export. Markdown previews are sanitized and do not
automatically load external media. DOCX AI replacements must match one paragraph;
the host verifies the resulting document text before committing exported bytes.
Starter and user-saved templates create original-format copies. Saved notebook
figures/tables can be embedded in DOCX or inserted into source documents. HTML
table previews are sanitized; merged or irregular tables require explicit repair
before CSV extraction. CSV/TSV grids require a column before adding rows, and
retain the last column until its rows are removed. Empty fields are quoted on
serialization so a final empty row survives reopening. CSV/TSV row separators
come from the parser rather than line breaks inside quoted cells. JSONL retains
empty objects.
The pinned editor build patch preserves both endnote export and the link button's
accessible name across normal and headless selection updates.

`StudioAIService` owns project conversation records, captured context revisions,
review decisions and cancellation. Its operation reservation survives window
replacement until the old operation finishes. Codex/Claude use separate owned
file jobs and the existing command/parser/launch infrastructure, with 800 ms
completion polling and a four-minute deadline. Codex uses read-only mode with
host/browser/connector/delegation tools disabled; Claude uses safe mode with no
tools. CLI capability checks fail visibly instead of weakening these settings.
loopback calls are privileged-host requests with redirects disabled,
bounded responses and no automatic retries. Local models receive the same JSON
Schema as CLI providers through the structured response format. Failed CLI stop
confirmation retains the owned job by project runtime path, including across
replacement windows; the next run retries that cleanup before preparing a new job. API keys remain in the window and
are excluded from conversation, document, and job files.
PDF context is extracted by the bundled local OpenDataLoader runtime, with
process cancellation and temporary-file cleanup. PDF bytes remain read-only for
AI proposals. Selected passages are explicitly added to the next question.

`StudioCompilerService` snapshots saved project revisions, runs Tectonic, Typst
or MyST (Typst output) in an owned build directory, polls completion every 800 ms,
and adds a distinct PDF only after a successful exit and PDF signature check.
Builds have a four-minute deadline and cancellation; diagnostics and input
revisions are retained. Active ownership and unconfirmed process cleanup are
retained by the stable project build path across replacement services/windows. A
replacement retries cleanup before admitting another build; the closed service
cannot cancel the replacement, and different profile paths remain independent. MyST does not receive `--execute`. Project plugins and
notebook code run with local account permissions; runtime directories are not an
OS security sandbox. Tectonic uses untrusted mode. Compilers can download missing
packages/templates. A separate, bundled PDF.js worker renders local PDFs without
executing PDF scripts, links, forms or attachments.

Document versions now carry SHA-256 digests of their original bytes. Older versions
remain readable and gain checksums when exported. Document backups include all
versions, archive state and stable document identities; restoration validates all
bytes before atomically publishing into an empty document catalog. These backups
exclude evidence-workspace records, conversations and runtime environments. The
existing evidence export remains separate. Conversation archives can be selected
and resumed; resuming archives the current conversation first.
The separate local-project bundle adds active/archived conversations and research
record snapshots. Restore publishes original document history and an immutable
context-document pointer in one manifest commit. Imported conversations can
resume; edits to the visible context document cannot rewrite their original
snapshot. Imported research records do not establish current Zotero bindings.
Runtime environments, model credentials and Zotero attachment bytes are not
bundled; PDFs imported as Studio documents are included.

`references.ts` uses bundled Citation.js BibTeX and CSL plugins without DOI
resolution or network lookups. Manual and project-Zotero snapshots become local
BibTeX files. DOCX citation insertion uses SuperDoc's Word `CITATION` fields and
bibliography sources. Explicit refresh applies CSL to all citation clusters in
document order and updates a `BIBLIOGRAPHY` field, including numeric numbering.
Supported source metadata and rendered field results round-trip through DOCX;
refreshing in Word uses Word's style engine. Full metadata remains in the source
reference file. Independent formatted-text insertion remains available, with
selection-only numbering. These are Word fields, not Zotero integration fields. The Kanban
surface stores explicit card-to-document links and preserves unknown metadata;
its graph visualizes those links, independently of research screening state.

`KernelBroker` owns one persistent Python or R kernel per notebook. The bundled
Python worker uses `jupyter-client` with file requests, a heartbeat, interrupt and
shutdown signals. It snapshots project files into an owned runtime workspace,
retains state between cells, and saves notebook outputs only after explicit Run.
The Python environment is user-configured; R requires an installed `IRkernel`.
This code executes with the local user's permissions. Runtime snapshots and
exported files are separate from authoritative document versions.
Jupyter `clear_output(wait)` and display-handle updates are applied to output
snapshots. Display handles are session-only and excluded from nbformat export.
Output rendering reuses cell editors so running a cell retains its undo history.
Concurrent restarts share one termination promise and block new executions until
it settles. A failed launch whose cleanup is unconfirmed retains its session
ownership; restart or close can retry termination before another worker starts.

Kernel process ownership is keyed by the stable profile/project runtime path and
notebook ID across window replacement. A new broker cannot adopt a live session
or start another worker while the old broker owns it. If a closed window could
not confirm termination, Restart retries through the new window's termination
port, coalesces concurrent cleanup and releases ownership only after success.
Startup and pending termination retain ownership; stale close/restart/interrupt
calls from the old broker cannot affect its successor. Different notebooks and
profile roots remain independent.

The local preview script uses the packaged browser assets and the same repository,
AI service/runner and kernel broker with Node I/O. Preview proof does not establish
the privileged Zotero bridge, installed XPI behavior, or Word interoperability.

The pane itself uses a bounded flex column. `ui/paneHeader.ts` owns the compact
engine/model header and its settings popover, while `ui/collapsibleSection.ts`
owns the accessible Workbench, Related papers (with Find verified prior work),
and Past sessions surfaces. Critical Read is rendered within Workbench. `ui/chatComposerSizing.ts` preserves textarea auto-sizing
without changing the pane height. Disclosure state is serialized in the internal
`paneSectionState` preference through the pure helpers in
`ui/paneSectionState.ts`. The chat transcript takes the remaining space and
scrolls independently from expanded section bodies. `ui/chatTranscriptWindow.ts`
keeps a sliding 48-message DOM window, shifts it in 16-message steps near the
scroll boundaries, and restores suspended messages from the in-memory session
record when needed. The full transcript remains available to session
persistence and engine resume logic; only expensive rendered Markdown nodes are
detached.

Run events refresh pane state on every lifecycle change. While a run is
active they skip the transcript rebuild, because the live answer bubble is
not stored until the run finishes. A rebuild restores a scrolled-up reading
position without moving keyboard focus. Past sessions keep an in-progress
rename, an open ⋯ menu, and the focused session control across rebuilds. The
prior-work list (`ui/discoverySection.ts`) keeps open review insights and the
focused row button the same way, and a row action's error shows in its row.

Status notices that are not answers (Stop results, "still running", login
help, a request that could not start) go to the composer hint through
`showComposerNotice` in `readerPane.ts`, never into the transcript: the
transcript is rebuilt from saved messages, so a notice added there would look
like an answer and then vanish. Instructions use a sticky notice that stays
until the next question is sent. Code that writes `#chat-input` calls
`resizeChatComposer` from `ui/chatComposerSizing.ts`, because only typing
fires the autosize input event. A run started with `suppressChatMessages`
is marked `quiet` in its run progress state, so the card does not promise an
answer in chat. Each run records the chat session that started it,
and a finished run card shows only in that session.

`ui/paneAutoSize.ts` derives the default pane height from its actual top position
and remaining viewport space. Resize observers track preceding sections; sidebar
scrolling does not continually resize content. An explicit manual height takes
precedence until reset. `ui/chatSearchReturn.ts` retains a temporary in-memory
return snapshot when visiting saved search results, including draft-only sessions
that are intentionally absent from disk history.

## Selection dictionary lookup

`dictionaryLookup.ts` bounds the selected query and parses Naver's internal
English–Korean search response into one matching headword, pronunciation symbols,
up to three senses, and source attribution. Exact headwords take priority;
provider-marked inflections can resolve to their headword, while loosely related
results are omitted. Unknown response shapes and mismatched queries fail visibly.
Provider markup is converted to text and rendered with DOM text nodes only.

`dictionaryRequest.ts` makes an anonymous, fixed-host request from the add-on
context, outside the reader's network-blocked document. Requests have a ten-second
timeout, a one-megabyte body limit, no automatic retries or redirects, and a
canceller. Only the selected query is supplied; no paper context or session data
is added. Naver's internal response is not a versioned public API and may change.

`ui/dictionaryPopup.ts` owns a separate, modeless Zotero dictionary window using
`DialogHelper`, independent of the reader's selection-popup layout and lifecycle.
Only its launch button is appended to the selection menu. The result document
uses explicitly namespaced HTML elements and renders parsed text, never a remote
page or iframe. Loading, no-match, error/retry and source attribution appear in
the same window. `addon.data.dictionaryWindow` owns this singleton; subsequent
lookups cancel the previous request and use a generation guard to reject stale
responses. Window close and add-on shutdown release requests and listeners.
No query is made on selection alone and no lookup is added to AI/chat state or
Paper Pilot persistence. Source links open externally only on explicit clicks.

## Figure and table explanation

Readers select a figure or table with Zotero's native Select Area tool, which
creates an image annotation. The primary entry point is the **Explain figure or
table** button that `readerActions.ts` adds to PDF reader toolbars through the
`renderToolbar` event. `ui/figureExplainTool.ts` arms one selection per reader:
it switches the internal reader to the area tool, registers an item notifier
while any reader is armed, and opens the explanation for the next image
annotation saved on that PDF after arming (`figureExplain/explainMode.ts`
holds the pure matching rule; `dateAdded` keeps older synced or imported areas
out). It then restores the previous tool. A second click, Esc, a two-minute
expiry, or closing the reader cancels the mode, and add-on shutdown disarms
every reader.
Existing area annotations are reachable through **Explain figure or table** in
the annotation context menu (exactly one image annotation) and an **Explain**
button on image-annotation cards (`renderSidebarAnnotationHeader`).

All entry points open `ui/figureExplainPopup.ts`, a modeless `DialogHelper`
window that `addon.data.figureExplainWindow` owns as a singleton. The window
always opens from a fresh main-thread task (`Services.tm.dispatchToMainThread`).
Zotero 10.0.6 runs reader context-menu commands from a timer inside the reader
iframe, and opening a chrome window from that task crashed Zotero with a native
SIGSEGV. The window is placed inside the right edge of the Zotero window after
clamping the reported main-window frame onto the screen. A new request aborts
the previous run and starts after that run settles. An abort during workspace
preparation releases the paper's engine reservation only after deferred
cleanup, so a request within a minute of an abort waits up to 15 seconds for
it. A result that arrives after Stop is not shown. Closing the window, Stop,
and add-on shutdown abort the run. The add-on sandbox has neither `AbortController` nor
`DOMException`: the window supplies the controller, and the shared
`ai/workspaceRun.ts` wait loop rejects with a plain `AbortError`.

`figureExplain/workflow.ts` resolves the annotation by attachment ID and key,
never from the live reader selection. It uses Zotero's cached annotation PNG
(`Zotero.Annotations.getCacheImagePath`) and asks
`Zotero.PDFWorker.renderAttachmentAnnotations` to render a missing one.
`figureExplain/locator.ts` reads the page's PDF.js text spans from the
owned-worker extraction and derives non-authoritative hints. The hints are the
nearest caption label within 120 points (`Figure 3:` captions rank above
body-text mentions), the caption's continuation lines in the same column, and
the text printed inside the area with cell separators. `figure-request.json`
holds these hints, the selected rectangle, and the annotation comment; the
prompt only names the file.

The run reuses `researchWorkspace/analysisRunner.ts` with the `analysis`
profile. It therefore shares the item-scoped reservation, read-only provider
modes, the four-minute deadline, cancellation, and workspace cleanup. When an
image exists, each runner copies it to the runtime-owned
`figures/selected-region.png` after writing the input manifest, so cleanup
removes the copy. Codex receives the copy through `--image`; Claude Code opens
it with its read tool. Without an image, the prompt switches to a text-only
contract. `figureExplain/response.ts` validates the JSON, and the window renders
text nodes only. Explanations stay in memory per annotation revision and
execution settings (`addon.data.figureExplanations`, at most 24 entries). They
are not written to session history, notes, or Research Workspace artifacts.

## Integrated Research Workspace boundary

`src/modules/researchWorkspace/` owns the paper- and project-level research
features. `view.ts` renders the full single-paper operation surface and is also
embedded in the project window. `projectHomeView.ts` renders the window home,
`projectWindowView.ts` renders the tabbed project page (`projectTabs.ts`:
Analyze, Papers, Results, Checks, Settings), `window.ts` owns the
modeless-window singleton and captured state, and `menu.ts` registers its
launchers. Library selection is captured once by `selectionSnapshot.ts`.
`surfaceSelection.ts` wraps that snapshot for the home: titles show at once,
and the PDFs are read once, only when the reader creates or extends a project
with them. That project then opens on Analyze with the read papers already
loaded into the analysis tools. Project actions never depend on a later
live-selection read. A launcher, or **Use Zotero selection**, captures a new
snapshot and moves the open window to it. The window stays put only when an
analysis is running or typed text would be lost; a banner then offers the
selection (spec §12.1). A project that already holds the selected papers
stays in view, and the home lists projects that already hold the selection
before offering a new one.
This keeps the workflow reachable when Zotero replaces the ordinary item pane
for a multi-selection. `projectSurfaceState.ts` keeps unsaved panel choices,
focus, and the open tab across a project rebuild, and the analysis panel stays
in its tab panel while a tool runs.

The window loads `researchWorkspaceWindow.css` after `zoteroPane.css`. Every
rule in it is scoped to `.pprw-window`. The item pane renders the same analysis
view with the shared `zoteroPane.css` rules only, including the tool
descriptions. It re-points the `--pp-*` tokens to the window palette and sets
titles in a bundled subset of STIX Two Text. The fonts live in `studio/fonts`
because the sandboxed Studio frame may read fonts only from its own chrome
package; the window loads the same files from there. Stylesheet URLs carry a
token made once per add-on startup (`utils/stylesheet.ts`). Gecko caches chrome
stylesheets by URL, so without the token an install without a restart keeps the
previous build's CSS.

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

In Zotero, local quote extraction imports the native PDF.js resource through a
chrome Window and creates a dedicated worker and document from the exact file
bytes. It does not borrow the open Reader's cached document or shared worker.
All owned PDF resources are released after extraction, including failures. The
Node fixture path remains separate. See the
[runtime repair specification](./chat-runtime-followup-spec.md) for exercised
versions and the distinction between metadata freshness and byte identity.

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

`src/modules/ai/` is the thin layer over the two engines.

| File                    | Role                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `types.ts`              | `EngineMode = "codex_cli" \| "claude_code"`                              |
| `modeStore.ts`          | default mode from prefs, per-item override in `addon.data.modeOverrides` |
| `providerRegistry.ts`   | mode → provider descriptor (label, status)                               |
| `readerBusy.ts`         | shared check for whether a paper's engine slot is taken                  |
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
mastery, figure explanation). It dynamically imports
the engine runner so the engine modules stay independently loadable.

Each engine then has a parallel module with the same five files:

```text
src/modules/{codex,claude}/
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

`modelOptions.ts` under `codex/` is shared by both engines — it holds the Claude
model catalog, model-name normalizers, and effort levels too. The filename is
historical. The built-in Claude picker lists the CLI family aliases (`sonnet`,
the default, plus `opus`, `haiku`, and `fable`), which the installed CLI
resolves to the newest model in each family, followed by pinned version ids.
`normalizeClaudeModel` canonicalizes hand-typed names (`Opus 5.5` and
`claude-opus-5.5` become `claude-opus-5-5`) and keeps a context suffix such as
`[1m]`; any other id, including Bedrock/Vertex ids, passes to the CLI unchanged.
`claudeReasoningEffort` is empty (the CLI default) or one of `low`, `medium`,
`high`, `xhigh`, and `max`; it is set in preferences or with the effort select
next to the reader-pane model picker. Codex uses the same effort select, which
lists only the levels the picked model supports; changing the model keeps the
picked effort when the new model supports it and otherwise selects that model's
default effort. Save in the engine popover writes the model and effort prefs
for the active engine, then closes the popover and returns focus to its
trigger.

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
     sandbox modes, and every engine prepends its fixed CLI directories to the
     login shell's own PATH (`shellExportLine` in `codex/shell.ts`, shared by
     both runners, the CLI probes, and the OpenDataLoader script)
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
   an empty Claude output file as a stall.
6. On completion the controller sanitizes the text
   (`message/assistantOutput.ts`), persists the turn via
   `session/sessionHistoryService.ts`, updates run state, and calls
   `workspace/cleanup.ts`. Workspace writes and removals refuse a path with a
   symbolic link in any component, and cleanup skips linked entries, so a link
   planted in the agent's working directory cannot redirect a write or a
   delete outside it. `ai/runCompletion.ts` guarantees that cleanup
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
   If preparation throws after workspace allocation, the controller or direct-run
   dispatcher cleans the recorded allocated path using its owned-file manifest.
   It does not reconstruct legacy directories from mutable paper titles.

Failures are classified in `ai/runFailure.ts`. Workspace and timeout sources
take precedence over string matching; executable and login patterns cover both
CLIs. Process-exit classification reads stderr plus explicit CLI error
events, never the full stdout/tool-event stream. Session history stores the safe `userMessage` as replayable text and
keeps raw stderr only in `rawEvent`, which the run card exposes under a collapsed
Raw logs disclosure. Direct workspace workflows likewise derive visible text
only from parsed stdout; a non-zero exit without parsed stdout becomes a generic
workflow error instead of exposing stderr. The shared dispatcher also rejects a
provider-declared failed turn or empty assistant output even when the process
exit code is zero; `processExitCode` retains the physical exit value while the
effective `exitCode` prevents every artifact consumer from accepting a partial
result. `ui/runProgressCard.ts` renders the
same progress, cancel, retry, settings, and login-help surface for every engine.
Only normal chat turns enter `addon.data.lastEngineRequests`; silent Workbench
Paper Mastery, and Critical Read runs continue to use their own workflow buttons.
Normal chat uses the configured provider permissions. Analysis is read-only
(Codex read-only sandbox, Claude plan permission) and has no web search.
Discovery keeps the same filesystem boundary while admitting the verified
web-search path. Hidden completion can persist
workflow state without changing the visible session's provider resume id.

Per-engine file names inside the workspace:

| Engine | prompt              | stdout               | stderr              | exit code         | pid              |
| ------ | ------------------- | -------------------- | ------------------- | ----------------- | ---------------- |
| Codex  | `prompt.txt`        | `codex-output.jsonl` | `codex-stderr.log`  | `codex-exit.txt`  | `codex-pid.txt`  |
| Claude | `claude-prompt.txt` | `claude-output.txt`  | `claude-stderr.log` | `claude-exit.txt` | `claude-pid.txt` |

Codex emits JSONL events, so `outputParser.ts` extracts assistant text and
`codex/controller.ts` extracts the resumable `thread_id`. Claude runs in print
mode (`claude -p`). When the installed CLI's help lists
`--include-partial-messages` (checked with the runner's own environment), it
passes `--output-format stream-json --verbose --include-partial-messages` and
writes stream-json events that
`claude/outputParser.ts` parses for assistant text, provider session identity
and terminal provider errors; otherwise `--output-format text` output is read
directly. The command passes the normalized model id through `--model` and adds
`--effort <level>` only when an effort is configured and the CLI's `--help`
lists `--effort`; older CLIs silently run without it. Progress readers sample
the exit file before stdout/stderr: an observed completion marker therefore
precedes the final output read, preventing completion from using an older
partial output snapshot. The shared `resolveRunAnswer` helper also requires
readable decoded chat text before controllers persist a successful turn or
retain a provider resume binding.

The current local-process adapter is macOS/POSIX-specific: it launches
`/bin/zsh` and uses `/usr/bin/pgrep` and `/bin/ps`. Windows is not a supported
runtime until those process-control assumptions have a platform adapter.

## Paper workspace artifacts

`context/workspaceArtifacts.ts` builds the payload; the runner writes the files.

| File                          | Written by                      | Contents                                                                         |
| ----------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `paper.md`                    | all engines                     | structured Markdown, or full text if extraction fell back                        |
| `paper.json`                  | all engines                     | structured elements + `extractionMethod` + `extractionNotes`                     |
| `paper.txt`                   | all engines                     | compatibility snapshot: metadata header plus text                                |
| `metadata.json`               | all engines                     | title, authors, year, item/attachment key, abstract, extraction method and notes |
| `selection.json`              | all engines                     | selected text, actual nearby context, page, annotations, retrieved chunks        |
| `conversation-context.md`     | chat runs                       | privacy-eligible pinned context, summary, and completed turns                    |
| `annotations.json`            | all engines                     | annotation ids tied to this request                                              |
| `CONTEXT_INDEX.md`            | all engines                     | reading-order file map                                                           |
| `discovery-request.json`      | discovery runs                  | normalized research concern and current-paper context                            |
| `discovery-plan.json`         | discovery runs                  | agent-owned field, venue, and query planning scaffold                            |
| `discovery-candidates.json`   | discovery runs                  | deterministic scholarly-provider candidates                                      |
| `discovery-evidence.json`     | discovery runs                  | official-evidence collection scaffold                                            |
| `figures/`                    | Codex only                      | empty directory for image assets                                                 |
| `figure-request.json`         | figure explanation runs         | selected area, annotation comment, locally detected label/caption/area text      |
| `figures/selected-region.png` | figure explanation runs         | runtime-owned copy of Zotero's cached area-annotation image, for both engines    |
| `output-schema.json`          | supported Codex structured runs | native final-output JSON Schema                                                  |

Both engine prompts instruct the agent to read `CONTEXT_INDEX.md`. Discovery
runs additionally stage the four `discovery-*.json` files for a reproducible
candidate-discovery and publication-verification protocol. The agent owns field
and venue judgment; these files standardize inputs and evidence boundaries rather
than imposing a closed conference list. If you add an artifact, add it to every
applicable runner _and_ to the prompt that tells the model to read it.

The prompt preview owns only the explicit request and response-language
instruction. Selection, retrieval, and annotation data appear once in
`selection.json`. Its `selectedText` holds only highlighted quotes; annotation
comments widen retrieval but are not quoted as paper text. `pageIndex` is
zero-based and `pageNumber` is `pageIndex + 1`. Visible conversation context
appears once in `conversation-context.md`, which chat runs write and
`CONTEXT_INDEX.md` names. Prompts-only persistence omits assistant turns from
that file. Disabling history persistence forces workspace cleanup after the run even
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

Verification cannot run through a network proxy. With an HTTP or SOCKS proxy
(a system proxy, Charles, ClashX, a corporate proxy) the connected peer is the
proxy, so the public-address check cannot confirm the official server. Paper
Pilot detects a proxied channel and fails closed with a proxy-specific reason
instead of relaxing the check. Fake-IP DNS modes that answer in 198.18.0.0/15
fail the DNS check for the same reason.

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
Codex binds its configured web-search state at admission; Claude Code fails
closed for verified discovery until Paper Pilot can observe a usable web
capability instead of assuming one from the executable alone.

`extractionMethod` is `opendataloader-pdf` when Java 11+ ran the bundled JAR, and
`zotero-attachment-text` on fallback. Several prompts key their confidence
language off this, so keep it accurate.

## Prompt surfaces

Prompt construction and response parsing live next to the workflow they serve.
`context/promptPreviewBuilder.ts` holds the shared workspace preamble and the
common answer-style rules used by both engines.

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
| Figure explanation | `figureExplain/prompt.ts`                          | strict JSON                                  |
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

Gemini CLI support has been removed, but saved history can still name
`gemini_cli`. `sessionHistoryRepository.ts` migrates such files on read instead
of rejecting them: Gemini resume ids, provider bindings, last-mode and
last-model hints, and Gemini-tagged execution settings are dropped, and a legacy
message `sourceMode` is rewritten to `codex_cli` only so native-resume
invalidation keeps working (its unsettled attempts are marked `interrupted`).
Research Workspace lineage validation still accepts `gemini_cli` so historical
artifacts load; new runs record only `codex_cli` or `claude_code`. Workspace
input manifests written before the removal still list `gemini-*` runtime files;
`supplementalFiles.ts` accepts those entries when reading a reused chat
workspace (and removes the files) but never writes them, and startup rewrites a
saved `defaultMode` of `gemini_cli` to `codex_cli`.

The service serializes asynchronous mutations per item, including snapshot
capture, persistence, pin/summary changes, rename/delete and session replacement.
Nested operations use private methods within the same queue admission. A failed
operation rejects its caller without blocking later work, and different papers
remain independent. This prevents an older save from overwriting a completed
answer or recreating deleted history.

History mutations reread the on-disk index version even when its entries are
cached. An index from a newer version blocks snapshot writes, index replacement
and deletion before those operations change files; readable snapshots remain
available for recovery. Malformed JSON indexes retain the existing quarantine
and snapshot-recovery behavior.

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

`ui/masteryPanelView.ts` derives every Mastery control from that saved state
plus memory-only view choices: the graded round still under review and an
opened progress dot. The choices are keyed by paper and Mastery run (chat
session plus the run's creation time), and live in the module, not the pane
closure, so a pane rebuild such as a tab switch keeps them and a restart drops
them. Live run callbacks and pane re-renders both call the one
`renderMasteryPanel` in `readerPane.ts`, so a run event cannot hide a result
the reader is still reading. A graded result stays on screen until the reader
clicks Next question. The module also keeps the unsent answer and confidence
per paper, session, and question, and whether Mastery is still reading the
paper; nothing there is persisted. Mastery runs report whether the engine
admitted them; a refused start, grade, end, or report retry keeps the draft or
failure reason and explains the refusal in the composer hint. A session saved
while the next question was being generated restores as ended, not as the
already graded question.

Zotero-facing persistence is separate: `note/paperArtifactNote.ts` writes child
notes, and `workspace/artifactBundle.ts` packages collection-linked artifact sets.

## Preferences

Preferences are declared in three places that must stay in sync:

1. `addon/prefs.js` — runtime defaults (`__prefsPrefix__` is substituted at build)
2. `typings/prefs.d.ts` — generated by zotero-plugin-scaffold, but committed
3. `addon/chrome/content/preferences.xhtml` — the settings UI

Read them through `utils/prefs.ts` (`getPref` / `setPref`), never
`Zotero.Prefs` directly. Groups: General, Claude Code, Codex CLI, Retrieval,
Privacy. `defaultMode` accepts `codex_cli` or `claude_code`.

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
- The two engine modules are near-duplicates by design (isolation over reuse).
  Shared behavior belongs in `ai/workspaceRun.ts`, not in cross-engine imports.
- `addon/` is excluded from `tsconfig.json`, so `bootstrap.js`,
  `preferences.xhtml`, and `prefs.js` get no typecheck. Validate them in Zotero.
- `scripts/*.mjs` is outside the ESLint config. Use `node --check <file>`.

## Analysis consistency and maintenance boundaries

`ai/executionSettings.ts` captures the provider, CLI model argument, reasoning level
(Codex reasoning effort, or the configured Claude effort when one is set), and
response language before analysis preparation. The facade shares that
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
The two CLI engine modules remain separate for provider isolation.

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
Authentication details are not printed. The detached runner needs Unix tools
and `/bin/zsh`; native Windows execution is not supported, and Linux needs those tools installed.

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
`translation/responseLanguage.ts`, with subscriptions disposed with the pane.
This does not regenerate saved AI prose or translate verbatim paper evidence.
`ui/criticalReadDraft.ts` keeps unsent Critical Read input and expanded steps in
memory per paper, session, and step, so every rebuild restores them.

## Chat request identity and continuity

Ordinary chat captures one `RequestContextSnapshot` before persistence. It records the exact library, parent item, PDF attachment, fingerprint, selection, page and resolved annotation quote/comment. Both engines read that snapshot through `context/requestContext.ts`; a removed/replaced source fails closed. Project operations use an admitted `PrebuiltWorkspaceInput` with explicit source IDs and never recover a parent paper as hidden fallback input.

A chat workspace is keyed by item and PaperPilot session identity, independently of the editable thread title. Non-chat runs have unique directories. `workspace/supplementalFiles.ts` records and replaces owned inputs with a manifest. Only previously owned input files are removed; unknown legacy/user files are not broadly deleted. Full paper files remain available; the [retrieval evaluation](./chat-context-evaluation.md) did not justify narrowing the default context.

Before replacing inputs, the writer checks every planned input and runtime path.
An existing path outside the previous manifest's ownership blocks the write
without adopting or deleting that file. The manifest path itself is reserved.
Edited-input and ownership-conflict diagnostics identify the relative file and
workspace, with moving the file or starting a new conversation as recovery paths.
These preflight checks do not provide a filesystem transaction against external
writers changing files during preparation.

`ui/chatAdmission.ts` retains a stable submitted identity across rejected session/index writes; changing the recovered draft discards that association. `session/providerBinding.ts` requires the observed provider ID, PaperPilot session, exact source and fingerprint to match before native resume. User messages own immutable request snapshots and numbered execution attempts. Retry creates another attempt on the original question. Edit creates a separate conversation before the edited question; branching includes history through the selected completed answer. Provider session IDs are not copied to branches, and only an actual emitted provider ID can be resumed. A provider without a confirmed binding starts fresh with privacy-eligible PaperPilot continuity: user pins, a valid source-bound summary, and recent completed turns within 24,000 characters.

`ui/chatDraft.ts` keeps revisioned drafts in memory per item/session. Admission consumes only its captured revision; a preparation failure restores it only if the user has not begun another draft. Silent workbench actions pass an independent question rather than replacing the textarea. Busy state allows typing while continuing to block a second run. Transcript windowing supports message-ID navigation and preserves the reader's anchor when not following the latest output.

Chat answers use an explicitly discriminated envelope described in [prompt-contracts.md](./prompt-contracts.md). Citation candidates are locally matched against the exact PDF and rechecked on navigation. A match establishes a location, not a truth judgment. Public links activate only after an explicit click; local and privileged schemes are not enabled. Notes and project comparison questions have destination/content previews and explicit write actions. Chat notes include the original question, answer, source, citation statuses, and conversation/message provenance.

The existing history preference controls the expanded records. Full history can persist assistant text, citations, pins and summaries. Prompts-only excludes assistant-derived records; off writes no automatic history. Drafts are memory-only in every mode. This does not delete external CLI history. Legacy records migrate additively; pending attempts become interrupted after restart and invalidate the affected native provider binding. Unknown future or malformed snapshots are not silently rewritten.

## Durable project intake and run validity

Projects can reopen and choose a batch from their saved members without a current library selection. Home/catalog rendering precedes optional extraction. Candidate metadata is stored separately from included paper sources in `candidates-v1.json`: discovery/manual intake does not invent a PDF identity. Linking an existing bibliographic item and binding a specific PDF are separate explicit steps. The candidate lifecycle includes recoverable writes, export and project deletion.

Screening decisions, reading progress and understanding are independent. Screening events remain immutable; legacy states are preserved without inventing reading progress. Shared admission helpers exclude screened-out members across model and derived operations.

Run reuse includes an operation-input fingerprint over the question, columns, screening protocol, scope, schema/parser version and supplied upstream artifacts. Every supplied artifact participates in lineage. A semantic change invalidates reuse; reading progress alone does not. Membership and source fingerprints are checked at admission and before saving current results. Context coverage reports source characters separately from serialization overhead and redistributes spare quota from short papers.

Research Studio's MyST build cache points to the template directory of the last
successful immutable build for that project. A fresh build copies only those
templates before writing current document snapshots. Failed builds do not advance
the cache pointer; package/font dependencies remain the compiler's responsibility.

Research Studio keeps execution provenance on saved output versions and in
nbformat cell metadata. The kernel broker captures the exact code/run identity;
its native adapter records hashes of the project files copied at kernel startup.
The output inspector compares current code/output and captured inputs without
claiming to capture arbitrary host dependencies. A restored original output
retains its origin; a manual output edit does not inherit an execution claim.

Studio rename commits include new versions for affected literal text links.
`projectLinks.ts` bounds supported Markdown/TeX/Typst path syntax and
`projectGraph.ts` combines those references with board and output relationships.
Stable document IDs remain the target for cards and recorded execution sources.
The reference panel uses `referenceEvidence.ts` to reuse existing workspace
admission gates; click-time PDF verification remains in `evidenceNavigation.ts`.

The pinned DOCX engine's endnote export router receives a narrow build-time patch
from `scripts/studio-editor-compat.mjs`. Build failure on a nonunique match prevents
silently shipping an unpatched or twice-patched engine. Notes and contents stay in
OOXML, and all source modifications are identified in the bundled license notice.

The PDF preview packages its worker as a self-contained classic script and passes
it through the fixed host asset bridge into a Blob worker. This preserves the
opaque iframe sandbox in both Gecko and Chromium; Chromium rejects a Blob module
worker in that context. Startup waits for PDF.js's ready handshake, reports worker
errors, and bounds initial loading to 30 seconds. No document-supplied script or
PDF action is executed.

Draft versions retain insertion receipts pointing to the exact saved figure/table
version. Bytes and new receipts publish together. The insertion-history inspector
can follow those snapshots to their original notebook execution and current
freshness check. These are historical actions, not claims that a figure remains
embedded after later manual deletion. Project bundle export rejects a document
revision change while assembling conversation/research context.

### Academic DOCX proposals

`studio/academicDraft.ts` defines the bounded plain-paragraph/heading authoring
format shared by response validation, reviewed-text validation and the editor.
`aiPanel.ts` prepares an editable academic request and selects the active DOCX;
it does not call a provider until Send. `client.ts` inserts semantic paragraphs
through the pinned editor, exports bytes and restores the original editor on
failure. `StudioAIService` checks the resulting document text against the reviewed
append, and the repository applies its normal revision and receipt checks. The
existing document owns its style definitions; no journal layout is guessed or
hardcoded. New content uses Title, Heading1, Heading2 and Normal styles. All
existing file parts travel through the normal editor export path; complex Word
fields and layout still require the documented Word round-trip checks.
