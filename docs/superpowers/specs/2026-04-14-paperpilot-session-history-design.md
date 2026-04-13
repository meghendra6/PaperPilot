# PaperPilot Session History Design

## Summary

PaperPilot currently has paper-scoped in-memory session continuity, but it does not persist prior sessions across Zotero restarts. This design adds local session history persistence so users can revisit and resume prior paper conversations without turning the reader pane into a heavy history browser.

The approved direction is:

- A single unified session timeline per paper across Codex CLI and Gemini CLI
- No automatic restore when reopening a paper; the pane starts in a blank current draft session
- A compact `Past sessions` button next to `New session`
- Opening a past session immediately resumes that same session
- `New session` preserves the current session and starts a fresh draft
- Indefinite retention until explicit user deletion
- Session titles are auto-generated initially and can be renamed later
- Persist only completed, stable state; do not attempt to restore in-progress streaming or runtime execution state

## Problem

Current PaperPilot sessions are held in memory only:

- `sessionStore` keeps one active session per `itemID + mode`
- `messageStore` keeps per-session messages in memory only
- `New session` currently clears the active conversation rather than preserving it
- Existing preferences such as `saveDocumentSessions` and `privacyStoreLocalHistory` imply persistence, but the code does not yet persist sessions across app restarts

This creates two gaps:

1. Users cannot revisit prior paper conversations after restarting Zotero
2. The current `New session` behavior discards prior context instead of turning it into a retrievable archived session

## Goals

- Persist prior sessions locally on disk
- Keep session history scoped to the active paper
- Keep Codex and Gemini messages in one unified per-paper session timeline
- Let users view and reopen prior sessions from a compact UI entry point
- Let users continue writing into a reopened prior session
- Preserve completed paper-workbench state with the session when privacy settings allow it
- Respect existing privacy preferences rather than introducing a parallel preference system
- Keep the reader pane compact and avoid permanently expanded history UI

## Non-goals

- Automatically reopen the most recent prior session when a paper is opened
- Persist or restore in-progress CLI runs, streaming deltas, polling state, or temporary draft text
- Build a global cross-paper conversation history browser
- Add a full event-sourced history system
- Add a recycle bin or undo stack for deleted sessions in v1

## Existing Context

Relevant current code:

- `src/modules/session/sessionStore.ts`
- `src/modules/message/messageStore.ts`
- `src/modules/readerPane.ts`
- `addon/prefs.js`
- `addon/chrome/content/preferences.xhtml`
- `docs/manual-qa.md`

Current observed behavior:

- Session continuity is paper-scoped, but memory-backed
- The reader pane is vertically constrained and already contains mode controls, workbench controls, recommendations, and chat
- Workbench outputs and recommendation state live in addon-level per-item maps, not in session-owned persisted objects
- Session identity is currently too thin for multiple archived sessions because `threadTitle` effectively mirrors the paper title

## Considered Approaches

### 1. Single JSON file per paper

Store every session and every message for a paper in one large JSON file.

Pros:

- Simple first implementation
- Easy to load the full paper history at once

Cons:

- Every append rewrites the full file
- Rename/delete/load operations become less isolated
- Recovery from partial corruption is worse

### 2. Event log / append-only journal

Persist session events and reconstruct current state on load.

Pros:

- Precise state evolution
- Extensible for future analytics or audit uses

Cons:

- Overbuilt for PaperPilot's current needs
- Higher implementation and testing complexity
- Harder to reason about restore behavior

### 3. Hybrid index + per-session snapshots

Store a lightweight paper index plus one snapshot file per session.

Pros:

- Fast session list rendering
- Rename/delete/load operations stay local to one session
- Lower write amplification than a single monolithic file
- Much simpler than event sourcing

Cons:

- Requires index/session synchronization logic
- Introduces more than one file per paper

## Chosen Approach

Use the hybrid storage model:

- One paper-level index file per paper
- One snapshot file per saved session
- A transient blank draft session in memory when the pane opens
- Persist a session only after the first persist-worthy event

This is the smallest design that satisfies reading, resuming, renaming, deleting, and restoring completed UI state.

## Approved User Decisions

- Unify Codex and Gemini history into one paper-level timeline
- Reopening a paper should start from a blank current draft session
- Prior sessions should be accessed through a small `Past sessions` button
- Opening a past session should immediately continue that same session
- `New session` should preserve the current session and create a new blank one
- Sessions should be retained indefinitely until explicit deletion
- Session list identity should be a user-editable session title with timestamps as supporting metadata
- New sessions should start with an automatic title rather than a prompt
- Session restore should include only completed, stable state

## UX Design

### Reader pane entry

The reader pane remains compact by default:

- Add a `Past sessions` secondary button next to `New session`
- Do not add a permanently visible history panel
- Do not auto-expand past transcripts on paper open

### Default open behavior

When a paper is opened:

- The pane starts in a blank draft session
- No persisted session is automatically loaded into chat
- The draft session is not written to disk until a persist-worthy event occurs

Persist-worthy events:

- A user message is submitted
- An assistant response is completed and is allowed by privacy settings
- A paper-workbench result is completed and allowed by privacy settings
- A related-paper recommendation result is completed and allowed by privacy settings
- A mastery/comprehension session reaches a completed state and is allowed by privacy settings

### Past sessions popover

Clicking `Past sessions` opens a compact popover list for the current paper.

Each list item shows:

- Session title
- Created time
- Updated time
- Message count
- Last active mode
- Fixed indicators when applicable: `Current`, `Has cards`, and `Prompts only`

Ordering:

- Sort by `updatedAt` descending

Available actions in the popover:

- Open session
- Rename session
- Delete session
- Delete all sessions for the current paper

### Session opening behavior

When a saved session is opened:

- Replace the current chat transcript with the saved transcript
- Restore completed saved UI state owned by the session
- Set the active mode to the saved session's last mode
- Subsequent turns append to that same session
- Keep per-message `sourceMode` metadata in storage, but do not render per-message mode badges in v1

### New session behavior

`New session` changes semantics from "clear current chat" to "archive current session and start a new draft":

- If the active session is meaningful, flush its latest persisted state
- Switch to a new blank draft session
- Do not delete the previous session

If the current draft session is still empty and has never produced any persist-worthy state:

- Keep it transient
- Do not create an empty persisted session just because `New session` was clicked

### Session titles

Initial title behavior:

- Auto-generate from the first user question when possible
- If the first question is unusable, fall back to a time-based title

Edit behavior:

- Users can rename sessions inline from the `Past sessions` popover
- The edited title becomes the primary identity in the list

## Storage Architecture

Use a PaperPilot-managed local storage root under the Zotero profile/plugin data area. The exact OS path should be resolved in implementation using existing Zotero file APIs rather than hardcoded string concatenation in the design.

Logical structure:

```text
paperpilot/
  session-history/
    papers/
      <itemID>/
        index.json
        sessions/
          <sessionID>.json
```

### Paper index

`index.json` stores lightweight metadata only:

```json
{
  "paperItemID": 123,
  "paperTitle": "Example Paper",
  "sessions": [
    {
      "sessionId": "paper-123-1713190000000",
      "title": "Compare retrieval chunking with long-context summarization",
      "createdAt": "2026-04-14T00:10:00.000Z",
      "updatedAt": "2026-04-14T00:19:00.000Z",
      "messageCount": 8,
      "lastMode": "codex_cli",
      "hasArtifacts": true,
      "hasRecommendations": false,
      "hasMasteryState": false,
      "storageVersion": 1
    }
  ]
}
```

The index is optimized for:

- Fast `Past sessions` rendering
- Rename/delete/list operations without loading full transcripts
- Recovering from missing or corrupted session files

### Session snapshot

Each `sessions/<sessionID>.json` stores the actual restorable state:

```json
{
  "storageVersion": 1,
  "sessionId": "paper-123-1713190000000",
  "paperItemID": 123,
  "title": "Compare retrieval chunking with long-context summarization",
  "createdAt": "2026-04-14T00:10:00.000Z",
  "updatedAt": "2026-04-14T00:19:00.000Z",
  "lastMode": "codex_cli",
  "lastCodexSessionID": "codex-thread-id",
  "lastGeminiSessionID": "gemini-thread-id",
  "lastModel": {
    "mode": "codex_cli",
    "model": "gpt-5-codex",
    "reasoningEffort": "medium"
  },
  "messages": [],
  "paperArtifacts": {},
  "relatedRecommendations": {},
  "mastery": {}
}
```

The exact snapshot schema can evolve, but it must preserve:

- Session metadata
- Transcript records
- Last mode and model metadata
- Completed paper-workbench state
- Completed related-recommendation state
- Completed mastery/comprehension state when privacy settings allow it
- Per-message `sourceMode` values for mixed-mode transcripts

## Snapshot Scope

### Persisted

- User messages allowed by privacy settings
- Assistant messages allowed by privacy settings
- Last active mode
- Last selected model metadata needed for restore
- Saved paper artifact cards and status text
- Saved related recommendation groups and status text
- Compare helper inputs that can be re-derived or cheaply stored
- Completed mastery/comprehension rounds and status

### Not persisted

- In-progress streaming text
- Polling intervals or process state
- Temporary draft input value
- Transient authentication or workspace health banners
- "Currently running" UI
- Any ephemeral error state that is not meaningful after restart

## Restore Rules

Restore must separate session-owned state from runtime-owned state.

### Session-owned state

Restore from snapshot:

- Chat transcript
- Completed workbench cards
- Recommendation results
- Completed mastery state
- Session title and metadata
- Last active mode
- Last selected model metadata

### Runtime-owned state

Recompute on render:

- Current CLI authentication status
- Current executable validity
- Current writable workspace state
- Current run-state card
- Any current provider availability checks

This prevents the UI from falsely showing that a past session is still "running" or that a past runtime condition still holds.

### Restore order

When loading a session:

1. Read the session snapshot
2. Restore the active session pointer
3. Render the transcript
4. Render saved artifact/recommendation/mastery state
5. Restore the saved mode/model selection
6. Recompute runtime-only status cards from the current environment

## Privacy And Preference Semantics

This design should respect existing preferences instead of adding a parallel preference surface.

### `saveDocumentSessions`

Interpretation:

- Master switch for persisted document sessions

Behavior:

- `false`: do not write sessions to disk; show `Past sessions` disabled with a short explanation
- `true`: allow session persistence subject to privacy prefs

### `privacyStoreLocalHistory`

Interpretation:

- Master switch for local transcript history storage

Behavior:

- `false`: do not persist transcript or snapshot history; show `Past sessions` disabled with a short explanation
- `true`: allow session persistence subject to the narrower response-related prefs

### `privacySavePromptsOnly`

Interpretation:

- Persist user prompts only

Behavior:

- Persist user messages
- Do not persist assistant messages
- Do not persist assistant-derived artifacts, recommendations, or mastery summaries

### `privacySaveResponses`

Interpretation:

- Whether assistant outputs may be persisted

Behavior:

- `false`: persist user messages only, plus session metadata that does not reveal assistant content
- `true`: allow assistant messages and assistant-derived completed UI snapshots, unless `privacySavePromptsOnly=true`

### Effective priority

Recommended resolution order:

1. If `saveDocumentSessions=false`, disable persistence completely
2. Else if `privacyStoreLocalHistory=false`, disable persisted session history completely
3. Else if `privacySavePromptsOnly=true`, persist only user prompts and safe metadata
4. Else if `privacySaveResponses=false`, persist only user prompts and safe metadata
5. Else persist full completed session snapshots

This keeps behavior deterministic and explainable.

## Delete And Rename Semantics

### Rename

- Rename is initiated from the `Past sessions` popover
- Update both the paper index metadata and the session snapshot title
- No separate modal is needed in v1

### Delete single session

- Confirm before deletion
- Remove the session entry from the paper index
- Delete the corresponding session snapshot file
- If the deleted session is currently open, switch the pane to a new blank draft session

### Delete all sessions for current paper

- Confirm explicitly
- Remove all index entries and all per-session files for that paper
- Return the pane to a blank draft session

### Retention

- Keep sessions indefinitely until explicit deletion
- No automatic pruning in v1

## Failure Handling

### Atomic writes

Persist with an atomic pattern such as:

- Write temporary file
- Flush
- Rename into final path

This is important for both the index file and session snapshot files.

### Corruption tolerance

If `index.json` exists but a session file is missing or invalid:

- Keep the list entry visible
- Show a clear load failure for that session
- Offer deletion of the broken entry

If orphaned session files exist without index entries:

- Ignore them during normal UI
- Leave them untouched until a future explicit maintenance flow exists

### Versioning

- Include `storageVersion` in both index and session files
- Start with `storageVersion = 1`
- Future schema changes can migrate forward from there

## Implementation Notes

This design likely needs a dedicated persistence layer instead of pushing file I/O into `readerPane.ts`.

Recommended boundaries:

- `sessionHistoryRepository`
  - File-system read/write/list/delete for paper indices and session snapshots
- `persistedSessionStore`
  - Bridges in-memory active draft state with persisted sessions
- `sessionTitle`
  - Automatic title generation and fallback handling
- `readerPane` integration
  - `Past sessions` button, popover wiring, restore and lifecycle events

Important state-model change:

- Existing `sessionStore` is keyed by `itemID + mode`
- The new persisted model is keyed by `paper itemID + sessionID`, with mode becoming metadata on turns and on the session snapshot

This is a meaningful architectural shift and should be explicit in implementation planning.

## Migration Strategy

No on-disk migration is needed for existing users because there is no previous persisted session-history format.

Behavior on upgrade:

- Existing in-memory-only sessions remain ephemeral
- New persisted sessions begin after upgrading to the new implementation

## Testing Strategy

Automated:

- Paper index read/write/list tests
- Session snapshot serialize/deserialize tests
- Privacy preference matrix tests
- Session title generation tests
- `New session` lifecycle tests
- `Past sessions` open/rename/delete tests
- Restore of mixed-mode sessions
- Restore of completed artifact/recommendation/mastery state
- Runtime/session-state separation tests

Manual QA:

- Update `docs/manual-qa.md` with saved-session coverage
- Re-test existing session correctness flows
- Re-test reader-pane compactness with wrapped session-bar buttons
- Re-test mixed Codex/Gemini usage on the same paper
- Re-test privacy settings and confirm persisted content matches the selected policy

## RFC Structure For GitHub Issue

The GitHub issue RFC should mirror this structure:

- Problem
- Goals
- Non-goals
- Approved user decisions
- UX flow
- Storage architecture
- Snapshot scope
- Privacy/preference semantics
- Failure handling
- Testing strategy
- Migration strategy

## Open Risks

- The current code stores several UI surfaces in per-item addon maps rather than session-owned objects, so restore logic can sprawl if not isolated carefully
- `New session` currently clears state aggressively; changing this behavior touches both UX expectations and regression tests
- Privacy-setting interactions can easily produce surprising outcomes if the precedence order is not implemented exactly as designed
- Unified mixed-mode sessions are correct for the user goal, but they require careful handling because the current codebase treats mode as part of session identity

## Recommendation

Proceed with the hybrid persisted-session design and treat it as a focused storage and lifecycle refactor, not as a broad chat-system rewrite. The implementation should stay tightly scoped to:

- persisted session repository
- session lifecycle changes
- compact history entry UI
- restore-safe serialization of completed session-owned state
