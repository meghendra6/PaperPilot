# Manual QA Checklist

Use this checklist inside a real Zotero 7 runtime before claiming readiness.

## 0. Environment prerequisites

- [ ] The candidate `.xpi` installs successfully in Zotero
- [ ] Java 11+ is installed if OpenDataLoader-backed structured extraction is expected

## 1. Pane rendering

- [ ] Open a PDF attachment in Zotero Reader
- [ ] Confirm AI pane is visible in the reader/item pane area
- [ ] Confirm mode/status/session cards render without errors
- [ ] Trigger `Recommend related papers` and confirm the pane expands enough to show multiple recommendation rows immediately
- [ ] Confirm tall recommendation lists scroll inside the recommendation section without breaking chat history or the input area
- [ ] If roadmap paper-tool controls are present, confirm they do not crowd or overlap the existing mode/session controls
- [ ] If structured brief cards are present, confirm they remain readable without pushing chat input off-screen

## 2. Mode behavior

- [ ] Switch to `Gemini CLI`
- [ ] Confirm Gemini session controls and mode messaging update correctly
- [ ] Switch to `Codex CLI`
- [ ] Confirm Codex run-state card and model controls render
- [ ] Confirm per-paper mode override does not affect another document unexpectedly

## 3. Reader actions

- [ ] Select text in the PDF
- [ ] Confirm selection popup shows AI actions
- [ ] Trigger `Ask AI`
- [ ] Confirm draft/prompt state appears in pane
- [ ] Trigger annotation context menu action
- [ ] Confirm annotation-origin draft appears in pane

## 4. Research brief + paper-tool roadmap checks

- [ ] Trigger the research-brief entry point for the active paper
- [ ] Confirm the workbench shows `Research brief`, `Compare`, `Contributions`, `Limitations`, `Follow-ups`, `Save latest to note`, `Save for collection`, and `Clear cards`
- [ ] Confirm a structured response renders summary, contributions, methods, limitations, follow-up questions, and search-query guidance
- [ ] Confirm any inference/source-aware labels are visibly distinct from direct paper-grounded content
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

## 6. Codex CLI flow

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

## 7. Session correctness

- [ ] Open `Past sessions` and confirm the current paper shows a compact saved-session list
- [ ] Open a saved session and confirm the prior transcript loads into the pane and follow-up turns continue in that same session
- [ ] Rename a saved session from `Past sessions` and confirm the updated title appears immediately
- [ ] Delete one saved session from `Past sessions` and confirm the list and pane state update correctly
- [ ] Use `Delete all` in `Past sessions` and confirm only the current paper's saved sessions are removed
- [ ] Use `New session`
- [ ] Confirm `New session` preserves the prior session in `Past sessions` and starts a blank draft instead of discarding it
- [ ] Confirm messages/draft/run-state reset for the new blank draft
- [ ] Confirm research-brief and paper-tool cards reset with the blank draft
- [ ] Switch between Gemini CLI and Codex CLI and confirm previous threads do not mix
- [ ] Open a second paper and confirm context/session state does not leak from the first

## 8. Related papers / auto-highlight regression checks

- [ ] Trigger `Recommend related papers` after using roadmap paper tools and confirm recommendation rendering still works
- [ ] Open a recommended paper and confirm the current-paper pane state remains stable
- [ ] Use `Add to collection` on a recommendation and confirm no roadmap UI state is corrupted afterward
- [ ] Run `Highlight key passages` after generating a research brief and confirm highlight workflow still completes
- [ ] Confirm auto-highlight and research-brief/paper-tool outputs can coexist without making the pane unusable

## 9. Compare / reusable artifact checks

- [ ] `Compare` stays disabled before recommendations exist, then becomes enabled with a compact ready count once related papers are available
- [ ] Multi-paper compare flow launches from the current paper plus a bounded recommended-paper set rather than an unbounded picker
- [ ] First compare flow stays capped to the current paper plus at most 2-3 peer papers
- [ ] Compare output remains compact and clearly tied to the selected papers
- [ ] Compare surface avoids wide tables or layouts that crowd the existing workbench/recommendation/chat areas
- [ ] `Save for collection` preserves reusable artifact content with traceable source paper context

## 10. Future-phase checks (run only when implemented)

- [ ] Any workspace/discovery surface does not regress reader-pane usability or per-paper session isolation

## 11. Regression checks

- [ ] Preferences pane opens without errors
- [ ] Build artifacts install and load in Zotero
- [ ] Built `.xpi` contains `chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar`
- [ ] No console/runtime errors during pane render and action triggers

## Session history popover and silent-turn QA (2026-04-16)

After running mastery and one or more workbench tools (research brief, contributions, limitations, follow-ups, paper compare) on a paper, then opening "Past sessions":

- The popover anchors below the "Past sessions" button and does NOT push the chat down.
- Clicking outside the popover or pressing Escape closes it. Escape returns focus to the trigger button.
- Each row is a single line: title (with optional Current / cards-saved badges), meta line, an Open button, and a kebab (⋯) button. Rename and Delete live inside the kebab menu.
- Delete and Delete all show a confirmation dialog. Cancel keeps the data.
- Reopening a session that previously ran mastery / workbench tools shows the natural chat transcript in the message list (prose markdown), with NO raw JSON lines.
- Mastery cards, workbench cards, and recommendation groups still rehydrate when the session is reopened (existing behavior).
- After opening a saved session, sending a fresh chat message continues to work end-to-end with both Codex CLI and Gemini CLI.
