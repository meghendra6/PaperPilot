# Manual QA Checklist

Use this checklist inside real Zotero 7, 8, and 9 runtimes before claiming readiness.

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
- [ ] Open the engine/model popover, switch each engine, save a model/effort selection, and confirm the existing preferences update
- [ ] While a provider run is active, attempt to switch providers and confirm the switch is blocked without clearing the active poller; after completion, switching works normally
- [ ] During workspace preparation, Retry persistence, a direct Auto Highlight/discovery run, and terminal cleanup, attempt New session and saved-session Open/Delete; confirm session replacement is blocked and no old workflow result appears in a new session
- [ ] Delay the session-transition cleanup await, then try chat, Retry, Auto Highlight, and Find verified prior work; confirm the transition token blocks every new admission until Open/New/Delete and rerender finish
- [ ] Delay normal chat reader-context/user-turn persistence, then try New/Open/Delete and a direct workflow; confirm the chat admission token blocks them until the controller owns the run
- [ ] While New/Open/Delete owns the session-transition token, click Workbench, Compare, initial/submit Mastery, and End Mastery/final-report actions; confirm none enters a running state or persists an old-session completion callback
- [ ] Complete one Paper Mastery evaluation that generates a follow-up question and one that generates the final report; confirm both nested runs start after the parent cleanup instead of reporting an active-run conflict
- [ ] Cancel a running Codex-backed Workbench or Paper Mastery request; confirm its workflow leaves the running/evaluating state, remains cancelled after the next poll interval, and can be started again
- [ ] Confirm the engine/model popover closes on outside click and Escape; Escape returns focus to its trigger
- [ ] Fill the pane with chat, recommendation, session, and mastery content; confirm chat keeps at least 120px and each expanded section scrolls internally without pushing the composer away
- [ ] Type one and many lines in the composer; confirm it grows from 72px to at most 180px, then scrolls internally
- [ ] Confirm the removed drag handle has no visible target or pointer behavior and the Send button submits the same way as Enter
- [ ] Switch away from and back to the paper (or refresh the custom section) and confirm exactly one header and three disclosure triggers remain, with no duplicate listeners or console errors
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
- [ ] Confirm the unified run-progress card and Codex model controls render only GPT-5.6 Sol, Terra, and Luna; a saved older model falls back to Sol
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

## 9. Verified discovery / Critical Read / auto-highlight checks

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

## 12. Regression checks

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
