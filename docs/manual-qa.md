# Manual QA Checklist

Use this checklist inside real Zotero 7, 8, 9, and 10 runtimes before claiming readiness.

## 0. Environment prerequisites

- [ ] The candidate `.xpi` installs successfully in Zotero
- [ ] Java 11+ is installed if OpenDataLoader-backed structured extraction is expected

## 1. Pane rendering

- [ ] Open a PDF attachment in Zotero Reader
- [ ] Confirm AI pane is visible in the reader/item pane area
- [ ] Confirm mode/status/session cards render without errors
- [ ] Trigger `Find verified prior work` and confirm the primary lane expands enough to show multiple recommendation rows immediately
- [ ] Confirm tall recommendation lists scroll inside the recommendation section without breaking chat history or the input area
- [ ] If paper-tool controls are present, confirm they do not crowd or overlap the existing mode/session controls
- [ ] If structured brief cards are present, confirm they remain readable without pushing chat input off-screen

### Reader pane redesign — Phase A theme bridge

- [ ] In Zotero light mode, confirm the pane background, text, dividers, inputs, and buttons blend with the native item pane
- [ ] In Zotero dark mode, confirm the same surfaces follow the native theme without low-contrast text or borders
- [ ] Confirm body links and 11–12px accent labels remain readable in both themes; native accent binding is limited to non-text indicators and borders
- [ ] Temporarily unset the inspected Zotero theme variables and confirm Paper Pilot falls back to its light/dark literals
- [ ] Tab through every native button, input, select, and textarea and confirm the native-colored focus ring remains visible
- [ ] On Windows, confirm focus uses Zotero's visible inner and outer ring; on macOS/Linux, confirm the native single ring remains visible
- [ ] Confirm primary, secondary, and ghost buttons have restrained hover/active feedback and disabled controls do not move

### Reader pane redesign — Phase B layout and density

- [ ] Confirm the always-visible chrome is one integrated engine/model header, three disclosure headers, optional compact run status, chat history, and the composer
- [ ] Confirm Workbench starts expanded while Find verified prior work and Past sessions start collapsed on a fresh profile
- [ ] Toggle all three disclosures with mouse, Enter, and Space; restart Zotero and confirm their state persists
- [ ] Complete a workbench or related-papers action while its section is collapsed and confirm only its summary/update dot changes—the section must not open itself
- [ ] Open the engine/model popover, switch each engine, click a model/effort option with the mouse, save it, and confirm the picker stays open long enough to persist the existing preference; repeat with keyboard selection
- [ ] While a provider run is active, attempt to switch providers and confirm the switch is blocked without clearing the active poller; after completion, switching works normally
- [ ] During workspace preparation, Retry persistence, a direct Auto Highlight/discovery run, and terminal cleanup, attempt New session and saved-session Open/Delete; confirm session replacement is blocked and no old workflow result appears in a new session
- [ ] Delay the session-transition cleanup await, then try chat, Retry, Auto Highlight, and Find verified prior work; confirm the transition token blocks every new admission until Open/New/Delete and rerender finish
- [ ] Delay normal chat reader-context/user-turn persistence, then try New/Open/Delete and a direct workflow; confirm the chat admission token blocks them until the controller owns the run
- [ ] While New/Open/Delete owns the session-transition token, click Workbench, Compare, initial/submit Mastery, and End Mastery/final-report actions; confirm none enters a running state or persists an old-session completion callback
- [ ] Complete one Paper Mastery evaluation that generates a follow-up question and one that generates the final report; confirm both nested runs start after the parent cleanup instead of reporting an active-run conflict
- [ ] Cancel a running Codex-backed Workbench or Paper Mastery request; confirm its workflow leaves the running/evaluating state, remains cancelled after the next poll interval, and can be started again
- [ ] Confirm the engine/model popover closes on outside click and Escape; Escape returns focus to its trigger
- [ ] Open the engine/model popover with Enter or Space and confirm focus moves into the dialog; the next Tab reaches the first visible setting instead of New session
- [ ] On a fresh session, confirm the `Start with this paper` guidance is visually distinct from assistant messages and disappears after the first admitted question
- [ ] Confirm the unavailable Compare helper names the visible `Related papers` and `Find verified prior work` controls exactly
- [ ] With a screen reader, confirm new conversation entries, Compare availability changes, and the visible `Thinking…` state are announced without repeating the elapsed timer
- [ ] Fill the pane with chat, recommendation, session, and mastery content; confirm chat keeps at least 180px and each expanded section scrolls internally without pushing the composer away
- [ ] Drag the Workbench, Related papers, and Past sessions resize handles independently; confirm every expanded body can grow beyond the old 240px cap and still scroll when its content is taller
- [ ] Drag the Workbench/chat boundary in both directions; confirm one area grows while the other remains usable, then use Up/Down, Home/End, and Enter on the focused separator
- [ ] Drag the bottom Paper Pilot handle beyond the old 960px pane cap, then double-click it to restore the responsive default height
- [ ] Narrow the Zotero item pane below 420px; confirm assistant messages use the available width and recommendation/session actions stack without horizontal clipping
- [ ] Open or generate a session with more than 48 visible chat messages; confirm only 48 message wrappers are mounted, the earlier-message control reports the suspended count, and the saved-session message count is unchanged
- [ ] Scroll to the top and bottom boundaries of a long chat; confirm the window advances in both directions without a visible jump, then use the earlier/newer buttons with keyboard focus
- [ ] While viewing an older chat window, send a new question; confirm the pane returns to the latest window, the new turn remains visible, and older turns stay recoverable by scrolling up
- [ ] Let a short running placeholder become a long final answer; confirm the chat follows the rendered answer to the bottom instead of returning to its top
- [ ] Select a PDF passage and run `Explain`; confirm both the submitted turn and the completed answer remain at the bottom after the persisted transcript rerenders instead of jumping to the top
- [ ] On a completed assistant answer, activate Copy and confirm the clipboard contains the latest visible answer; a rejected clipboard write must report `Copy failed`, never `Copied!`
- [ ] Type one and many lines in the composer; confirm it grows from 72px to at most 180px, then scrolls internally while the inset Send button never covers the placeholder or entered text
- [ ] Confirm every resize handle has a visible hover/focus state, remains keyboard reachable, and does not change the Send button's click/Enter behavior
- [ ] Switch away from and back to the paper (or refresh the custom section) and confirm exactly one header and three disclosure triggers remain, with no duplicate listeners or console errors
- [ ] Open two reader tabs, finish a Workbench action in the second tab, and confirm only the second tab's buttons and status change
- [ ] With different saved sessions open in two reader tabs, confirm Current/Open/Delete decisions remain scoped to each paper
- [ ] Disable and re-enable Paper Pilot with a reader tab open; confirm the console stays clean and exactly one Paper Pilot section remains
- [ ] Start a run on paper A, switch to paper B and back to A before completion, and confirm A still shows `Running` until the final persisted answer replaces it in the rebuilt pane
- [ ] Refresh the custom section with Paper Mastery awaiting an answer and after completion; confirm the current question, score, and final report rehydrate without starting a second run
- [ ] Click `Restart Paper Mastery` after completion and confirm cancellation preserves the old session while confirmation explicitly replaces it

### Reader pane redesign — Phase C run feedback

- [ ] Run each engine and confirm the compact card advances through `Preparing workspace`, `Running`, and `Finishing`, with elapsed time updating once per second
- [ ] Start a run on paper A, open paper B, and confirm B never shows A's progress, cancel, failure, or Retry state; return to A and confirm its state remains connected
- [ ] Cancel a running Codex, Claude, and Gemini request from the same card; confirm the process stops, silent workflows unlock, and no later poll overwrites `Cancelled`
- [ ] Cancel each engine while it still says `Preparing workspace`, immediately try to start or Retry another request, and confirm the replacement is blocked until the old preparation/cleanup settles; confirm the replacement workspace is not deleted
- [ ] While a chat run is preparing or a cancelled preparation is settling, try Auto Highlight and verified discovery; then reverse the order and try chat while either direct workflow is running. Confirm every overlapping request is blocked per paper
- [ ] For a CLI wrapper that starts child processes and ignores `TERM`, cancel the run and confirm the recorded process and its descendants are no longer alive after the bounded `KILL` escalation
- [ ] Force the process-stop executor to fail; confirm chat keeps the active pid/Cancel ownership, direct workflows keep their item reservation, no workspace cleanup/replacement starts, and the UI reports that termination was not confirmed
- [ ] After a forced stop failure, let the process write its delayed exit-code file; confirm the retained poller reconciles completion and the original 30-minute watchdog remains based on its first start time
- [ ] Start one long run per engine, disable the add-on, and confirm each recorded process and child is terminated with `ps`; a termination failure must be logged without blocking shutdown
- [ ] Cancel during workspace preparation, then make the late process's first stop fail; confirm the same run returns to Running with Cancel, and a second Cancel can terminate and settle it without restarting Zotero
- [ ] Return a started run without a numeric pid; confirm Cancel/timeout treats it as an unconfirmed stop and retains the same lifecycle barrier rather than unlocking
- [ ] Return pid `0` or `1`; confirm it is rejected before any kill command is executed and the run remains owned for safe recovery/restart
- [ ] Leave an old completed Codex state with a recorded pid, then change sessions; confirm the terminal pid is cleared without signaling that process
- [ ] Force Codex assistant-turn persistence to fail after process completion; confirm pending ownership settles but the terminal Codex state contains no pid and session cleanup signals nothing
- [ ] Fail one normal chat request for each engine, click Retry, and confirm the same question runs through the original engine; confirm Workbench/Mastery failures do not replace this retry target
- [ ] Double-click Retry and confirm only one user turn/run is created; switch to another saved session and confirm the old failure card does not replay its request into the new session
- [ ] While Retry persistence is delayed, start Auto Highlight/verified discovery and reverse the order; confirm the second claim is rejected before another user turn or direct workflow side effect is stored
- [ ] Click Find verified prior work while Retry or a session transition owns the item; confirm rejection does not clear existing lanes or persist a failure into either session
- [ ] Set the Claude/Gemini executable path to a missing binary and confirm the card says the executable was not found, offers `Open settings`, and opens the fixed Paper Pilot preference pane
- [ ] Set the Codex path to a missing binary: when another healthy Codex candidate exists, confirm the existing resolver recovers to it; in an environment/test seam with no healthy candidate, confirm the same executable-missing card and settings action
- [ ] Test logged-out Codex and Claude states; confirm the card classifies authentication, offers `Login help`, and keeps raw CLI output under the collapsed `Raw logs` disclosure
- [ ] Use a successful CLI wrapper that prints `answer` to stdout and a unique local-path marker to stderr; confirm only `answer` reaches live/restored chat and the marker remains diagnostic-only
- [ ] Make Auto Highlight and verified discovery exit non-zero with only a unique local-path marker on stderr; confirm both surfaces show a generic failure and never render the marker
- [ ] Force workspace artifact writing to throw after the per-paper directory is created; with automatic cleanup enabled, confirm the partial stable workspace is removed before a replacement can start
- [ ] Exercise a non-writable workspace and the timeout lifecycle test seam; confirm they become `workspace_error` and `timeout`, not guessed login/executable failures
- [ ] Complete a Paper Mastery turn that immediately starts a follow-up; confirm the child stays `Preparing`/`Running`, retains its PID/Cancel action, and the parent does not replace it with `Completed`
- [ ] Refresh or destroy the pane during a run and confirm only one elapsed timer remains; after a terminal state, no timer continues updating the detached pane

## 2. Mode behavior

- [ ] Switch to `Gemini CLI`
- [ ] Confirm Gemini session controls and mode messaging update correctly
- [ ] Switch to `Claude Code`
- [ ] Confirm Claude Code model controls and mode messaging update correctly
- [ ] Switch to `Codex CLI`
- [ ] Confirm the unified run-progress card and Codex model controls offer GPT-6 Astra plus GPT-5.6 Sol, Terra, and Luna; a fresh install, empty preference, or unknown/retired saved model defaults to Astra; with no saved reasoning effort, it uses `medium`
- [ ] Confirm an explicitly saved GPT-5.6 model/effort remains selected after upgrading; selecting Astra persists across a pane refresh and starts/resumes a run with `gpt-6-astra`
- [ ] Confirm Astra offers `low`, `medium`, `high`, `xhigh`, `max`, and `ultra` as supported by the installed Codex CLI, with invalid effort values falling back to `medium`
- [ ] Confirm per-paper mode override does not affect another document unexpectedly

## 3. Reader actions

- [ ] Select text in the PDF
- [ ] Confirm selection popup shows AI actions
- [ ] Trigger `Ask AI`
- [ ] Confirm draft/prompt state appears in pane
- [ ] Trigger annotation context menu action
- [ ] Confirm annotation-origin draft appears in pane

## 4. Research brief + paper-tool checks

- [ ] Trigger the research-brief entry point for the active paper
- [ ] Confirm the workbench shows `Research brief`, `Compare`, `Contributions`, `Limitations`, `Follow-ups`, `Save latest to note`, `Save for collection`, and `Clear cards`
- [ ] Confirm a structured response renders summary, contributions, methods, limitations, follow-up questions, and search-query guidance
- [ ] Confirm any inference/source-aware labels are visibly distinct from direct paper-grounded content
- [ ] Confirm generated brief/tool cards use full-paper workspace context when available and do not present metadata/abstract-only context as full-paper evidence
- [ ] Confirm generated brief/tool cards cite section, page, figure, or table support when available without inventing source locations
- [ ] Trigger each paper-tool quick action (`Contributions`, `Limitations`, `Follow-ups` or current equivalents)
- [ ] Confirm quick-action results stay scoped to the active paper and reuse the current session/prompt plumbing
- [ ] Confirm repeated runs replace the same card kind instead of endlessly duplicating cards
- [ ] Confirm `Save latest to note` is disabled until at least one workbench card exists
- [ ] Confirm `Save latest to note` creates or attaches a Zotero child note with the latest card content
- [ ] Confirm `Save for collection` packages the current workbench cards into a reusable collection-linked artifact note with traceable source context
- [ ] Confirm `Save for collection` is disabled until at least one workbench card exists
- [ ] Confirm `Save for collection` prompts for or uses a Zotero collection and saves the current workbench card set for collection-linked reuse
- [ ] Confirm `Clear cards` removes rendered workbench cards without breaking chat history or the input area
- [ ] Confirm malformed/failed structured output surfaces a clear error instead of silently breaking the pane
- [ ] Render a table with a repeated separator, headings, blockquotes, nested lists, fenced code, and prose beginning with `$$`; confirm no content is dropped or misclassified as a block
- [ ] Switch to another paper and back; confirm brief/paper-tool state does not leak across papers

## 5. Gemini CLI flow

- [ ] Enter a question in Gemini CLI mode
- [ ] Confirm a local Gemini run starts successfully
- [ ] Confirm output updates in pane and session metadata persists
- [ ] Send a follow-up question and confirm resume/session continuity works
- [ ] Verify invalid executable path or missing CLI state surfaces a clear error

## 6. Claude Code flow

- [ ] Enter a question in Claude Code mode
- [ ] Confirm a local `claude -p` run starts successfully
- [ ] Confirm output updates in pane and session metadata persists
- [ ] Send a follow-up question and confirm resume/session continuity works
- [ ] Verify invalid executable path or missing CLI state surfaces a clear error
- [ ] Verify permission mode behaves as configured in preferences

## 7. Codex CLI flow

- [ ] Verify invalid executable path shows failure state
- [ ] Verify login-required state is visible when Codex is not authenticated
- [ ] Verify writable/non-writable workspace state is shown correctly
- [ ] Send a first Codex question
- [ ] Confirm running indicator appears
- [ ] Confirm output updates in pane and run-state changes to completed or error
- [ ] Send a follow-up question on the same paper
- [ ] Confirm resume strategy is attempted
- [ ] Open the latest paper workspace folder and confirm `paper.md`, `paper.json`, and `paper.txt` were written
- [ ] Confirm `metadata.json` reports `extractionMethod: "opendataloader-pdf"` when Java/OpenDataLoader extraction is available
- [ ] If Java is intentionally unavailable, confirm `metadata.json` falls back to `zotero-attachment-text` and includes a readable extraction note
- [ ] Confirm the packaged add-on can resolve the bundled OpenDataLoader JAR without requiring a globally installed `opendataloader-pdf`
- [ ] Run a deliberately hanging OpenDataLoader wrapper; confirm its pid is terminated after two minutes and `metadata.json` honestly records the Zotero-text fallback reason

## 8. Session correctness

- [ ] Open `Past sessions` and confirm the current paper shows a compact saved-session list
- [ ] Open a saved session and confirm the prior transcript loads into the pane and follow-up turns continue in that same session
- [ ] Rename a saved session from `Past sessions` and confirm the updated title appears immediately
- [ ] Delete one saved session from `Past sessions` and confirm the list and pane state update correctly
- [ ] Use `Delete all` in `Past sessions` and confirm only the current paper's saved sessions are removed
- [ ] Use `New session`
- [ ] Confirm `New session` preserves the prior session in `Past sessions` and starts a blank draft instead of discarding it
- [ ] Confirm messages/draft/run-state reset for the new blank draft
- [ ] Confirm research-brief and paper-tool cards reset with the blank draft
- [ ] Switch between Gemini CLI, Claude Code, and Codex CLI and confirm previous threads do not mix
- [ ] Open a second paper and confirm context/session state does not leak from the first
- [ ] For each engine, send two visible chat turns, run one Workbench action, then send another chat turn; confirm the final turn resumes the visible chat context and never the hidden workflow
- [ ] Confirm the chat, analysis, and discovery runs use distinct workspace folders and hidden completion does not change the saved provider resume id
- [ ] Inspect an analysis run for each engine: Codex uses a read-only sandbox without search, Claude uses plan permission mode, and Gemini uses plan approval mode without `--yolo`
- [ ] On a fresh profile with no custom workspace root, confirm workspaces are created below `Zotero.getTempDirectory()/paperpilot-workspaces`, not shared `/tmp/zotero-paper-ai`
- [ ] Run Gemini chat with the default approval mode and confirm actions require approval; when `gemini --help` advertises `--sandbox`, confirm the launched command includes it
- [ ] Set each CLI path to an npm/nvm shim outside the fixed system PATH and confirm Codex, Claude, and Gemini can resolve the shim's `node`
- [ ] Configure non-default Codex sandbox and approval modes, send a follow-up turn, and confirm the resumed command retains both modes
- [ ] Edit and tab through every preferences field; confirm no modal alert appears on change
- [ ] Turn off local history while workspace auto-clean is off; complete a run and confirm its workspace is still removed
- [ ] With current Codex/Claude CLIs, run one structured Workbench action and confirm native schema output succeeds; with a wrapper whose help omits the schema flag, confirm the same action succeeds through parser-only fallback

## 9. Verified discovery / Critical Read / auto-highlight checks

- [ ] Ask auto-highlight to process a short residue such as `Δ = 0.5` and a quote repeated twice; confirm neither produces an annotation
- [ ] Auto-highlight one sufficiently long Greek quote and one sufficiently long CJK quote; confirm each lands on the unique exact passage

### Selection Explain transcript-rerender runtime record — 2026-08-23

The focused candidate was loaded as a temporary add-on in installed Zotero
10.0 with an isolated profile and data directory. The registered PDF selection
popup handler was invoked with a real `Explain` button and a deterministic local
Claude-compatible executable, without calling an external model. After the
20,155-character answer completed and the persisted transcript rebuilt its
message DOM, structured Firefox RDP inspection measured `scrollTop 15392`,
`scrollHeight 16052`, and `clientHeight 660`: a bottom gap of exactly zero.

The isolated window's message virtualization was forced visible for the long
layout measurement because its Paper Pilot section was outside the active
desktop viewport. The production `content-visibility: auto` rule was unchanged.

### Chat copy and answer-scroll runtime record — 2026-08-23

The focused candidate was loaded as a temporary add-on in installed Zotero
10.0 with an isolated profile and data directory. Structured Firefox RDP
inspection used local deterministic executables rather than an external model
and confirmed:

- a terminal answer retained its Copy footer after replacing the short running
  placeholder;
- Zotero's privileged clipboard helper was available, clicking Copy wrote the
  exact latest visible answer, the button reported `Copied!`, and the prior
  clipboard text was restored after the smoke;
- failed or unavailable browser clipboard writes propagate to the button's
  `Copy failed` state instead of displaying a false success; and
- an 8,151-character answer completed with the chat at `scrollTop 4532` for a
  `scrollHeight 5162` and `clientHeight 630`, exactly at the rendered bottom.

The isolated window's message virtualization was forced visible for the long
layout measurement because the QA window was positioned outside the active
desktop. The production `content-visibility: auto` rule was not changed.

### Chat composer alignment runtime record — 2026-08-23

The focused candidate was loaded as a temporary add-on in installed Zotero
10.0 with an isolated profile and data directory. Structured Firefox RDP
inspection and a captured window image confirmed:

- the Send control rendered inside the input border at the lower-right corner
  instead of hanging beside the textarea;
- the 304px-wide narrow pane kept a 292px-wide textarea with 78px of right
  padding and a 52 x 32px Send control fully inside that input area;
- twelve lines grew the textarea from 72px to its 180px cap and scrolled
  internally without moving or covering the Send control; and
- the absolutely positioned control remained programmatically focusable, while
  the empty composer returned to 72px after the multiline smoke.

This focused check did not invoke an external model; the existing send and
Enter-key checks remain in the full manual matrix above.

### Resizable reader layout runtime record — 2026-08-21

The development candidate was loaded as a temporary add-on in installed Zotero
10.0 with an isolated profile and data directory. Structured Firefox RDP
inspection plus operating-system mouse input confirmed:

- the responsive pane rendered at 560 x 987px in the isolated reader; the
  default Workbench body was about 282px (above the former 240px cap) and chat
  retained about 385px (above its 180px minimum);
- the Workbench, Related papers, and Past sessions separators each accepted a
  focused ArrowDown resize to 306px, with their `aria-valuenow` values matching
  the rendered height after attachment;
- moving the Workbench/chat separator from about 434px to 410px increased chat
  from about 385px to 409px, while the bottom separator increased the full pane
  from 987px to 1011px and Enter restored the responsive default;
- at a forced 380px container width, messages used a 100% maximum width,
  recommendation rows stacked vertically, and the model row wrapped;
- a real mouse click opened Zotero's native model menu, selected
  `GPT-5.6-Sol (low)`, and left the Paper Pilot popover open; clicking Save
  persisted both model and effort and updated the header, after which the
  isolated preference was restored to `GPT-5.6-Sol (medium)`; and
- a click in the model select or native `ContentSelectDropdownPopup` preserved
  the popover, while a normal click outside the header dismissed it.

This is a focused Zotero 10 reader-layout and model-picker smoke, not a complete
rerun of every engine, discovery, Critical Read, operating-system, or Zotero
7-9 scenario.

### Long-session windowing runtime record — 2026-08-21

The development candidate was loaded in the same isolated Zotero 10.0 setup
with a synthetic, on-disk 100-message session. Structured Firefox RDP
inspection confirmed:

- Past sessions and both the index and snapshot files retained the full
  100-message count, while opening the session mounted exactly 48 message
  wrappers for records 52–99 and reported 52 suspended messages;
- reaching the upper boundary shifted the mounted window to records 36–83,
  exposed both earlier/newer controls, and preserved a nonzero scroll anchor;
- reaching the lower boundary restored records 52–99, with 48 wrappers still
  mounted;
- activating the earlier control moved keyboard focus to the replacement
  earlier control after the window shift; and
- mounted message wrappers computed `content-visibility: auto` with a 96px
  intrinsic fallback.

The runtime fixture did not invoke an external model. The focused automated
test covers returning from an older window to the latest range before a live
append; full Codex, Claude, and Gemini send/complete checks remain in the manual
matrix above.

### Zotero 10 compatibility runtime record — 2026-08-21

The production XPI from the Zotero 10 compatibility candidate was loaded as a
temporary add-on in installed Zotero 10.0 with a fresh, isolated `.scaffold`
profile and data directory. Structured Firefox RDP inspection confirmed:

- Paper Pilot reached its active add-on lifecycle state and registered the
  reader section;
- opening the repository's test PDF produced a reader-scoped Paper Pilot pane
  with the engine header, three disclosure sections, and chat composer, without
  visible Paper Pilot error text;
- Zotero 10 exposed `getSelectedCollections()` while the removed
  `getSelectedCollection()` call threw its documented migration error; and
- with the removed singular API still throwing, `Save for collection` created
  a Zotero note and linked it to the only available collection through the new
  plural-selection compatibility path.

This is a focused Zotero 10 compatibility smoke, not a complete rerun of the
full engine, discovery, Critical Read, operating-system, or Zotero 7-10 matrix.

### Delivery runtime record — 2026-08-13

The final delivery candidate was loaded as a temporary add-on in Zotero 9.0.6
using the repository's isolated `.scaffold` profile and the existing QA PDF.
Structured Firefox RDP inspection confirmed:

- one Paper Pilot pane loaded without a visible runtime error;
- `Find verified prior work`, its optional concern field, three-lane save action,
  and `Critical Read` were present;
- starting Critical Read opened Step 1, kept `Run step 1` disabled before reader
  input, and displayed the truthful `not visually inspected` degraded-extraction
  notice;
- Codex discovery with web search disabled stopped before recommendations with
  the documented official-evidence requirement;
- authenticated Codex discovery with web search enabled progressed through
  structured provider retrieval into a real `codex --search exec` run and wrote
  `CONTEXT_INDEX.md` plus all four `discovery-*.json` artifacts;
- clicking Cancel changed the item-scoped state to cancelled and left no Codex
  discovery process running;
- a second authenticated Codex run completed end to end for the exact paper
  `Adaptive Insertion Policies for High Performance Caching`: the model output
  was parsed, Paper Pilot fetched the ISCA 2007 official program over a fresh
  public-address-checked connection, reconstructed `identity`, `accepted`, and
  `main_track` support from the inspected page instead of trusting model claims,
  and rendered the paper alone in the verified-main lane; and
- an exclusive production XPI build from the same source tree passed archive
  integrity checks and included the bundled OpenDataLoader JAR.

The broad compatibility matrix below remains a release/manual-regression
checklist. Zotero 7/8, Windows, a logged-out Claude account, and successful live
discovery through Claude Code and Gemini CLI were not available in this delivery
environment; their pure contracts and failure paths are covered by the automated
suite, but they are not represented here as real-runtime passes.

### Final hardening runtime record — 2026-08-14

The hardened candidate was exercised again in Zotero 9.0.6 with the same
standalone QA PDF. An authenticated Codex web-search response was captured from
the real discovery prompt, then replayed only to make the subsequent seven-step
workflow deterministic while testing Zotero state transitions. The live
official-source verifier still ran on the captured candidates: the raw response
parsed into 7 primary, 5 other-peer-reviewed, and 4 novelty candidates, while
the network-bound verification pass correctly failed closed to 0 primary, 0
other, and 4 novelty candidates when fresh official evidence could not be
retrieved.

The same run additionally confirmed:

- all seven Critical Read steps completed in order, Step 4 revision preserved
  unrelated completed work while invalidating and regenerating the final report,
  and public-review content stayed hidden before the Step 4-6 reader-first gate;
- after the gate, a marked review fixture appeared only in a separate Reviewer
  perspective with its public source URL, including in a saved standalone note;
- Discovery, Critical Read, and Compare notes saved for a standalone attachment
  without an invalid attachment parent;
- the saved session file contained all seven completed steps, survived a Zotero
  restart, reopened through Past sessions, passed live-evidence migration, rebuilt
  the final report, and immediately re-rendered Related papers and Critical Read;
- Compare selected one eligible peer, completed through the local CLI runner,
  parsed its strict JSON response, and rendered the compact snapshots, synthesis,
  and next-reading sections; and
- both a collection-linked reusable Compare artifact and a recommended-paper
  Zotero item were added to an actual collection. This exposed and fixed Zotero
  9's requirement that `Collection.addItems()` run inside a DB transaction.

The two-paper visual switch was not performed because the user asked to keep only
the supplied QA PDF open. Item/session isolation, stale-action rejection, and
pane-reconstruction cancellation remain covered by the automated state-machine
tests. The Zotero 7/8, cross-engine success, and operating-system matrix remains
manual release QA.

### Final verifier-v2 runtime record — 2026-08-14

The final hardened source tree was exercised in Zotero 9.0.6, and its production
bundle was built separately, without opening another PDF or reader window. The
only reader tab remained `Paper Pilot QA Fixture`. Two authenticated Codex
discovery runs used the real provider, workspace, CLI, parser, and live-network
verification path.

The first run intentionally supplied only the cache-policy research concern.
The agent selected ISCA, HPCA, MICRO, and SBAC-PAD without a user venue picker,
but supplied no independently sufficient main-track source. Verifier generation
2 therefore failed closed to 0 primary, 2 other-peer-reviewed, and 0 novelty
papers, while retaining explicit limitations instead of trusting model-authored
publication claims.

The second run requested the same research area and named one known paper whose
official status should be independently checked. The agent again selected the
venue plan and returned 1 primary, 2 other-peer-reviewed, and 0 novelty papers.
`Adaptive Insertion Policies for High Performance Caching` was retained as
`verified_main` with high evidence confidence only after the live verifier bound
its title, authors, and 2007 edition to the official ISCA main-program entry at
`https://iscaconf.org/isca2007/program.html`. A separate ACM proceedings page
corroborated identity and publication. The reconstructed ISCA evidence recorded
`identity`, `accepted`, and `main_track`; the ACM evidence recorded `identity`
and `published`. Unusable PDF and non-paper-level sources remained limitations
and did not create a primary-lane record.

The Zotero-native provider pass also exercised the window-owned
`AbortController` compatibility path and tolerant XHR header parsing that are
not represented by Node globals. The run finished as `Found 3 papers across
verified evidence lanes`, with verifier generation 2 and no additional reader
tab. Automatic generated-workspace cleanup was restored after evidence capture.

### Challenge-gate and Critical Read runtime record — 2026-08-18

The candidate was exercised in the user's default-profile Zotero 9.0.6 on
macOS, launched with the remote debugger enabled and driven over the Firefox
remote debugging protocol. Only the already-open standalone attachment
`LLM_Serving_Tutorial_Survey_IEEE_Style_v5` was used; no new PDF or reader tab
was opened. Replacing the `.xpi` file on disk did not reload the plugin —
Zotero kept serving the cached previous bundle until the XPI was reinstalled
through `AddonManager`, which is now the documented install path for QA. The
tested bundle was SHA-256
`2bd1a71da9668489347cbab1b83e2f5c5ebc7dd5fc8ea30571dc8465c9407369`, built from
source state `1715cc0`.

Three defects were found in this runtime and fixed with unit regressions
before the record below was completed:

- `202fb97`: OpenReview redirects anonymous forum page loads to a challenge
  interstitial with no forum id, so the registrar notes API was never
  consulted and every OpenReview-hosted verification failed. The claimed forum
  id now drives the fixed-host notes lookup and identity binds to the
  registrar submission record (title, authors, venue/venueid edition year).
- `eeba0ec`: cancelling during provider/verification fetches surfaced the
  generic failure message because the window-compartment `DOMException` fails
  `instanceof Error` in plugin code; aborted non-Error rejections now
  normalize to a cancellation message.
- `1715cc0`: restoring a session dropped empty lanes, losing the explicit
  "no main-track paper was verified" statement; restored groups now keep all
  three lanes.

Observed live, using the real authenticated Codex CLI with web search:

- A full discovery run returned 6 papers, all fail-closed into
  `published_track_unknown` in the second lane with live PMLR/ACM/NeurIPS
  official evidence, a Semantic Scholar 429 recorded as an honest partial
  limitation, and the named ICLR paper excluded with per-URL limitations
  because its official pages did not independently verify it.
- A refresh whose response contained no usable papers failed with a clear
  parse message while the previous successful result and its concern were
  restored intact.
- Every official-evidence request observed during verification carried the
  anonymous flag; a deterministic replay of a captured response through a
  stub CLI drove 12 OpenReview candidates through the live verifier, which
  attempted the notes API for each after the challenge fix.
- OpenReview currently challenge-gates the `/notes` API itself (HTTP 403
  `ChallengeRequiredError`, Cloudflare Turnstile) for anonymous clients, so an
  OpenReview-verified primary-lane paper and a verified `reviewURL` could not
  be produced end to end in this environment; the fail-closed exclusion and
  limitations were verified instead.
- Cancelling a fresh discovery during preparation returned the button to its
  idle state, left no Codex process, and allowed an immediate restart.
- All seven Critical Read steps completed in order through real Codex runs.
  Steps 1, 2, 4, 5, and 7 kept their run buttons disabled until reader input
  existed. Step 3 ran the three-lane discovery and verified six
  `verified_main` papers with high confidence from live `usenix.org` official
  proceedings pages (OSDI '22/'24, FAST '25/'26 — venues absent from any
  built-in shortcut), with the one unconfirmed publisher page conservatively
  downgraded and recorded in limitations.
- All typed step outputs rendered in the completed-step details: scan
  observations, research question with reader comparison, method checks,
  evidence conclusion, author comparison, paper-claim/agent-inference
  provenance, final synthesis, alternatives, and the discovery lane summary.
- Revising Step 4 opened a real confirmation dialog. Cancel preserved all
  state; accept reopened Step 4 with its reader input preserved, kept Steps
  5-6 complete, invalidated Step 7 and the report ("Only dependent outputs
  were invalidated"), and after rerunning Steps 4 and 7 the report was
  regenerated and saved to a note carrying the reader-input, paper-claim,
  agent-inference, and external-evidence separations. `Start Paper Mastery`
  remained available after completion.
- With Critical Read active below the Step 4-6 gate, review content injected
  into the live state was completely absent from the persisted session
  snapshot on disk while the live state stayed untouched, and recommendation
  rows showed no review link or insight.
- The saved discovery note for the standalone attachment kept the concern,
  three lanes, publication classes, and official evidence URLs without any
  raw public-review text.
- Saved sessions reopened across a full add-on reload with the discovery
  result, limitations, and concern restored, and (after `1715cc0`) all three
  lanes present including the empty primary lane.
- Compare enabled at `Compare (3)`, selected exactly the top three
  verified-main peers, completed through the real CLI, and rendered the
  compact snapshots, synthesis, and next-reading sections under the bounded
  provenance label.

Not performed in this environment and still owed to release QA: Zotero 7/8,
Windows/Linux, Claude Code and Gemini CLI engine passes, the two-paper visual
switch (single supplied PDF), an end-to-end OpenReview-verified primary-lane
paper with `Review insight` (blocked by OpenReview's Turnstile gating of the
notes API), and OpenDataLoader-backed extraction (its bundled-asset resolution
failure predates this branch; the honest `zotero-attachment-text` fallback and
extraction notes were verified instead).

Addendum: the round-9 merge-gate review of the record above found that the
first challenge-fallback implementation flattened registrar identity into one
text surface, letting venue words satisfy the author match, letting title or
forum-id digits satisfy the claimed year, and leaving a spelled-ordinal alias
in the legacy parser initials path. Commit `aac4018` binds registrar identity
to structured fields (submission title, author list with the page-path match
threshold, and the venue/venueid/invitation edition surface for the year) and
excludes spelled ordinals from the legacy initials, with regression tests for
all three reproductions. The corrected build (XPI SHA-256
`91e01f5e8e454983a3a4e176137ac3efcc3db8d0b89dd6276f737eacbe8b916f`) was
reinstalled into the same running Zotero and the captured-response replay was
re-run: the challenge fallback still reaches the notes API and fails closed
under the Turnstile gating with the same clear failure status and no state
corruption.

The round-10 follow-up review found two residual issues: a duplicated claimed
surname could count twice against a single registrar author, and the finite
ordinal word list ended at fifty, letting "The Sixtieth ..." forms mint false
initials aliases. Commit `5f43819` matches registrar authors as a multiset
and replaces the list with pattern-based spelled-ordinal detection, with
regression tests for both reproductions. That build (XPI SHA-256
`92957415862017d8915f6c5c182ae1d909ae0b3924d952b917d70c05612beb59`) was
reinstalled into the same running Zotero and the replay smoke-check repeated
with the same fail-closed outcome.

The round-11 follow-up found two further author/ordinal edge cases: dropping
sub-three-character surname keys lowered the registrar match threshold, and
generational suffixes ("III") acted as shared surnames, while composite
ordinals ("The One Hundredth ...") still minted a false initials alias.
Commit `5c6dbae` compares registrar surnames structurally (suffix-stripped
exact equality, short surnames significant, threshold from the claimed author
count) and extends spelled-ordinal detection to composite cardinal parts,
with regression tests for all reproductions. That build (XPI SHA-256
`c2304f58f68f0003a16aa95c4fed0760eff9cd7594526f32092679d265ea38fa`) was
reinstalled into the same running Zotero with the replay smoke-check repeated
and the same fail-closed outcome.

The round-12 follow-up found that surname keys were still lossy (apostrophes
and diacritics split tokens, suffixes past IV counted as surnames) and that
treating lone cardinals as edition words erased meaningful venue names such
as "One Health". Commit `a23caae` compares author names field-by-field
(whitespace-split tokens keep punctuation and diacritics whole, suffixes
through VIII strip, given names must not contradict) and strips spelled
numbers as sequences that must end in an ordinal form. That build (XPI
SHA-256 `f1b1ef06acf08409677fb479dc65ba27f5e6b8a7cb73ce2b16aa251502c29266`)
was reinstalled into the same running Zotero with the replay smoke-check
repeated and the same fail-closed outcome.

The round-13 follow-up found three precision issues in the new mechanisms: a
terminator anywhere in a number run erased the cardinals after it ("First One
Health"), an "and" connector split compound ordinals ("One Hundred and
First") and rejected genuine claims, and greedy author consumption made a
valid pairing depend on registrar ordering. Commit `8d1484b` ends ordinal
runs at their terminator with "and" connectors kept inside the run, and
computes registrar author matches as a maximum bipartite assignment, with
regression tests in both directions. That build (XPI SHA-256
`6efdff977e02adcb621de8426123728d9051e567ef5f09fd17a2045941cc2f7e`) was
reinstalled into the same running Zotero with the replay smoke-check repeated
and the same fail-closed outcome.

- [ ] Run `Find verified prior work` with no concern and confirm the agent infers fields, adjacent fields, venues, and query families without asking the user to choose a conference
- [ ] Enter an optional research concern, then run discovery from the main section, selected-PDF `Find prior work` action, a limitation card, and a follow-up card; confirm each source is carried into the saved scope
- [ ] In AI, computer architecture, and a third field, confirm an appropriate leading venue absent from any built-in source shortcut can still be selected and justified
- [ ] Confirm progress advances through understanding the question, selecting fields/venues, searching, publication verification, relevance/novelty analysis, and result preparation
- [ ] Confirm results render in three distinct lanes: Verified main-conference papers, Other peer-reviewed work, and Frontier / novelty radar
- [ ] Confirm the primary lane starts expanded, other lanes start collapsed, an empty primary lane says no main-track paper was verified, and `Show more` never exceeds the 12/6/6 caps
- [ ] Check an ACL/CVPR/NeurIPS-style official proceeding, an ACM/IEEE architecture proceeding, and an unseen venue; confirm primary rows show an official paper-level evidence link, observed main track, and high evidence confidence
- [ ] Feed a workshop, Findings, demo, industry, shared task, tutorial/abstract, track-unknown record, arXiv-only paper, and rejected/withdrawn submission; confirm none enters the primary lane
- [ ] Confirm a preprint and accepted version of the same paper merge, duplicates are removed, and the row never shows a fabricated relevance percentage
- [ ] Disconnect one scholarly provider or official source; confirm partial limitations are visible and a failed refresh leaves the previous successful result in place
- [ ] Open official evidence and public reviews; request `Review insight` and confirm strengths, concerns, priorities, disagreement, response/decision context, and limitations are separated without claiming private review access
- [ ] Save discovery to a child note and add a paper to a collection; confirm the optional concern, three lanes, publication class, official evidence URL, and search context survive while raw public-review text does not
- [ ] Confirm Compare chooses at most three verified-main peers; when that lane is empty it falls back to other peer-reviewed work and never silently chooses novelty-radar items
- [ ] Start Critical Read and complete all seven ordered steps; confirm only one step is active and Steps 1, 2, 4, 5, and 7 require reader input before analysis
- [ ] Confirm Step 1 shows abstract/caption/table orientation and says `not visually inspected` when only extracted text is available
- [ ] Confirm Step 3 runs the same three-lane verified discovery and Step 4 checks assumptions, data, controls, baselines, metrics, statistics, reproducibility, and validity threats
- [ ] Confirm Step 5 captures an independent results-based conclusion before Step 6 reveals and compares the authors' conclusion; public review insight must not leak into either step
- [ ] Revise Step 4 after completing later steps; confirm replacement requires confirmation, its final synthesis is invalidated, and unrelated Steps 5-7 inputs/outputs remain intact
- [ ] Complete Step 7 with alternatives and discriminating evidence/experiments, save the final child note, and confirm reader input, paper claims, agent inference, and external discovery evidence are visibly separated
- [ ] Reopen the session and restart Zotero during an incomplete Critical Read; confirm state resumes without silently starting another model run
- [ ] Handoff from the completed Critical Read to Paper Mastery and confirm the active paper/session remains scoped correctly
- [ ] Run `Highlight key passages` after discovery and Critical Read; confirm all surfaces coexist without making the pane unusable

## 10. Compare / reusable artifact checks

- [ ] `Compare` stays disabled before recommendations exist, then becomes enabled with a compact ready count once related papers are available
- [ ] Multi-paper compare flow launches from the current paper plus a bounded recommended-paper set rather than an unbounded picker
- [ ] First compare flow stays capped to the current paper plus at most 2-3 peer papers
- [ ] Compare output remains compact and clearly tied to the selected papers
- [ ] Compare surface avoids wide tables or layouts that crowd the existing workbench/recommendation/chat areas
- [ ] `Save for collection` preserves reusable artifact content with traceable source paper context

## 11. Cross-engine discovery checks

- [ ] Repeat discovery and Critical Read smoke checks with Codex CLI, Claude Code, and Gemini CLI
- [ ] Inspect each generated workspace and confirm `CONTEXT_INDEX.md` plus all four `discovery-*.json` files exist for discovery runs
- [ ] Disable agent web search where the engine supports it; confirm discovery stops before recommendations because candidate providers alone cannot locate official evidence for an unseen venue
- [ ] Confirm no engine downloads an official PDF body merely to verify publication status
- [ ] Confirm every discovery/Critical Read surface remains paper-scoped across two open papers

## 12. Integrated Research Workspace checks

- [ ] Install only `paper-pilot.xpi`; confirm Zotero lists no separate PaperPilot Research Workspace extension and the Research Workspace section appears under the Paper Pilot add-on ID
- [ ] Open the section from both a reader tab and a library item, switch the active Paper Pilot engine, and confirm runs use that engine without adding hidden turns to visible chat or changing its resume session
- [ ] Attach two different PDFs to one Zotero parent item, select the second attachment row, and confirm Research Workspace extracts and cites only that exact PDF rather than the first attachment
- [ ] Use equivalent item and attachment keys in a personal library and a group library; confirm their Research Workspace records remain distinct through reload
- [ ] Replace or modify an indexed PDF, reopen Research Workspace, and confirm the changed fingerprint marks prior outputs stale while preserving them for review
- [ ] Run an evidence-producing action with one exact quote and one deliberately unmatched quote; confirm only the locally matched quote has a `Verified` Open in PDF button
- [ ] Confirm a verified evidence button resolves only `libraryID + attachmentKey`, while the same attachment key in another library is never opened as a substitute
- [ ] Remove or move the source PDF and reopen a historical result; confirm it is labelled `source-unavailable` and has no misleading navigation action
- [ ] With OpenDataLoader available, confirm the paper summary reports `structured`; disable it and confirm the honest `zotero_text` fallback still loads
- [ ] Search for an exact symbol and a conceptual mechanism; confirm hybrid search ranks relevant chunks without launching an AI CLI
- [ ] Run claim extraction, profiled audit, reproducibility, and Paper-to-Code; confirm each result renders as a labelled human-readable report rather than a raw JSON field tree, evidence links open the correct attachment/page, and parser failure permits one correction attempt
- [ ] In Claim Ledger, confirm claims start as a compact review list; status and type filters work; expanding a claim exposes quote, locator, and verifier detail; only locally verified evidence offers `Open in PDF`; model confidence is not presented as truth confidence; and `Copy readable Markdown` produces headings, prose, quotes, and review status without internal IDs
- [ ] Force all Claim Ledger evidence to `unverified`, `not-found`, or `source-unavailable`; confirm the overview reports zero ready-to-cite claims even when the model returned `verificationStatus: verified`
- [ ] Start and resume Mastery 2.0, submit an answer with confidence, and confirm criterion scores, misconceptions, calibration, and the next review survive a Zotero restart
- [ ] Select at least two library papers and build an Evidence Matrix and Literature Graph; confirm persisted coverage and graph integrity, then create and grade a cross-paper mastery question
- [ ] Classify citation contexts and confirm unknown attachment evidence is discarded rather than made navigable
- [ ] Open the modeless project window, select several items in the Zotero library, then change the live selection; confirm the captured project papers and screening rows do not drift
- [ ] Add inclusion and exclusion criteria, record abstract and full-text include/maybe/exclude decisions, and confirm an exclusion cannot be saved without a visible reason
- [ ] Change a prior screening decision and confirm the original event remains in History with its original protocol/source snapshot and the new event points to it as superseded
- [ ] Add papers with matching normalized DOI values and matching exact title plus year; confirm duplicate badges are advisory and never change review status automatically
- [ ] Detach or remove a project PDF and confirm a missing-PDF badge appears without automatically excluding the paper
- [ ] Export the Screening Log as JSON and CSV; confirm every historical event is present and spreadsheet-formula-leading titles, reasons, and notes are neutralized
- [ ] With no live Zotero selection, open a project that already has current Claim Ledger, Evidence Matrix, or Synthesis artifacts and build Contradictions & Evidence Gaps
- [ ] Confirm building the dashboard starts no PDF extraction, CLI/model process, or network request and records `local` in lineage
- [ ] Verify opposite, locally verified evidence-linked assertions about one concrete shared outcome or metric with two matching design dimensions appear as rule-detected contradiction candidates, while generic result labels remain uncertain and a population or method difference appears as non-comparable
- [ ] Verify stale, partial, failed, fingerprint-mismatched, source-unavailable, forged-verifier, and individually unverified evidence never becomes an admitted dashboard assertion
- [ ] Confirm missing experiment, dataset, population, and replication coverage is described only as a gap in the current project snapshot
- [ ] Confirm, reclassify with a reason, and dismiss with a reason; reopen Zotero and verify the append-only review history and deterministic rule result are both preserved
- [ ] Replace an upstream artifact or change a paper's screening status and confirm the previous dashboard becomes stale without being deleted
- [ ] Open Living Review and run Check now; confirm the first scan creates a baseline with no change alert and does not start PDF extraction, a CLI/model process, or a network request
- [ ] After that baseline, add another paper to the project and confirm one `project-source-added` inbox event appears without fabricating a PDF or annotation change
- [ ] Add, edit, and delete a Zotero annotation; confirm one metadata-only annotation change appears, can be marked reviewed or dismissed, and does not stale artifacts that have no annotation lineage
- [ ] Replace a PDF, delete or move its local file, and restore it; confirm PDF changed, source unavailable, and source restored events appear and affected artifacts in every project sharing the source become stale
- [ ] Trigger a burst of Zotero item notifications, disable and re-enable the add-on, and confirm scans remain serialized and the observer is neither leaked nor registered twice
- [ ] With current Citation Context and Citation Stance artifacts, build Citation & Reference Health and confirm unresolved/ambiguous references, contrasting stances, and references absent from the scanned local library appear as review signals rather than truth verdicts
- [ ] Add `Correction`, `Erratum`, `Expression of Concern`, or `Retraction` text to a relevant local Zotero item's title, Extra field, or tag; rebuild and confirm the signal identifies the exact local library/item while requiring primary-source verification
- [ ] Add current Methodology Audit and Reproducibility artifacts; confirm major/critical checks, missing materials, and blockers appear with their saved evidence/limitations and that stale or fingerprint-mismatched inputs are excluded
- [ ] Import a local `.txt` or `.md` draft containing one supported statement and one unsupported empirical statement; confirm the saved artifact contains only a bounded fingerprint/excerpt, labels unmatched text as a bounded lexical coverage candidate, and never displays an aggregate truth score
- [ ] Confirm Citation & Reference Health starts no model/CLI or network request, records `local` provider lineage, includes all admitted upstream artifact payload fingerprints plus the current members revision, and becomes stale when an input artifact or project membership changes
- [ ] If an optional external citation-status provider is integrated, disconnect it and test partial coverage; confirm provider coverage/limitations remain visible and no external signal is treated as the sole source of truth
- [ ] Open the Research project templates selector and inspect all five templates: Exploratory literature review, Systematic review, Reproduction project, Technology comparison, and Paper reading group
- [ ] Edit the template name, description, research question, assumptions, and capability preset IDs in the preview; create the project and confirm no capability, model, CLI, or network action starts automatically
- [ ] In the created project, confirm recommended capabilities are visibly emphasized while non-recommended capabilities remain present and runnable
- [ ] Edit assumptions and capability presets in Project template settings, restart Zotero, and confirm the immutable original template snapshot is unchanged while the edited values persist
- [ ] Export the template project as JSON and Markdown; confirm both contain the original template snapshot, current assumptions, and current capability preset IDs
- [ ] Open Safe Zotero collection and tag sync, load targets, and confirm only existing collections and existing tags from the project source libraries are offered
- [ ] Build a full preview for a project containing regular items, an attachment or standalone PDF identity, a missing item, and an item from another library; confirm only same-library regular bibliographic items receive additive changes and every blocked/no-op item is shown
- [ ] Copy the preview-bound approval token, alter the collection or tag selection, and confirm the prior token cannot approve the changed preview; then change project membership or Zotero collection/tag state and confirm the stale preview is rejected before writing
- [ ] Disable or simulate absence of `Zotero.DB.executeTransaction`; confirm apply and undo fail closed and no collection membership or tag association changes
- [ ] Approve one collection addition and one existing-tag association; confirm a prepared write-ahead receipt exists before the transaction, the committed receipt contains one result per preview item, and the receipt is stored outside Research Workspace artifact history
- [ ] Confirm the approved sync creates no Zotero item, collection, tag, note, attachment, annotation, or PDF and changes no bibliographic field; only the previewed collection membership and tag associations may change
- [ ] Create an existing tag containing two consecutive spaces, select that exact tag for sync, and confirm Paper Pilot attaches the byte-identical name without creating a collapsed one-space tag
- [ ] Inspect Zotero notifier events where supported and confirm PaperPilot-originated receipt/action data is attached to collection/tag changes without being treated as proof for unrelated events
- [ ] After apply, add a different collection and tag manually, then run Undo receipt-owned additions; confirm only the receipt-owned collection/tag additions are removed and both pre-existing and later unrelated state remain
- [ ] Interrupt or force a failure between receipt preparation, Zotero apply, and receipt finalization; confirm failed or unresolved receipts never fabricate ownership, the exact preview cannot be blindly reapplied, and unsafe undo remains disabled
- [ ] Restart Zotero and reopen the project; confirm committed, failed, partially undone, undone, and unresolved prepared receipt states remain visible with their revisions and per-item results
- [ ] Export JSON and Markdown; confirm both files are written below the Zotero profile's `paperpilot-research-workspace/exports` directory
- [ ] Start with a former companion `workspace-v3.json`; confirm papers, reports, Mastery, matrices, graphs, cross-paper state, and citation state remain while provider/executable and Monitor state are removed
- [ ] Cancel or close the pane during a run; confirm the process is stopped, its workspace is cleaned, and the paper reservation becomes available again
- [ ] Confirm no Research Monitor controls, state, runtime modules, add-on manifest, companion bootstrap, or second XPI are present

## 13. Regression checks

- [ ] Preferences pane opens without errors
- [ ] Build artifacts install and load in Zotero
- [ ] Built `.xpi` contains `chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar`
- [ ] No console/runtime errors during pane render and action triggers

## Session history and silent-turn QA (2026-04-16)

After running mastery and one or more workbench tools (research brief, contributions, limitations, follow-ups, paper compare) on a paper, then opening "Past sessions":

- The session list stays inside the bounded `Past sessions` disclosure body and scrolls internally instead of pushing the composer away.
- The disclosure opens and closes with mouse, Enter, and Space while preserving its expanded state.
- Each row is a single line: title (with optional Current / cards-saved badges), meta line, an Open button, and a kebab (⋯) button. Rename and Delete live inside the kebab menu.
- Delete and Delete all show a confirmation dialog. Cancel keeps the data.
- Reopening a session that previously ran mastery / workbench tools shows the natural chat transcript in the message list (prose markdown), with NO raw JSON lines.
- Mastery cards, workbench cards, and recommendation groups still rehydrate when the session is reopened (existing behavior).
- After opening a saved session, sending a fresh chat message continues to work end-to-end with Codex CLI, Claude Code, and Gemini CLI.

## Analysis consistency and model provenance

- Limit `codexAllowedModels` to `gpt-5.6-luna`, leave the saved default at another
  model, and reopen the picker. Only Luna and its supported reasoning levels should
  appear; a new run should use Luna. An obsolete-only list should fall back to the
  current catalog. Restore the original preference afterward.
- Switch Codex → Claude → Gemini after saving each model. Recent models must remain
  scoped to their provider.
- Start a multi-paper analysis, then change the preferred model, effort, and response
  language during preparation. All units and saved lineage must retain the admitted
  settings. On a later resumed run, changed settings or projections must cause rows
  to be regenerated.
- Refresh an admitted PDF while its analysis runs. No result derived from the old
  fingerprint should become complete; completed checkpoints should remain inspectable
  as stale. Retry with the refreshed source and check successful completion.
- Close Zotero while a direct Research Workspace run is active, including during
  preparation. Check the recorded detached process and descendants terminate. Repeat
  a normal completed run to ensure no stale PID remains registered.
- With a disposable Zotero profile, leave an old unversioned or truncated versioned
  OpenDataLoader JAR in `paperpilot-tools`, then extract a known PDF. Confirm the
  current bundle is used and the old unversioned file is preserved. Run the doctor
  against that profile and check the matching-runtime report.
- Open the project home, create a template project, inspect sync previews without
  applying them, navigate review panels, open existing artifacts, and close/reopen
  the window. Confirm that split modules preserve controls, cancellation, evidence
  navigation, compact layout, and stale-view protection.

## Response language in analysis

- Open settings and choose Korean. Close and reopen settings; Korean must remain
  selected. Start a new Critical Read step with an English paper and English reader
  input. Verify summaries, findings, questions, and limitations are Korean prose.
- Repeat the Methodology Audit in Research Workspace and another structured action
  such as Research Brief. Check generated prose, including expanded details, uses
  Korean while exact evidence quotes, original titles, and machine identifiers stay
  unchanged.
- Repeat with Chinese and English, including a provider switch. The newly selected
  language must apply to the next request; existing saved results are not translated
  automatically. Restore the original preference after the checks.
