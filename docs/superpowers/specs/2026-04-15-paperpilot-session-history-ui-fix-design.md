# PaperPilot Session History — UI and Silent-Turn Fix

## Summary

PR #7 (`feat: add persisted paper session history UI`) shipped two issues that need correction without re-opening the broader history design:

1. **Silent assistant turns leak into the chat transcript.** Mastery and workbench tools (research brief, contributions, limitations, follow-ups, paper compare, related recommendations) call `handleUserInput` with `silentUserMessage: true, suppressChatMessages: true`. The Codex/Gemini controllers honor that flag for live UI but still call `sessionHistoryService.persistAssistantTurn` unconditionally, persisting the raw structured response (often JSON-shaped) into `messageStore`. When the user later opens the saved session via "Past sessions", `renderMessageHistory` replays those raw responses in chat.
2. **The "Past sessions" inline panel feels heavy in a narrow Zotero side panel.** It expands inline between the session bar and the workbench, each row stacks three buttons (Open / Rename / Delete) plus badges and meta, destructive actions skip confirmation, and the layout wraps awkwardly under typical reader-pane widths.

We want to fix both without changing the persisted-history storage format or the design intent of the original RFC (single unified per-paper timeline, hybrid index + per-session snapshots, indefinite retention).

## Problem

### 2.1 Silent turns leak

Affected call sites (all use `silentUserMessage: true, suppressChatMessages: true`):

- `runPaperArtifactRequest` (`src/modules/readerPane.ts:3093`) — research brief / contributions / limitations / follow-ups / save-note / save-collection
- `runPaperCompareRequest` (`src/modules/readerPane.ts` near line 3287)
- `sendMasteryPrompt` (`src/modules/readerPane.ts:1530`)

Each silently runs Codex/Gemini, parses the structured response into a card or mastery state object, and stores the parsed result in `paperArtifactStates` / `comprehensionCheckStates` / `relatedRecommendationStates`. These maps are already independently snapshotted as `snapshot.paperArtifacts` / `snapshot.mastery` / `snapshot.relatedRecommendations`. So the chat-message persistence of the same response is **redundant** and **harmful** when re-rendered.

`controller.ts` for both engines (`src/modules/codex/controller.ts:155-164`, `src/modules/gemini/controller.ts:99-108`) calls:

```ts
await sessionHistoryService.persistAssistantTurn({ ... assistantText, ... });
```

unconditionally. `persistAssistantTurn` then calls `messageStore.append(...)` and `persistActiveSession(...)`, embedding the silent response into the snapshot's `messages` array.

### 2.2 UI awkwardness

Current implementation (`src/modules/readerPane.ts:155, 532-744`, `addon/chrome/content/zoteroPane.css:230-305`):

- Inline expandable `<div id="paper-pilot-session-history">` between session bar and workbench
- `max-height: 280px; overflow-y: auto`
- Each row: title + badges + meta line + 3 inline action buttons
- Header: "Past sessions" title + "Delete all" + "Close" buttons
- No confirmation on Delete / Delete all
- Wraps badly in narrow side panels

The original spec calls this surface a "compact `Past sessions` popover". The current implementation is closer to a section than a popover, which is the source of the "awkward" feel.

## Goals

- Stop persisting silent assistant turns into the chat transcript going forward.
- Hide already-persisted JSON-shaped silent turns when reopening older sessions, without rewriting any storage files.
- Convert the "Past sessions" surface into an anchored popover that does not push the chat down.
- Reduce per-row visual weight and add confirmation on destructive actions.
- Preserve all currently-working behavior: resume metadata, mode/model continuity, paper artifacts / mastery / recommendations rehydration, rename, delete, delete-all, "Current" badge, and live tests.

## Non-goals

- Storage-format migration, schema bump, or rewriting saved snapshot files.
- Changing what gets persisted in `paperArtifacts` / `mastery` / `relatedRecommendations`.
- Redesigning the broader session-history RFC (single timeline, indefinite retention, etc.).
- Adding new privacy preferences.
- Building a global cross-paper history browser.
- Changing the Zotero pane chrome (e.g., adding modals on top of the side panel).

## Existing Context

Relevant code:

- `src/modules/session/sessionHistoryService.ts` — `persistAssistantTurn`, `openSavedSession`, snapshot orchestration
- `src/modules/session/sessionSnapshot.ts` — `captureSessionSnapshot` / `applySessionSnapshot`
- `src/modules/message/messageStore.ts` — in-memory message records, privacy filtering
- `src/modules/codex/controller.ts` — calls `persistAssistantTurn` after every Codex run
- `src/modules/gemini/controller.ts` — calls `persistAssistantTurn` after every Gemini run
- `src/modules/readerPane.ts` — the "Past sessions" panel, `handleUserInput`, mastery and workbench callers, `renderMessageHistory`
- `addon/chrome/content/zoteroPane.css` — `.pp-session-history*` styles
- `docs/superpowers/specs/2026-04-14-paperpilot-session-history-design.md` — original RFC
- Tests: `test/sessionHistoryService.test.ts`, `test/sessionLifecycle.test.ts`, `test/sessionHistoryRepository.test.ts`

## Considered Approaches

### A. Surgical fix in controllers + popover for UI (chosen)

Add a `suppressPersistedMessage` flag to `persistAssistantTurn` and to the Codex/Gemini controllers. When the call site is silent, the controllers skip the `messageStore.append` while still updating resume metadata and snapshot timestamps. Backfill old data with a render-time heuristic that hides assistant messages containing a stand-alone JSON-object line. Convert `#paper-pilot-session-history` from inline expansion to an absolutely-positioned popover anchored under the "Past sessions" button, simplify each row, and add `confirm` on destructive actions.

Pros:
- Smallest behavioral change, smallest diff
- No storage migration
- No new preferences
- Aligns with original spec's "compact popover" wording

Cons:
- Render-time heuristic is best-effort for legacy data (acceptable per Q2 (i))

### B. Structural separation of "tool" turns from "chat" turns

Introduce a dedicated `toolTurns` array in the snapshot, separate from `messages`. Move all silent turns there and never render them in chat.

Pros:
- Conceptually cleaner
- Future-proof for analytics

Cons:
- Storage schema change, version bump, migration
- Larger code touch surface, larger test surface
- Overkill for current need

### C. Render-time filter only

Only filter at render time; keep persisting silent turns.

Pros:
- Smallest possible change

Cons:
- Storage stays polluted; every silent turn keeps adding bytes to the snapshot
- Same heuristic risk for new data, not just legacy

## Chosen Approach — A

### 6.1 Suppress persistence of silent assistant turns

**`persistAssistantTurn` (in `sessionHistoryService.ts`):**

Add `suppressMessage?: boolean` to the params type. Behavior changes:

- **Active session branch** (`session.sessionId === params.sessionId`):
  - If `suppressMessage`, skip `messageStore.append(...)`.
  - Still call `sessionStore.update(...)` so `applyResumeMetadata` runs and resume IDs (`lastCodexSessionID` / `lastGeminiSessionID`) are kept.
  - Still call `persistActiveSession(...)` so `updatedAt`, `lastMode`, and `lastModel` are refreshed in the snapshot.
- **Late completion branch** (`!session || session.sessionId !== params.sessionId`):
  - If `suppressMessage`, do not push a new message into `messages`.
  - Still apply resume metadata and write back the snapshot so resume continuity for that prior session is preserved.

**Controllers (`codex/controller.ts`, `gemini/controller.ts`):**

Both already take `suppressChatMessages?: boolean`. Pass it through to `persistAssistantTurn` as `suppressMessage`. No new parameter in the controller's public interface; we simply forward the existing flag — silent in chat means silent in history too. This matches every existing call site (mastery and workbench) without further changes there.

**Trade-off explicitly noted:** any future caller that wants "show in chat live but skip persistence" or vice versa would need a separate flag. Today no such caller exists, and adding the flag now would be speculative (YAGNI).

### 6.2 Backstop for legacy snapshots

`renderMessageHistory` (`readerPane.ts:2889`) filters assistant messages that look like silent tool output before passing them to `addMessage`.

Heuristic (intentionally narrow to limit false positives):

- Only consider messages with `role === "assistant"`.
- Split on lines, trim each line.
- If any line both starts with `{` (or `[`) and `JSON.parse` succeeds as a non-array object with at least one of these keys at top level: `question`, `topic`, `difficulty`, `understood`, `confidence`, `evaluation`, `misunderstandings`, `kind`, `summary`, `groups` — treat the entire message as a silent tool turn and skip it.
- Otherwise render normally.

The key set covers the structured shapes produced by `parseMasteryQuestionResponse`, `parseMasteryEvaluationResponse`, `parsePaperArtifactCard`, and the related-paper recommendation parsers in the current codebase. Live conversational answers from Codex/Gemini do not start with bare JSON object lines containing these keys, so the false-positive risk is low.

The filter lives on the read path only; storage files are not modified (per Q2 (i)).

### 6.3 "Past sessions" popover

**Markup:** Keep `<div id="paper-pilot-session-history">` but reposition. Wrap it relative to the session bar so absolute positioning works inside the addon DOM:

- Make `#paper-pilot-session-bar` the positioning context: `position: relative`.
- Style `.pp-session-history` as `position: absolute; top: 100%; right: 10px; z-index: 50; min-width: 280px; max-width: calc(100% - 20px); max-height: 320px; overflow-y: auto;` with the existing card chrome (border, radius, shadow). It no longer occupies vertical space in normal flow.
- Default `display: none;` stays. Toggle to `display: block;` when open.

**Open / close:**

- Toggle on `pastSessionsButton` click (already present).
- Close on `Escape` keydown when the popover is the active surface.
- Close on outside click (single document-level handler installed only while open; removed on close to avoid leaks).
- Remove the in-header "Close" button — redundant with outside-click and re-clicking the trigger.

**Row simplification:**

Each row becomes a single horizontal line:

```
[ Title (truncate)  · short meta ]   [Open]   [⋯]
```

- Title and meta share a flex column with `min-width: 0; overflow: hidden; text-overflow: ellipsis`.
- Meta is condensed to: `Updated <relative time> · <message count> msg · <mode label>`. (Drop the redundant "Created" timestamp from the row; keep it available via row `title` tooltip.)
- "Has cards" badge collapses into an icon-style pill `●` with an accessible `aria-label`, only when `hasArtifacts || hasRecommendations || hasMasteryState`.
- "Open" stays as a primary-feel ghost button. It is `disabled` for the current session and shows the "Current" badge inline.
- A `⋯` (kebab) button to the right opens a small two-item contextual menu: `Rename`, `Delete`. The menu is built ad-hoc as a small absolutely-positioned `<ul>` next to the kebab; it closes on outside click / Escape / item activation. (We avoid adding a heavyweight dependency.)

**Confirmation on destructive actions:**

- `Delete`: `Services.prompt.confirm(window, "Delete session", "Delete '<title>'? This cannot be undone.")`. Proceed only if true. Use the addon's existing `Zotero.getMainWindow()` (or `pastSessionsButton.ownerDocument.defaultView`) for the parent.
- `Delete all`: same pattern, `"Delete all sessions for this paper? This cannot be undone."`
- Rename inline editor unchanged.

**Header simplification:**

- Keep the "Past sessions" title on the left.
- Right side: a single small "Delete all" ghost button, only when at least one entry exists. Confirmation dialog gates the action.
- Drop the in-header "Close" button — popover closes via outside click, Escape, or re-clicking the trigger.

### 6.4 Minor tidy-ups inside scope

- Update `aria-expanded` handling for the popover to remain correct on outside-close.
- Ensure focus returns to `pastSessionsButton` on close (basic accessibility).
- `pp-session-history__rename-input` keeps its existing styling.

## Data Flow

Live silent turn (post-fix):

```
Mastery click
  → handleUserInput(silentUserMessage=true, suppressChatMessages=true)
  → handleCodexQuestion(suppressChatMessages=true)
  → controller.poll() completes
  → sessionHistoryService.persistAssistantTurn({ ..., suppressMessage: true })
      → skip messageStore.append
      → sessionStore.update(applyResumeMetadata)
      → persistActiveSession → captureSessionSnapshot (no new chat message in messages array)
  → onComplete(assistantText) parsed into mastery state
  → comprehensionCheckStates updated → snapshot.mastery refreshed on next snapshot capture
```

Reopen of an older session (legacy data):

```
User clicks Open on a past session
  → openSavedSession → applySessionSnapshot → messageStore.replace(snapshot.messages)
  → rerenderPane → renderMessageHistory
      → filter out assistant messages whose body contains a JSON-object line with known tool keys
      → addMessage(...) for the rest, rendered as markdown
```

## Error Handling

- Heuristic filter wraps `JSON.parse` in try/catch (return false). No throw to UI.
- `confirm` returns `false` → no action; no error shown.
- Outside-click handler is removed in the same code path that closes the popover; if removal fails (e.g., body unmounted), the handler will no-op since the panel is gone.

## Testing

Unit tests:

- `test/sessionHistoryService.test.ts` — add cases:
  - `persistAssistantTurn({ suppressMessage: true })` does not call `messageStore.append` and does not add an entry to `snapshot.messages`, but updates `lastCodexSessionID` / `lastGeminiSessionID` / `updatedAt` / `lastMode`.
  - Late-completion branch with `suppressMessage: true` updates resume metadata in the existing snapshot but leaves `messages` unchanged.
- New `test/renderMessageHistoryFilter.test.ts` (or extend existing `readerPane` tests if present) — pure unit test for the legacy-message filter:
  - Plain assistant message → kept.
  - Assistant message with a bare `{"question": ...}` line → dropped.
  - Assistant message with reasoning prose followed by a JSON line containing `understood` / `evaluation` keys → dropped.
  - Assistant message with markdown code fence containing JSON example → kept (code fence starts with backticks, not bare `{`).
  - User messages → always kept regardless of content.

Integration / behavioral tests:

- `test/sessionLifecycle.test.ts` — extend the existing mastery / workbench scenarios to assert that after a silent turn completes, `messageStore.list(sessionId)` contains no new assistant entry but `sessionStore.get(itemID).lastCodexSessionID` is updated.

UI sanity (manual, documented in `docs/manual-qa.md` update):

- Past sessions popover opens / closes via button / outside click / Escape.
- Single-row layout does not wrap in a 320 px wide reader pane.
- Rename, Delete, Delete all all show a confirmation (Delete / Delete all) and behave as before on confirm.
- Reopening a session from an older mastery run shows no JSON in chat, mastery cards still rehydrate.

## Risks and Trade-offs

- **Heuristic false positives:** an assistant message that legitimately starts a line with `{"question": ...}` (e.g., the user explicitly asked the model to output JSON) will be hidden on reopen. We accept this for legacy data only; new data is filtered structurally at the persistence layer, not heuristically. Documenting in manual QA so users can rerun if they hit this corner.
- **Resume metadata for late silent completions:** a late completion that arrives after the user switched sessions will still update `lastCodexSessionID` / `lastGeminiSessionID` on the prior session even though no chat message is added. This matches today's behavior for non-silent turns and is desirable for resume continuity.
- **Popover positioning inside Zotero pane:** the addon DOM is iframe-like; absolute positioning relative to `#paper-pilot-session-bar` should work, but must be verified visually. If positioning breaks at narrow widths, fall back to a slightly modified inline behavior with reduced row weight (this fallback path is documented for the implementation plan, not for first-cut delivery).

## Out-of-scope follow-ups

- Schema-level separation of tool turns from chat turns (Approach B) for future cleanliness.
- Cross-paper history browser.
- Migration utility to actually rewrite legacy snapshot files (Q2 (ii) was rejected for this iteration).
