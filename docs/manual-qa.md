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
- [ ] Open the engine/model popover, switch each engine, click a model/effort option with the mouse, and confirm the popover stays open while you pick; click Save and confirm the preference persists, the popover closes, focus returns to its trigger, and the header chip shows the saved model and effort; repeat with keyboard selection
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
- [ ] At a short window height with Zotero sections above Paper Pilot, confirm automatic sizing keeps the composer visible; manually resize and reset the pane, then resize the window and expand preceding Zotero sections
- [ ] Fill the pane with chat, recommendation, session, and mastery content; confirm chat keeps at least 96px and each expanded section scrolls internally; constrained layouts must allow scrolling to the composer
- [ ] Type an unsent draft with attached PDF context, search saved conversations, open a result, then Return to reading; confirm the original draft/context and conversation are restored without saving a draft-only history entry
- [ ] Delay an old search failure until after a new search succeeds; confirm the current results remain. Delay restoration and confirm search stays open with controls disabled until restoration succeeds; failures allow retry
- [ ] Open Actions, focus a command and press Escape; confirm the menu closes, its expanded state is false, and focus returns to the composer
- [ ] Pin a message as an answer finishes, then reopen history; confirm the answer and pin both survive. Repeat delayed persistence across rename, deletion and opening another saved session
- [ ] Drag the Workbench, Related papers, and Past sessions resize handles independently; confirm every expanded body can grow beyond the old 240px cap and still scroll when its content is taller
- [ ] Drag the Workbench/chat boundary in both directions; confirm one area grows while the other remains usable, then use Up/Down, Home/End, and Enter on the focused separator
- [ ] Drag the bottom Paper Pilot handle beyond the old 960px pane cap, then double-click it to restore the responsive default height
- [ ] Narrow the Zotero item pane below 420px; confirm assistant messages use the available width and recommendation/session actions stack without horizontal clipping
- [ ] Open or generate a session with more than 48 visible chat messages; confirm only 48 message wrappers are mounted, the earlier-message control reports how many messages are not shown, and the saved-session message count is unchanged
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
- [ ] Cancel a running Codex and Claude request from the same card; confirm the process stops, silent workflows unlock, and no later poll overwrites `Cancelled`
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
- [ ] Set the Claude executable path to a missing binary and confirm the card says the executable was not found, offers `Open settings`, and opens the fixed Paper Pilot preference pane
- [ ] Set the Codex path to a missing binary: when another healthy Codex candidate exists, confirm the existing resolver recovers to it; in an environment/test seam with no healthy candidate, confirm the same executable-missing card and settings action
- [ ] Test logged-out Codex and Claude states; confirm the card classifies authentication, offers `Login help`, and keeps raw CLI output under the collapsed `Raw logs` disclosure
- [ ] Use a successful CLI wrapper that prints `answer` to stdout and a unique local-path marker to stderr; confirm only `answer` reaches live/restored chat and the marker remains diagnostic-only
- [ ] Make Auto Highlight and verified discovery exit non-zero with only a unique local-path marker on stderr; confirm both surfaces show a generic failure and never render the marker
- [ ] Force workspace artifact writing to throw after the per-paper directory is created; with automatic cleanup enabled, confirm the partial stable workspace is removed before a replacement can start
- [ ] Exercise a non-writable workspace and the timeout lifecycle test seam; confirm they become `workspace_error` and `timeout`, not guessed login/executable failures
- [ ] Complete a Paper Mastery turn that immediately starts a follow-up; confirm the child stays `Preparing`/`Running`, retains its PID/Cancel action, and the parent does not replace it with `Completed`
- [ ] Refresh or destroy the pane during a run and confirm only one elapsed timer remains; after a terminal state, no timer continues updating the detached pane

## 2. Mode behavior

- [ ] Confirm the mode actions offer only `Claude Code`, `Codex CLI`, and `Use Default`; there is no `Gemini CLI` button
- [ ] Set `defaultMode` to `gemini_cli` (or any other unknown value) through the Config Editor; confirm a paper without an override opens in Codex CLI mode and the settings select shows a "not recognized" option that names the fallback
- [ ] Switch to `Claude Code`
- [ ] Confirm Claude Code model controls and mode messaging update correctly, and that the effort select next to the model picker offers `default effort` plus `low` through `max`
- [ ] Switch to `Codex CLI`
- [ ] Confirm the unified run-progress card and Codex model controls offer GPT-6 Astra, Sol, and Luna plus GPT-5.6 Sol, Terra, and Luna, each listed once, with a separate effort select next to the model picker; a fresh install, empty preference, or unknown/retired saved model defaults to Astra; with no saved reasoning effort, it uses `medium`
- [ ] In Codex mode, pick `ultra` on GPT-6 Sol, then switch the model to GPT-6 Luna; confirm the effort select drops `ultra` and selects `medium`. Pick `high` and switch to GPT-6 Astra; confirm `high` stays selected. Close the popover without saving and confirm both selects return to the saved values
- [ ] Confirm an explicitly saved GPT-5.6 model/effort remains selected after upgrading; selecting each GPT-6 model persists across a pane refresh and starts/resumes a run with its exact model ID (`gpt-6-astra`, `gpt-6-sol`, or `gpt-6-luna`)
- [ ] Confirm Astra offers `low`, `medium`, `high`, `xhigh`, `max`, and `ultra` as supported by the installed Codex CLI, with invalid effort values falling back to `medium`
- [ ] Confirm GPT-6 Sol offers `low` through `ultra` and invalid effort values fall back to `low`; GPT-6 Luna offers `low` through `max`, excludes `ultra`, and invalid effort values fall back to `medium`
- [ ] With a custom `codexAllowedModels` list, confirm only listed supported models appear; explicitly include `gpt-6-sol` and `gpt-6-luna` to enable them in a restricted picker
- [ ] Confirm per-paper mode override does not affect another document unexpectedly

### Korean terminology in generated answers

- [ ] With response language Korean, ask about `probability distribution` and another English term from the selected passage; confirm natural Korean explanations retain the English terms without routine Korean translations or bilingual glosses
- [ ] Repeat in an existing chat whose earlier answers translated the terms; confirm new answers follow the current terminology policy
- [ ] Run a structured summary or Mastery question and confirm its prose keeps English technical terms while JSON keys, enums, and verbatim evidence remain unchanged
- [ ] Explicitly request the Korean wording of a technical term; confirm the model may provide it

## 3. Reader actions

- [ ] Select text in the PDF
- [ ] Confirm selection popup shows five distinct bordered AI buttons with visible spacing, hover, and keyboard focus in light and dark reader themes
- [ ] Click Explain once; confirm it auto-submits, clears the selection draft card, and shows preparation / waiting / finishing status with elapsed time
- [ ] Confirm Send becomes Stop and the input stays disabled during preparation and model execution; Stop shows Stopping until cancellation/cleanup settles, then Send and the input return
- [ ] Attempt Enter, repeated popup clicks, and a pane refresh during a run; confirm no duplicate request and no unlocked input while the original run is active
- [ ] Cancel during request preparation and again during model execution; confirm a late preparation result cannot start a replacement process or unlock another paper's input
- [ ] Force session persistence to reject before model launch; confirm a visible error, stopped animation, and usable input instead of indefinite Thinking
- [ ] In the installed add-on sandbox without `structuredClone`, confirm Explain persists its user turn, starts the CLI, displays an answer, and reopens the saved session
- [ ] Trigger `Ask AI`
- [ ] Confirm draft/prompt state appears in pane
- [ ] Trigger annotation context menu action
- [ ] Confirm annotation-origin draft appears in pane

### Naver dictionary popup

- [ ] Select `cost` and activate Naver Dictionary; confirm a separate Zotero dictionary window opens, with no inline result next to Ask AI and no browser page or iframe
- [ ] Confirm `cost` displays its headword, phonetic symbols, noun and verb meanings, and source; selection alone must not send a request
- [ ] Keep the window open and continue reading the PDF; look up `models`, a Korean query and a multi-word term, and confirm the same window updates
- [ ] Start another lookup before the first completes; confirm only the latest word can populate the window
- [ ] Confirm related search hits are not substituted for a missing definition; empty matches and network/schema failures have distinct states, and failures offer Retry
- [ ] Close via Escape, the Close dictionary button, the native window close control, and disabling the add-on; confirm late responses cannot reopen the window
- [ ] Repeat lookup during an AI run; confirm no changes to the draft, attached context, transcript, provider session or model activity
- [ ] Check keyboard focus, light/dark themes and resizing; meanings must scroll within the dictionary window
- [ ] Confirm More on Naver opens only on click and points to the displayed entry (or the selected query when no exact entry URL exists)
- [ ] Verify empty and oversized selections (over 80 characters or 8 words) have no dictionary button; repeated lookups and Retry must not accumulate active requests or listeners

### Figure and table explanation

- [ ] In a PDF reader, click the toolbar **Explain figure or table** button; confirm it turns active, Zotero switches to Select Area, and the tooltip explains the next step
- [ ] Drag around a chart; confirm the explanation window opens beside the PDF without another click, the reader returns to its previous tool, and the toolbar button turns inactive
- [ ] Arm the mode and press Esc, click the button again, or wait two minutes; confirm the previous tool returns and a later area selection opens nothing
- [ ] Draw an area around a chart with Select Area; confirm the sidebar card shows **Explain** on area annotations only, and clicking it keeps the current annotation selection
- [ ] Right-click the area in the PDF view and in the sidebar; confirm **Explain figure or table** appears for one area annotation and not for highlights or multi-selections
- [ ] Confirm a separate Zotero window opens with the selected image, the page label, the detected caption, elapsed time, and Stop; the reader stays usable
- [ ] With Codex CLI and with Claude Code, confirm the result shows a title, summary, How to read, Key points with Visible/Paper/Inference badges, In the paper, and Caveats in the response language
- [ ] Explain a table with its caption above it and an IEEE-style `TABLE II` caption; confirm label and caption detection
- [ ] Choose **Explain figure or table** from the reader's own annotation context menu; confirm Zotero stays open (Zotero 10.0.6 crashed when this command opened the window synchronously)
- [ ] Stop during preparation and during the run; confirm "Stopped." within a second, no surviving CLI process, no `figures/selected-region.png` left in the workspace, and that Retry starts without "already active"
- [ ] Close the window during a run; confirm the run stops and a late result cannot reopen the window
- [ ] Request another area while one runs; confirm only the latest result appears and the paper is not left reserved
- [ ] Stop while the status still reads "Reading the selected area…" or "Starting…", then Retry at once; confirm "Waiting for the previous run to stop…" and a normal start instead of "already active"
- [ ] Arm the toolbar tool and close the PDF tab; confirm no later area or sync opens a window and Zotero logs no dead-object error
- [ ] Start chat on the same paper during an explanation, and the reverse; confirm the busy message and that Retry works afterwards
- [ ] Explain the same area again; confirm "Reused from this session", and that Regenerate starts a new run
- [ ] Remove the area's cached PNG; confirm Zotero renders it again or the text-only notice and caveat appear
- [ ] Check light and dark themes, keyboard focus, Escape, resizing, and that a long explanation scrolls together with the image

#### Runtime record — 2026-10-14 (Zotero 10.0.6, macOS, Codex CLI)

Driven over the remote debugger on the DistServe paper (area annotation on page 1).

- Reproduced the reported crash twice: the reader's internal context-menu row opened the window from the iframe timer and Zotero exited with the same SIGSEGV stack. Opening from a fresh main-thread task did not crash; the fixed build passed the same path.
- The toolbar button armed the area tool, an `add` notifier event for the area opened the window, the previous tool returned, and the observer unregistered.
- The window showed the cached image, the detected `Figure 1` caption, and a Korean explanation with Visible/Paper badges after about 52 seconds.
- Stop returned "Stopped." in about 0.25 seconds twice; the Codex process exited and Retry started a new run without "already active".
- Not exercised: a real mouse drag in the PDF view, Claude Code, dark mode, and the text-only path without a cached image.

### Review verification — 2026-09-21

See [the product review](product-review-2026-09-21.md) for confirmed defects,
automated verification and the separate native Zotero evidence. The earlier
browser-only inline-card check did not establish native rendering correctness;
the replacement dictionary window has now displayed the live `cost` meanings
and phonetics in native Zotero 10.0.3.

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

## 5. Claude Code model and effort

- [ ] Open the Claude model picker and confirm that, after any recently used models, it lists the family aliases `sonnet`, `opus`, `haiku`, and `fable` (labelled `(latest)`), followed by pinned `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, `claude-opus-5`, and `claude-sonnet-5`; a fresh profile selects `sonnet`
- [ ] Save `Opus 5.5` or `claude-opus-5.5` as the Claude default model in settings; confirm the picker selects `claude-opus-5-5` and the launched `claude -p` command uses `--model claude-opus-5-5`
- [ ] Set the Claude default model to `claude-opus-5-5[1m]`; confirm the picker shows it with a 1M-context label, a chat run completes, and the launched command passes `claude-opus-5-5[1m]` unchanged. Record an account or CLI rejection of that id as an external limitation
- [ ] In the reader pane, choose an effort such as `high` next to the model picker and click Save; confirm the header chip shows it, the settings `Claude effort` field shows `high`, the choice survives a pane refresh, and the launched command includes `--effort high`
- [ ] Return the effort to `default effort` and confirm the launched command has no `--effort`; set an unsupported value such as `turbo` through the Config Editor and confirm the settings select shows it as not recognized and the run uses the CLI default
- [ ] With a Claude CLI or wrapper whose `--help` does not list `--effort`, save an effort and confirm the run still succeeds without the flag

## 6. Claude Code flow

- [ ] Enter a question in Claude Code mode
- [ ] Confirm a local `claude -p` run starts successfully
- [ ] Confirm output updates in pane and session metadata persists
- [ ] Send a follow-up question and confirm resume/session continuity works
- [ ] Verify invalid executable path or missing CLI state surfaces a clear error
- [ ] Verify the permission mode chosen in the settings select applies to chat runs

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
- [ ] Switch between Claude Code and Codex CLI and confirm previous threads do not mix
- [ ] With session history saved by an earlier build that used Gemini CLI (Gemini turns, last mode, and resume id), open it from `Past sessions`; confirm the transcript loads without a corrupt-file quarantine, only Codex CLI and Claude Code are offered, and a follow-up runs through the selected engine without attempting a Gemini resume
- [ ] Open a Research Workspace project whose saved artifacts record Gemini CLI lineage and confirm those artifacts still load and validate
- [ ] Open a second paper and confirm context/session state does not leak from the first
- [ ] For each engine, send two visible chat turns, run one Workbench action, then send another chat turn; confirm the final turn resumes the visible chat context and never the hidden workflow
- [ ] Confirm the chat, analysis, and discovery runs use distinct workspace folders and hidden completion does not change the saved provider resume id
- [ ] Inspect an analysis run for each engine: Codex uses a read-only sandbox without search, and Claude uses plan permission mode
- [ ] On a fresh profile with no custom workspace root, confirm workspaces are created below `Zotero.getTempDirectory()/paperpilot-workspaces`, not shared `/tmp/zotero-paper-ai`
- [ ] Set each CLI path to an npm/nvm shim outside the fixed system PATH and confirm Codex and Claude can resolve the shim's `node`
- [ ] Configure non-default Codex sandbox and approval modes, send a follow-up turn, and confirm the resumed command retains both modes
- [ ] Edit and tab through every preferences field, including selects, the Session history radio group, and the Advanced retrieval disclosure; confirm no modal alert appears on change
- [ ] Turn off local history while workspace auto-clean is off; complete a run and confirm its workspace is still removed
- [ ] With current Codex/Claude CLIs, run one structured Workbench action and confirm native schema output succeeds; with a wrapper whose help omits the schema flag, confirm the same action succeeds through parser-only fallback

## 9. Verified discovery / Critical Read / auto-highlight checks

- [ ] Start Auto Highlight in a detached reader for paper A while the main window selects paper B; confirm only A supplies text, geometry and annotations. Repeat for a parent item with a second PDF attachment open
- [ ] Cancel Auto Highlight during delayed workspace preparation; confirm no late provider starts, a replacement remains blocked until cleanup settles, and an unconfirmed stop retains ownership
- [ ] Open a saved Research Workspace evidence link after changing or removing the source PDF; confirm a missing quote fails visibly. With an unchanged quote, confirm navigation uses the currently matched passage rectangles
- [ ] Ask auto-highlight to process a short residue such as `Δ = 0.5` and a quote repeated twice; confirm neither produces an annotation
- [ ] Auto-highlight one sufficiently long Greek quote and one sufficiently long CJK quote; confirm each lands on the unique exact passage

### Selection chat startup and Stop runtime record — 2026-09-05

In the installed Zotero add-on, the error console reproduced
`ReferenceError: structuredClone is not defined` in both the cold and cached
session-index reads before any model process started. A regression test without
that API fails on the previous implementation and passes with the index-copy fix.

With the candidate XPI installed, native accessibility inspection confirmed a
real selection Explain using the configured Codex CLI produced a Korean answer
and reached Completed at 0:36. A follow-up switched Send to Stop, disabled the
input, and displayed Waiting for answer. Clicking Stop reached Cancelled at
0:10 and restored the input and Send. This is one local runtime observation,
not a latency benchmark or proof across all engines. Automated checks cover
pre-controller cancellation ownership and terminal elapsed-time stability.

The user confirmed that the installed popup buttons are visually distinct.
Screenshot capture returned a blank image in this environment; dark-theme
contrast and keyboard focus still require visual QA.

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
append; full Codex and Claude send/complete checks remain in the manual matrix
above.

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
discovery through Claude Code were not available in this delivery
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
Windows/Linux, Claude Code engine passes, the two-paper visual
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

### Reader pane UX review — 2026-10-20

- [ ] Paper Mastery: submit an answer and confirm your answer, the feedback, and (for a missed topic) the explanation stay visible while the status reads `Round N: … Preparing the next question…`; they stay after the question is ready until you click **Next question**, which then shows the new question and focuses the answer box
- [ ] Paper Mastery: answer the last round and confirm the completion card shows `Understood X of Y questions`, the last round's result stays below it, and the metrics line says `Average rubric score`
- [ ] Paper Mastery: type an answer, switch to another reader tab and back, and confirm the draft and confidence are kept; press Ctrl+Enter (Cmd+Enter on macOS) and confirm it submits; with an empty answer, confirm Submit is disabled with a tooltip
- [ ] Paper Mastery: cancel the first-question run and the evaluation run, then trigger a pane re-render; confirm the status keeps `…Click Paper Mastery to try again` or `Your answer was not graded…` instead of a stale `Generating…`/`Evaluating…`
- [ ] Paper Mastery: on first use for a paper, click **Paper Mastery** and confirm it shows `Preparing paper…` and ignores repeat clicks; while a chat answer runs, confirm Paper Mastery, Submit Answer, and End Session (with answered rounds) are disabled with the reason in their tooltip
- [ ] Critical Read: confirm `Start Critical Read` shows `Preparing paper…` during extraction, a finished step opens its result, `Run step N` is disabled with a tooltip while a chat answer runs, and a double-click on `Save report to note` creates one note
- [ ] Workbench: double-click `Save latest to note` and `Save for collection` and confirm one note each; dismiss the collection picker and confirm no failure status appears; after a collection save, confirm the status names the collection; confirm the picker title says `Save Workbench cards to collection`
- [ ] While a chat answer runs, confirm `Highlight key passages` and `Find verified prior work` are disabled with the reason as tooltip (and as the inline note under the prior-work button)
- [ ] While review insights run for one prior-work paper, confirm the other papers' `Review insights` buttons are disabled with `Wait for the current review analysis to finish.`, and the top `Cancel review insights` click shows `Cancelling…` at once
- [ ] While Paper Pilot finishes a task that Stop cannot cancel, confirm the composer placeholder does not mention Stop; hover a truncated session title in Past sessions and confirm the full name appears
- [ ] Press Stop, open Login help on a failed run, and try to switch engines or sessions during a run; confirm each notice appears under the composer, not as an assistant bubble, and a later run event does not erase the transcript around it
- [ ] Click **Summarize chat** after a grounded answer; confirm a Conversation summary panel shows the Markdown summary with a Close button, and a failed summary reports its reason in the tools status
- [ ] With the pane open, select a passage in the PDF and send a question; confirm the request uses that passage. Insert `/explain` with no selection and confirm the status asks for a passage
- [ ] Restore a long draft (session switch, failed send) and confirm the composer grows to show it; confirm Send is disabled while the composer is empty
- [ ] Fail a run with raw logs; confirm Retry and Dismiss sit above **Raw logs**, and pressing Dismiss or Retry by keyboard leaves focus in the card or on the composer. During a Mastery or Workbench run, confirm the card does not say the answer appears in chat
- [ ] While a chat answer runs, right-click an annotation and choose **Ask about annotation**; confirm the pane shows why nothing started
- [ ] Arm **Explain figure or table**; confirm a notice over the PDF says what to do, it disappears when the area is drawn or Esc is pressed, and after two minutes a notice says the mode ended. Confirm the dictionary window label reads `Naver Dictionary` (Korean UI: `네이버 사전`)
- [ ] Critical Read: in Claude Code mode, confirm Step 3's button is disabled with the prior-work reason shown in the step card; confirm Cancel appears next to `Working…` and shows `Cancelling Critical Read step…`; revise Step 2 after completing Step 7 and confirm the dialog names Step 7, and the reopened step shows its `Reopened:` reason; confirm Step 1 lists each caption once and a rejected step output says to run it again
- [ ] Prior-work results: open a paper's review insights, then trigger a rebuild (another row action or a run event) and confirm the insight stays open and the focused button keeps focus; confirm a paper without official evidence shows a `No official evidence` chip and a failing row action shows its error inside that row
- [ ] Past sessions: open the ⋯ menu with the keyboard; confirm focus moves to Rename, arrow keys move between items, Escape returns to ⋯, and the menu stays open across a run event. Make a rename or delete fail (for example, read-only profile) and confirm the error appears at the top of Past sessions; confirm Save is disabled for an empty name
- [ ] Workbench cards show readable evidence chips (`Paper-grounded`, `Inference`, `Mixed`) with full descriptions on hover; new Contributions, Limitations, and Follow-up work cards use those titles; the save buttons explain what they save on hover
- [ ] Paper Mastery: submit an answer, switch to another reader tab and back while grading or the next question runs, and confirm the result still stays until **Next question**; switch tabs during `Preparing paper…` and confirm a second click does not start a second preparation
- [ ] Paper Mastery: while a chat answer runs, trigger Start from the Critical Read report, End Session with answered rounds, and **Generate final report**; confirm each explains in the composer hint that it could not start, and that the typed answer or failure reason is kept
- [ ] Paper Mastery: save a session while the next question is being generated (quit Zotero or switch sessions), reopen it, and confirm it shows as ended with **Generate final report**, not the graded question again; end a session with no answered rounds, reopen it, and confirm Mastery stays closed
- [ ] Paper Mastery: make the final report fail and confirm **Generate final report** retries it; make the next-question run fail and confirm the card says `Session ended` with the reason; type an answer and click End Session and confirm it asks before discarding the draft

## 10. Compare / reusable artifact checks

- [ ] `Compare` stays disabled before recommendations exist, then becomes enabled with a compact ready count once related papers are available
- [ ] Multi-paper compare flow launches from the current paper plus a bounded recommended-paper set rather than an unbounded picker
- [ ] First compare flow stays capped to the current paper plus at most 2-3 peer papers
- [ ] Compare output remains compact and clearly tied to the selected papers
- [ ] Compare surface avoids wide tables or layouts that crowd the existing workbench/recommendation/chat areas
- [ ] `Save for collection` preserves reusable artifact content with traceable source paper context

## 11. Cross-engine discovery checks

- [ ] Repeat discovery and Critical Read smoke checks with Codex CLI and Claude Code
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
- [ ] Select at least two library papers and build an Evidence Matrix and Relationship Graph; confirm persisted coverage and graph integrity, then create and grade a cross-paper mastery question
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

## 14. UX review fixes (2026-10-09)

Run these in Zotero 7 and 10, in light and dark themes, with the pane about
380px wide.

### Chat and run feedback

- [ ] Send a question; confirm the "Starting…"/"Running…" answer bubble stays visible with partial text until the final answer replaces it
- [ ] Scroll the transcript up during a run; confirm the composer keeps focus and "New response · Jump to latest" appears over the bottom of the transcript when the answer lands
- [ ] Rename a past session while a run is active; confirm the typed text and caret survive, Enter saves, and Escape cancels
- [ ] Type a research concern during a run; confirm the text stays after the run settles
- [ ] Confirm a Completed run card closes after about six seconds, a Failed card offers Dismiss, and switching to another session hides the Failed card until you return
- [ ] Type a draft taller than 180px; confirm the caret stays visible while typing at the end
- [ ] Double-click Send; confirm the request is not cancelled. Press Enter during a run and confirm the composer hint appears
- [ ] Type `/su`, `/`, and `/foo`, then press Enter; confirm filtering, command selection, and the "Unknown command" notice. Confirm Korean and Japanese input-method composition still works
- [ ] While "New response · Jump to latest" shows, complete a Critical Read step; confirm the prompt stays. Start a new session; confirm the prompt disappears
- [ ] Tab to Dismiss on a Failed run card, then let another run event arrive; confirm focus stays on Dismiss

### Controls

- [ ] Send a chat; confirm Workbench actions and Compare are disabled with a reason and return afterwards
- [ ] On Claude Code, or Codex with web search off, confirm all three "Find prior work" entry points are disabled with the reason and the Compare helper text changes
- [ ] Click a card's "Find prior work" while discovery runs; confirm "already running" appears and the search continues
- [ ] Cancel highlighting part-way; confirm no annotations remain from the cancelled run, including highlights saved before the cancel
- [ ] Pick a model in the engine popover, then tick "Allow web search when needed" or click Re-check; confirm the pick and the enabled Save stay
- [ ] With Codex selected, turn web search off in Zotero Settings; confirm "Find prior work" turns disabled with its reason without reopening the paper
- [ ] Confirm the engine buttons show the pressed engine, the reset reads "Use default (…)", and it is disabled without an override
- [ ] Change the model and close the popover without saving; confirm the selection reverts. Confirm Save closes the popover, returns focus to the trigger, and a screen reader announces "Default model saved for all papers."; an effort-only change (Claude or Codex) enables Save
- [ ] With Codex ready, confirm the auth buttons are hidden; with login required, confirm the instructions appear inside the popover
- [ ] Clear cards, confirm the prompt, then reopen the session and confirm the cards stay cleared
- [ ] With a screen reader, confirm "Focus chat" is announced with its pressed state
- [ ] Confirm the draft card shows the attachment title instead of an internal ID

### Visual system and accessibility

- [ ] Confirm every status color, primary-button state, and focus ring is readable in both themes, and the focus ring shows in Windows High Contrast mode
- [ ] With reduced motion on, confirm the streaming dots and the current mastery dot do not move
- [ ] Collapse all sections after a manual resize; confirm no gap remains and expanding a section restores its size
- [ ] Confirm Retry stays visible while the run card scrolls
- [ ] Confirm inline citation chips keep the line height, an unverified chip is reachable by Tab, and Enter shows its notice
- [ ] Confirm wide inline math and wide tables scroll sideways, including in Mastery cards
- [ ] Confirm Mastery dots have 24px targets with visible selected and focus rings
- [ ] Open chat search and a save preview together; confirm the transcript keeps at least 96px
- [ ] Confirm an annotation warning shows first in the context status, and the one-line details show the full text in a tooltip

### Chat controls

- [ ] Hover each ghost button on the light pane; confirm a visible tint appears. Before this fix, the hover color matched the pane
- [ ] Confirm the toolbar chips and the response-length select share one pill shape, and the select still shows its arrow and opens its list
- [ ] Open "/ Actions"; confirm it turns accent, the commands open as a card, and the Enter target is the accent chip
- [ ] Start a run; confirm Send turns into a neutral "Stop" with a square mark, and that typed text never runs under Send, Stop, or "Stopping…"
- [ ] Confirm "More" shows a chevron instead of the default triangle, the open menu is a card, and its rows tint on hover
- [ ] Click Copy; confirm "Copied!" turns green and resets after about 1.5 seconds
- [ ] Confirm "New response · Jump to latest" floats as a pill over the transcript without moving the composer
- [ ] At a 320px pane width, confirm no pill label wraps onto two lines

### Settings

- [ ] Confirm help text is readable in dark mode and `preferences.css` loads on Zotero 7 and 10
- [ ] Toggle Advanced retrieval from the keyboard; set overlap above half the chunk size through the Config Editor and confirm the group opens with a warning
- [ ] Confirm each Session history choice survives a restart and maps to the same saved-history behavior as before
- [ ] Set legacy spellings such as `acceptedits` or `workspace write` through the Config Editor; confirm settings rewrite them to the canonical value
- [ ] Confirm the Workspace group shows the configured root and that both engines use it

### Research Workspace and Critical Read

- [ ] Confirm an unsent Critical Read answer survives a status update and a step-3 search
- [ ] Close the project window during a run; confirm the prompt appears and Cancel keeps the window open. Confirm Check now during an Evidence Matrix run keeps the run going
- [ ] Relaunch the window with a new library selection; confirm the banner's Use and Add paths
- [ ] While an analysis runs, choose the banner's Add path; confirm the add is refused with a message and the run continues
- [ ] Relaunch from the library while the window is still opening; confirm the selection banner appears once the window is ready
- [ ] Archive a project, then restore it from Archived projects
- [ ] Force a partial Evidence Matrix; confirm Failed cells, paper titles in progress text, and Resume
- [ ] Open Critical Read from the window while the pane is in Focus chat mode; confirm the Workbench expands and the panel scrolls into view
- [ ] Click New session with Critical Read progress in each history mode; confirm the prompt says whether the work moves to Past sessions or is lost
- [ ] Add a discovery result to a collection; confirm the lanes keep their open state
- [ ] With a screen reader, confirm the window announces only the short status, not the whole matrix

## 15. Codebase audit fixes (2026-10-24)

These need real Zotero. Run them in Zotero 7 and 10 where the item says so.

### Reader pane and chat

- [ ] Open a PDF in a standalone reader window (not a tab); confirm the selection popup actions and the annotation menu items are disabled and say to open the PDF in a Zotero tab. The dictionary still works
- [ ] In an EPUB or web-snapshot reader, confirm only the dictionary button appears in the selection popup
- [ ] Close the item pane in a reader tab, click Explain, wait more than two minutes, then open the pane; confirm no run starts and the composer explains that the action expired
- [ ] With a screen reader, ask a question; confirm the streaming answer is announced once when it finishes, not on every update
- [ ] Pin a message; confirm the menu then offers "Unpin" and the message shows a "Pinned" marker. Confirm "Save to note" is offered only on finished answers
- [ ] Open chat search; confirm typing does not announce every result, a short count is announced, and Escape on a review panel returns focus to the composer
- [ ] Open two reader tabs for different papers; confirm each tab's engine popover and section toggles control their own pane
- [ ] Scroll the transcript up until "Jump to latest" appears, then scroll back to the bottom; confirm the prompt disappears
- [ ] Press Arrow keys on a section resize handle; confirm each step changes the height by the same amount in both directions
- [ ] Tab out of the open engine popover; confirm it closes
- [ ] Open Past sessions, Delete a session and cancel; confirm focus returns to its ⋯ button. Open a session; confirm focus lands in the composer
- [ ] Click Explain in the dictionary or figure window from a reader iframe several times; confirm Zotero does not crash

### Critical Read, Mastery, and figures

- [ ] Complete Critical Read steps; confirm each completed card lists Source locations and Limits and uncertainty, and the report nests labelled lists under their labels
- [ ] Press Run, Revise, or a step summary, then let a status update arrive; confirm keyboard focus stays on the same control (Run hands focus to Cancel)
- [ ] Save the report to a note, delete the note, then reopen the paper; confirm "Save report to note" is enabled again
- [ ] During Paper Mastery, choose "Resume Paper Mastery"; confirm the section scrolls into view with focus on the answer box or Next question
- [ ] Arm the figure tool, click into the PDF page, and press Escape; confirm the tool is cancelled
- [ ] Close the figure window during a run and explain again at once; confirm the new run waits instead of failing with "already active"

### Discovery and engines

- [ ] Turn on a system proxy (or Charles/ClashX); run verified discovery and confirm failures name the proxy instead of a non-public address
- [ ] Search for an author with an accented name; confirm the accented and ASCII spellings of the same paper merge and an existing library item is found
- [ ] Edit the PDF during a Codex and a Claude chat run; confirm the run card reports the changed PDF, not a sign-in problem

### Research Workspace

- [ ] Select a paper in the library; confirm the Research Workspace section shows "Prepare paper" and does not start extraction until clicked
- [ ] In a reader tab of a parent with several PDFs, confirm the section uses the open PDF
- [ ] Corrupt `change-inbox.json` for a project; confirm the project still opens and only Living Review shows a warning
- [ ] Save reading progress, then record a screening decision without reopening the project; confirm the decision saves
- [ ] Run Evidence Matrix while the first paper chats in the reader; confirm the other rows still run and the progress line names each paper
- [ ] Finish an analysis in a project; confirm prerequisite-gated panels (for example Contradictions) enable without reopening, and typed panel text survives
- [ ] In a read-only group library, confirm sync preview marks items blocked and Auto Highlight refuses before starting
- [ ] Sync with a subcollection target; confirm it is listed as "Parent / Child"
- [ ] Rename a project to `analysis.tmp`, export it, restart Zotero; confirm the export files remain

## 16. Research Workspace entry and Studio start (2026-10-24)

Run in Zotero 7 and 10, light and dark, at the default window size and at a
narrow width.

- Select three papers with PDFs and one item without a PDF. Right-click →
  **Open Research Workspace…**. Confirm **Selected in Zotero** lists the three
  titles and a collapsed "1 selected item was skipped" with a plain reason.
  No PDF extraction runs before a button is chosen.
- Choose **Create project with 3 papers**. Confirm the progress line, then the
  project opening on **Analyze** with the analysis tools for three papers and
  **Compare and synthesize papers** open first.
- Repeat with **Add to a project**. Confirm the chosen project opens with the
  added papers in the tools, and a PDF that fails to load is reported as left out.
- From the Tools menu with nothing selected, confirm the first-run guide when no
  project exists, and **Your projects** first otherwise. **Use Zotero selection**
  with nothing selected shows an error banner.
- With the window open on a project, select a different paper in Zotero and
  launch again. The window moves to that selection, lists any project that
  already holds it with **Open**, and preselects the previous project under
  **Add to a project**. Launch with a paper the open project already holds; the
  project stays and says so. Repeat while an analysis runs and after typing a
  screening reason; both keep the view and show the offer banner.
- Shrink the window below the home's height. Scroll with the mouse wheel and the
  trackpad to **Your projects**, **Open Studio**, and the guide. Repeat on a
  project's **Analyze** tab with tools loaded. The header stays in place, and
  the body scrolls without Tab focus.
- Install a new build from the Add-ons window without restarting Zotero. Open
  the workspace again; it uses the new build's styles, so the body scrolls.
- Check the window design in light and dark with no network. Titles, project
  names, and paper titles use the bundled serif. The highlighter marks only the
  papers selected in Zotero and the open tab, and switching tabs draws it. With
  Reduce motion on, the mark appears without motion. In Windows high contrast,
  the open tab and selected titles are underlined instead.
- Open Studio on a project without documents. The title uses the same serif,
  and the six ways to start form a two-column list.
- Choose **Open** under "already in" and, while the PDF is read, choose
  **Open Studio** on a card. The status line says which action is still
  running, and the pointer shows progress over the other buttons.
- Switch tabs with the mouse and with ←/→/Home/End. Run Evidence Matrix, then
  switch to **Results** and back; the run, its status, and its output remain.
  A refresh after the run keeps the open tab and typed screening reasons.
- Rerun a stale contradiction dashboard from **Results**; the **Checks** tab
  opens and the matching button runs.
- In a multi-paper analysis, change **Paper for single-paper tools**; the
  single-paper section and search name the chosen paper. The chooser is
  disabled while a tool runs.
- Choose **Open Studio** on a home project card and in a project header.
  Confirm one window per project and the six start cards. **Write a draft**,
  **Analyze data**, and **Plan the work** open the new-document dialog with
  DOCX, notebook, and board selected. **Cite your papers** and **Ask the
  assistant** open their panels.

## Session history and silent-turn QA (2026-04-16)

After running mastery and one or more workbench tools (research brief, contributions, limitations, follow-ups, paper compare) on a paper, then opening "Past sessions":

- The session list stays inside the bounded `Past sessions` disclosure body and scrolls internally instead of pushing the composer away.
- The disclosure opens and closes with mouse, Enter, and Space while preserving its expanded state.
- Each row is a single line: title (with optional Current / cards-saved badges), meta line, an Open button, and a kebab (⋯) button. Rename and Delete live inside the kebab menu.
- Delete and Delete all show a confirmation dialog. Cancel keeps the data.
- Reopening a session that previously ran mastery / workbench tools shows the natural chat transcript in the message list (prose markdown), with NO raw JSON lines.
- Mastery cards, workbench cards, and recommendation groups still rehydrate when the session is reopened (existing behavior).
- After opening a saved session, sending a fresh chat message continues to work end-to-end with Codex CLI and Claude Code.

## Analysis consistency and model provenance

- Limit `codexAllowedModels` to `gpt-5.6-luna`, leave the saved default at another
  model, and reopen the picker. Only Luna and its supported reasoning levels should
  appear; a new run should use Luna. An obsolete-only list should fall back to the
  current catalog. Restore the original preference afterward.
- Switch Codex → Claude after saving each model. Recent models must remain scoped
  to their provider.
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

- With Critical Read open on Step 1, switch between Korean, Chinese, and English.
  Check the seven-step heading, ready status, step title, instruction, assessment
  checklist, extraction notice, and input placeholder immediately use the selected
  language without starting an AI run. Feature names and action buttons such as
  `Critical Read`, `Run step 1`, and `Save report to note` must stay in English.
  Type an unsent assessment before switching; the text and run-button availability
  must survive the switch. Original abstract, captions, and locators stay verbatim.
- Repeat with restored sessions, all seven steps, a running step, a revised step,
  and a completed report. Check completed counts remain unchanged by language
  changes, completed cards and revision dialogs use the selected language, and
  original reader/model prose is preserved. Save a report to a test note and check
  its headings use the selected language. Existing notes must remain untouched.

## Chat and project intake release checks

Record Zotero/OS/CLI versions and the installed XPI hash; a successful Node test or ZIP build is not a completed checkbox below.

- [ ] With one parent and two PDFs, select the second PDF, Ask AI, rename the chat, and ask two follow-ups. Inspect metadata and citations: the same second attachment and paper title remain fixed.
- [ ] Select text or multiple annotations, inspect/remove context, and use Ask AI without losing an existing draft. Try deleted annotations, comments, image annotations and a replaced PDF.
- [ ] During preparation, output, Stop and cleanup, type draft B while request A runs. A's failure/cancellation never deletes B. Quick actions and Mastery/Critical Read never replace the composer text.
- [ ] In Codex and Claude, capture the actual provider session ID for a first request and resume it for two follow-ups. If no ID is emitted, show fresh-session fallback and include eligible continuity. An external CLI authentication failure is recorded separately.
- [ ] Retry the same failed turn repeatedly; one user question has numbered attempts. Edit branches before the selected question, fork branches through a completed answer, and the original session/provider binding remains isolated.
- [ ] Search a 200-message current conversation and saved conversations for this paper. Jump outside the visible window and return to the original reading anchor. Scroll up/select/copy while a response updates; only an explicit jump resumes following.
- [ ] Exercise Focus chat, slash actions, response length, keyboard/IME, Escape and visible focus at 320/420/640 px, 200% zoom, light/dark, long Korean, math, tables and code.
- [ ] Verify a supported citation, changed PDF, missing PDF and wrong source. Only a locally matched, current source opens its exact page. Public URLs open only on click; local/privileged schemes remain inert.
- [ ] Pin/unpin user and assistant messages, create a summary, switch engine, and confirm displayed included/omitted context. Repeat with full/prompts-only/off history and inspect newly persisted files for assistant-derived leakage.
- [ ] Preview a chat note under its original parent and save once. Preview/edit a comparison question and destination project; saving does not start a model run.
- [ ] Save a discovery candidate without a PDF, reopen the project with no selected item, link an existing parent, select an exact PDF, and make an inclusion decision. Keep screening separate from reading/understanding. Export/recover/delete the candidate with its project.
- [ ] Run from saved members, change question/columns/protocol, exclude a member or replace an upstream artifact, then retry/reuse. Changed semantic inputs cannot produce a false current checkpoint. Reading progress alone does not invalidate analysis.
- [ ] Keep workspace auto-clean off and run A+B then A-only. Inspect actual files and prompt: B's owned inputs disappear before spawn; unrelated user files survive.
- [ ] In a disposable chat workspace, place an unowned file at a planned input/runtime path, then prepare the next run. Confirm preparation fails before launch, the file survives, and Raw logs identifies the file and workspace. Move it or start a new conversation and confirm chat can continue. Repeat with an externally edited owned input.
- [ ] In a disposable profile, raise a paper's history index `storageVersion` above the supported version, both before and after its index is cached. Attempt save, rename and deletion; confirm an actionable error and unchanged index/snapshot files. Do not alter real conversation history for this check.

See [the evaluation report](./chat-context-evaluation.md) for the synthetic model sample and [the implementation record](./paperpilot-product-review-and-chat-spec.md) for executed checks and environment limits.

### Native chat regression checks

- [ ] Ask each provider for an answer containing LaTeX commands and verify rendered equations and saved/reopened text. Supply an unrecoverable chat envelope through a disposable response fixture; confirm a failed turn with Retry guidance, no empty completed answer, and invalidated native resume state.
- [ ] Match a new answer's exact quote and click its citation. Confirm the correct page opens and normal Reader navigation still works after extraction cleanup.
- [ ] Verify exact-file extraction with no PDF reader open and with a different PDF visible. Never use the live Reader's cached text as evidence for another file.
- [ ] Save an older answer after version-only attachment drift with identical file size, mtime and dateModified. Changed or unavailable PDF metadata and rebound identities must still reject the snapshot.
- [ ] Search wrapped Korean and long unbroken text in a narrow pane. Confirm result buttons grow, remain separated, scroll, and can be activated using the keyboard.

See the [native repair specification](./chat-runtime-followup-spec.md) for the observed v0.1.5 failures, acceptance criteria and runtime coverage.

## Research Studio verification

This surface is under implementation. Browser preview, native Zotero, actual Word,
model providers and kernel languages are separate evidence layers.

- Open an existing project → **Open Studio** twice; confirm a single window and
  project isolation. Close/reopen while an AI cancellation is finishing.
- Import DOCX with tables, images, comments, tracked changes, headers/footers and
  citations. Edit, save, reopen and export; compare in Word, including formatting
  and untouched XML relationships. Do not call the conversion lossless from text
  matching alone. Check the toolbar with Assistant open and a narrow window.
- Edit during saving, navigate, rename, archive/restore and restore an old version.
  A failed save must retain the draft; stale revisions must fail visibly.
- Select context files, ask the project assistant, inspect its captured revisions,
  apply/reject proposals, reload and inspect history. Repeat an apply after a
  storage failure and confirm only one new document version. Test a manual edit
  made after proposal generation. Confirm keys never enter persisted project files.
- Exercise Codex, Claude and a local endpoint independently. Stop a
  run, close its window, and verify the process/request stops. Unknown models and
  missing capabilities must fail without fallback or hidden retries.
- Run two Python notebook cells sharing a variable, render a figure, save it as a
  project file, export IPYNB and reopen in Jupyter. Repeat with an installed R
  kernel. Test errors, infinite-loop interrupt, restart and project isolation.
- Test CSV quoted newlines/leading zeros, TSV, typed JSONL, malformed input and
  invalid edits across pages. Unsupported formats must remain exportable.

Recorded local evidence on 2026-10-22: packaged browser DOCX editing and export;
actual Codex proposal/review/apply with bold runs and an existing tracked insertion
retained in exported XML; persistent Python cells, Matplotlib output, PNG save and
IPYNB export; Python worker interrupt/recovery integration. Actual Word, R,
Claude and local-model inference remain unverified.

Additional Studio checks:

- Build saved `.tex`, `.typ`, and MyST Markdown documents. Verify the source
  revision in the report, separate output PDF, compiler error logs and cancel.
  Test missing executables and a build while the source is edited. Compilers may
  download packages/templates; test offline separately with dependencies cached.
- Open a two-page built PDF, navigate pages and read extracted page text. Verify
  the packaged worker loads in Zotero's sandbox as well as the browser harness.
- Open an imported DOCX with tracked changes without editing; revision must stay
  unchanged. Then edit/comment, save and confirm the new change is retained.
- Add/delete data rows and columns while sorted/filtered. Invalid JSON edits must
  remain visible and block save even after paging or removing another row.
- Back up documents including archived files and multiple versions. Restore into
  an empty project. Confirm occupied projects and bad checksums reject without
  overwriting data. Evidence records and conversations are outside this backup.
- Archive/resume an AI conversation. Preserve the conversation being replaced,
  and reject proposals whose target revision changed since their original turn.
- Import manual Unicode BibTeX and insert APA text. Native Zotero snapshots and
  installed CSL styles require separate native validation. Insert Word citation
  fields from multiple files, repeat and reorder sources, then refresh with APA
  and Vancouver. Reopen/export and verify fields and bibliography sources in Word.
  Numeric text snapshots remain independent of the Word-field workflow.

Additional browser evidence on 2026-10-22: local Typst 0.15.1, Tectonic 0.17.0 and
MyST 1.11.0 produced PDFs from saved Studio sources. Bundled PDF.js rendered two
pages with extracted text. Opening a tracked-change DOCX no longer causes a new
version. Manual Unicode BibTeX/APA insertion and Kanban document links were
exercised. The latest bundle restore and data-column UI still need runtime QA.

Additional evidence on 2026-10-23 in a separate Zotero QA profile: native DOCX
create/edit/save/reopen with bold text; Typst compilation to a two-page PDF;
packaged PDF worker completion and page text; local OpenDataLoader extraction
followed by a real Codex answer citing the second page; conversation archive and
resume; Python execution, HTML-table-to-CSV export and table insertion into DOCX.
Saved DOCX XML contains the table and retained formatting. Native Studio screen
captures are white despite functioning accessibility controls and saved outputs;
actual visual painting remains unresolved and is not counted as passed.

Browser evidence on 2026-10-23: saved notebook PNG embedded in DOCX and visible
after copying through a custom template; Word citation and bibliography fields
survive reopening and refresh from APA to Vancouver. Exported DOCX contains
`CITATION`, `BIBLIOGRAPHY` and bibliography custom XML. This is structural/browser
proof; actual Microsoft Word refresh and rendering remain separate checks.

- Back up a local project with active/archived conversations and research records.
  Restore into a new project, resume imported history and inspect historical
  evidence. Confirm existing project files/history block restoration, source
  bindings are not created implicitly, and failed writes do not publish context.
- Run a cell using `clear_output(wait=True)`, update a display handle in the same
  and a later cell, export IPYNB, and verify only final outputs are persisted.
  Edit/run/undo a cell and confirm its source editor retains undo history.
- Create from each starter template; save/reuse a custom DOCX template with a
  figure, table, comment and tracked insertion. Verify originals stay unchanged.

Additional evidence on 2026-10-23: Ollama qwen3:8b answered from the selected
Typst document through the Studio loopback path. Claude Code started but reported
the account's session limit, so a successful Claude workload is not verified.
Browser CSV row/column add/remove, sort/filter and source view preserved `001`
and original row order. Python cell execution retained CodeMirror undo history.
DOCX comments were saved, reopened and found in `word/comments.xml`. Selection
events are excluded from autosave mutations.

MyST template reuse passed an actual warm build followed by a fresh build under
macOS `sandbox-exec` network denial. Only the owning project's templates were
reused; other project files were freshly snapshotted. Runtime installation and
additional packages/assets still determine whether a particular document builds
offline. The latest native app/Word attempts could not obtain a native window
from the UI tool, and browser restore file chooser detection also failed. These
are unverified UI gates, not passing results.

Studio follow-up checks (2026-10-23):

- Insert footnote 1 and endnote 1, edit only the endnote, save and reopen. Remove
  the endnote and verify that the footnote remains. Inspect both the document
  reference elements and note-body XML. Browser and OOXML checks passed.
- Insert a figure caption and caption list, refresh, save and reopen. Verify
  `SEQ Figure` and `TOC \c "Figure"` instructions and matching rendered text.
  Browser and OOXML checks passed; caption-list page numbers are omitted.
- Edit a pending AI replacement, apply and reopen. Verify the saved file uses the
  reviewed wording and conversation history retains the original model wording.
- Save a notebook figure/table after an actual run. Inspect its code/run/input
  receipt; rerun its source cell and confirm the old output is flagged for review.
  Repeat after code/input changes and after bundle export/restore. Editing a saved
  output manually must not inherit its original execution claim.
- Rename a linked image and move a Markdown/TeX/Typst draft. Check references and
  old versions, failed atomic publication, stale editors and the project graph.
  Dynamic code paths and arbitrary binary links are outside automatic repair.
- Import Zotero reference snapshots and open a supporting passage. Reject stale,
  excluded, unavailable, mismatched or historical-only sources. Native passage
  navigation in Studio remains a separate runtime gate.

Further browser evidence on 2026-10-23: Ollama `qwen3:8b` proposed a Markdown
replacement; the review textarea changed the wording before Apply, the saved
file used the reviewed text, and original model wording remained in history.
A real Python run produced a saved figure with code/session/input hashes. The
inspector first matched current inputs, then flagged a source rerun. Inserting
that figure into DOCX persisted an insertion receipt; the draft's insertion
history reached the same stale execution record. Renaming the figure updated a
linked Markdown file and its graph endpoint. Selecting an imported DOCX comment
did not advance revision 15. PDF.js 5.4.624 rendered and extracted both pages after
the worker was packaged as a classic script for the opaque browser sandbox.

Native capture/control remains blocked by the computer-use service reporting no
available QA window. Actual Word round-trip, native final-build visual QA,
Studio reference-to-PDF navigation and R execution remain unverified. Claude's
workload remains blocked by its account session limit. Browser bundle restoration
remains blocked by the extension's file-upload setting; repository restore tests
are not reported as a successful UI restore.

Studio navigation and editing ergonomics:

- Start without an active file: show a useful empty state, with no disabled document toolbar.
- Search by filename or folder, clear the search, and toggle archived files. Long names
  stay on one line while the full path remains available to accessibility and hover.
- Create a Markdown file without typing its extension, save with Cmd/Ctrl+S, rename
  through More, and reopen. A duplicate-name error stays in the creation dialog.
- Open DOCX with Assistant: formatting tools adapt to the actual editor width.
  Open Insert & review for comments, output insertion, notes and contents.
- Switch Assistant to References and back: only one panel is visible; an unsent
  question and unsubmitted proposal edits survive closing/reopening the assistant.
- Escape closes the focused side panel and returns focus to its header button.
  More and History also support keyboard dismissal. Cmd/Ctrl+P focuses file search;
  Hide files makes more room without closing or reloading the editor.
- At 900px and 720px widths, verify toolbar/menu access, the panel close control,
  document scrolling and saved-state visibility. Repeat in native Zotero; browser
  checks do not establish native rendering or screen-reader compliance.

Studio UX browser checks on 2026-10-23: format selection and extension completion,
Markdown create/edit/save, filename/path search, rename/move, DOCX container-sized
toolbar, mutually exclusive panels, close-button focus return, and 900px/720px
layouts were exercised. Keyboard shortcut validation remains incomplete: browser
automation did not deliver keydown events into the sandboxed frame, and the native
browser was in active use. Do not treat an autosave after attempted Cmd+S as proof
of the shortcut. Native final-build Studio painting remains a separate gate.

PR review regression checks:

- Move a Markdown draft with relative image links into a folder. Verify the editor
  immediately shows the repaired paths, then edit/save and reopen: repaired paths
  must remain intact. Repeat with a structured document in source view.
- Build a renamed source with another renamed file in the project. Metadata-only
  revisions must not make the immutable build snapshot unavailable.
- Try runtime snapshots with `data.csv` and `Data.csv`, canonically equivalent
  Unicode names, and a file whose name is also another file's parent directory.
  Build/Run must reject ambiguous paths before launch and preserve all originals.
- Press Stop while the first notebook kernel is still starting. The pending cell
  must not execute; a subsequent explicit Run must remain usable. Repeat just
  after Run while the request is queued: Stop must target that request, including
  when a late interrupt arrives after it has completed.
- Switch reference files rapidly while reads are pending. Only the selected file's
  records may become available for insertion.
- Close Studio while project authority is loading for a Build or AI request. No
  new run may begin after the window is disposed.

The Python worker integration suite is a separate CI step:
`python test/studio_kernel_worker_test.py`, using `jupyter-client`, `ipykernel`
and `matplotlib`. Node unit tests alone do not exercise a real kernel process.
