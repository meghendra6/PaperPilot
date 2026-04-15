# PaperPilot Session History UI Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop silent assistant turns (mastery, workbench tools) from leaking JSON-shaped responses into the persisted chat transcript, hide already-leaked messages on legacy session reopen, and convert the awkward inline "Past sessions" surface into a compact anchored popover.

**Architecture:** Surgical changes only. Add a `suppressMessage` option to `sessionHistoryService.persistAssistantTurn` and forward `suppressChatMessages` from both engine controllers. Add a narrow read-time filter (`silentTurnFilter` module) for legacy data, wired into `renderMessageHistory`. Convert `#paper-pilot-session-history` from inline expansion to absolutely-positioned popover, simplify each row to a single line with a kebab (⋯) menu for Rename/Delete, and add `Services.prompt.confirm` on destructive actions. No storage format change.

**Tech Stack:** TypeScript (Zotero plugin), `node:test` runner, Mozilla XUL DOM, plain CSS in `addon/chrome/content/zoteroPane.css`.

**Spec:** `docs/superpowers/specs/2026-04-15-paperpilot-session-history-ui-fix-design.md`

---

## File Map

**Modify (production):**
- `src/modules/session/sessionHistoryService.ts` — add `suppressMessage?: boolean` to `persistAssistantTurn`, branch behavior
- `src/modules/codex/controller.ts` — forward `suppressChatMessages` as `suppressMessage`
- `src/modules/gemini/controller.ts` — forward `suppressChatMessages` as `suppressMessage`
- `src/modules/readerPane.ts` — wire `silentTurnFilter` into `renderMessageHistory`; refactor `renderSessionHistory` (popover layout, kebab menu, confirm, outside-click/Escape)
- `addon/chrome/content/zoteroPane.css` — `#paper-pilot-session-bar { position: relative; }` and rewrite `.pp-session-history*` for popover

**Create (production):**
- `src/modules/session/silentTurnFilter.ts` — single-purpose pure module: `isLikelySilentToolMessage(record)`

**Create (tests):**
- `test/silentTurnFilter.test.ts`

**Modify (tests):**
- `test/sessionHistoryService.test.ts` — add suppressMessage cases for both persistAssistantTurn branches

**Modify (docs):**
- `docs/manual-qa.md` — add popover + silent-turn QA steps

---

## Phase 1 — Stop persisting silent turns

### Task 1: Test that suppressMessage skips messageStore.append in the active-session branch

**Files:**
- Modify: `test/sessionHistoryService.test.ts`

- [ ] **Step 1: Read the bottom of the existing test file to find the right insertion point**

Run: `node --require ts-node/register --test test/sessionHistoryService.test.ts`
Expected: all existing tests pass (baseline). Note that the failing tests in step 3 will appear after the new test is added.

- [ ] **Step 2: Append a new test case at the end of `test/sessionHistoryService.test.ts`**

Insert this test at the end of the file (after the last existing `test(...)` block, before the trailing newline):

```ts
test("SessionHistoryService.persistAssistantTurn with suppressMessage skips chat persistence on the active session", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 601,
      mode: "codex_cli",
    });

    // A normal user message exists already in the transcript.
    messageStore.append(session.sessionId, {
      role: "user",
      text: "Walk me through the paper.",
      sourceMode: "codex_cli",
      status: "done",
    });

    const result = await service.persistAssistantTurn({
      itemID: 601,
      sessionId: session.sessionId,
      mode: "codex_cli",
      paperTitle: "Suppressed turn paper",
      assistantText: '{"question":"silent","topic":"x","difficulty":"foundational"}',
      success: true,
      rawEvent: '{"type":"item.completed"}',
      resumeSessionId: "codex-thread-suppressed",
      suppressMessage: true,
    });

    // No new assistant message in the in-memory store.
    const stored = messageStore.listRaw(session.sessionId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].role, "user");

    // The snapshot returned reflects no assistant message either.
    assert.ok(result);
    assert.equal(result?.messages?.length, 1);
    assert.equal(result?.messages?.[0].role, "user");

    // Resume metadata must still be tracked on the in-memory session.
    const live = sessionStore.get(601);
    assert.equal(live?.lastCodexSessionID, "codex-thread-suppressed");

    // The persisted snapshot on disk also reflects no new assistant message.
    const saved = await repository.readSessionSnapshot(601, session.sessionId);
    assert.equal(saved?.messages?.length, 1);
    assert.equal(saved?.messages?.[0].role, "user");
    assert.equal(saved?.lastCodexSessionID, "codex-thread-suppressed");

    messageStore.clear(session.sessionId);
    sessionStore.reset(601, "codex_cli");
  } finally {
    globals.restore();
  }
});
```

- [ ] **Step 3: Run only the new test to verify it fails for the right reason**

Run: `node --require ts-node/register --test test/sessionHistoryService.test.ts 2>&1 | tail -40`
Expected: TypeScript / runtime failure indicating `suppressMessage` is not a known property of the `persistAssistantTurn` params type, OR the assertion `stored.length === 1` fails because the silent assistant message was appended anyway.

- [ ] **Step 4: Add the `suppressMessage` option and active-branch behavior to `persistAssistantTurn`**

Edit `src/modules/session/sessionHistoryService.ts`. In the `persistAssistantTurn` method signature (currently around line 189), add the new optional field:

```ts
async persistAssistantTurn(params: {
  itemID: number;
  sessionId: string;
  mode: EngineMode;
  paperTitle: string;
  assistantText: string;
  success: boolean;
  rawEvent?: string;
  resumeSessionId?: string;
  suppressMessage?: boolean;
}) {
```

Then locate the active-session branch (currently the block starting around line 241 with `messageStore.append(...)`). Wrap the `messageStore.append(...)` call in a `suppressMessage` guard:

```ts
    if (!params.suppressMessage) {
      messageStore.append(session.sessionId, {
        role: "assistant",
        text: params.assistantText,
        sourceMode: params.mode,
        status: params.success ? "done" : "error",
        ...(params.rawEvent ? { rawEvent: params.rawEvent } : {}),
      });
    }

    sessionStore.update(
      params.itemID,
      params.mode,
      session.threadTitle,
      (existing) => {
        applyResumeMetadata(existing, params);
      },
    );

    return this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `node --require ts-node/register --test test/sessionHistoryService.test.ts 2>&1 | tail -20`
Expected: all tests pass, including the new "suppressMessage skips chat persistence on the active session".

- [ ] **Step 6: Commit**

```bash
git add src/modules/session/sessionHistoryService.ts test/sessionHistoryService.test.ts
git commit -m "feat(session-history): suppress silent assistant turns on active branch"
```

---

### Task 2: Test that suppressMessage skips message push on the late-completion branch

**Files:**
- Modify: `test/sessionHistoryService.test.ts`
- Modify: `src/modules/session/sessionHistoryService.ts` (late-completion branch)

- [ ] **Step 1: Append the late-branch test at the end of `test/sessionHistoryService.test.ts`**

```ts
test("SessionHistoryService.persistAssistantTurn with suppressMessage skips message push on the late-completion branch", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    // Simulate a previously persisted snapshot that the user has since switched away from.
    const priorSession = service.ensureDraftSession({
      itemID: 602,
      mode: "gemini_cli",
    });
    const priorSessionId = priorSession.sessionId;

    messageStore.append(priorSessionId, {
      role: "user",
      text: "Original question.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    messageStore.append(priorSessionId, {
      role: "assistant",
      text: "Original response.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 602,
      paperTitle: "Late completion paper",
    });

    // User starts a new draft -- the active session is now different.
    sessionStore.reset(602, "gemini_cli");
    const newDraft = service.ensureDraftSession({
      itemID: 602,
      mode: "gemini_cli",
    });
    assert.notEqual(newDraft.sessionId, priorSessionId);

    // A late silent completion arrives bound to the prior session.
    const result = await service.persistAssistantTurn({
      itemID: 602,
      sessionId: priorSessionId,
      mode: "gemini_cli",
      paperTitle: "Late completion paper",
      assistantText: '{"understood":true,"confidence":0.9,"evaluation":"ok"}',
      success: true,
      resumeSessionId: "gemini-thread-late",
      suppressMessage: true,
    });

    // The prior snapshot must not gain a new assistant message...
    assert.ok(result);
    assert.equal(result?.messages?.length, 2);
    assert.equal(
      result?.messages?.[result.messages.length - 1].text,
      "Original response.",
    );

    // ...but resume metadata on the persisted snapshot is updated.
    const saved = await repository.readSessionSnapshot(602, priorSessionId);
    assert.equal(saved?.messages?.length, 2);
    assert.equal(saved?.lastGeminiSessionID, "gemini-thread-late");

    messageStore.clear(priorSessionId);
    messageStore.clear(newDraft.sessionId);
    sessionStore.reset(602, "gemini_cli");
  } finally {
    globals.restore();
  }
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node --require ts-node/register --test test/sessionHistoryService.test.ts 2>&1 | tail -30`
Expected: assertion failure on `result?.messages?.length === 2` — the late branch currently pushes a new message regardless.

- [ ] **Step 3: Update the late-completion branch in `persistAssistantTurn`**

Edit `src/modules/session/sessionHistoryService.ts`. Locate the early-return block (currently around line 202) that handles `if (!session || session.sessionId !== params.sessionId)`. Modify the `if (prefs.persistAssistantMessages)` check to also respect `suppressMessage`:

```ts
      const messages = [...(snapshot.messages ?? [])];
      const prefs = resolveSessionHistoryPrefs();
      if (prefs.persistAssistantMessages && !params.suppressMessage) {
        messages.push(
          buildAssistantMessageRecord({
            sessionId: params.sessionId,
            createdAt,
            assistantText: params.assistantText,
            mode: params.mode,
            success: params.success,
            rawEvent: params.rawEvent,
            index: messages.length,
          }),
        );
      }
```

The rest of the branch (snapshot save, applyResumeMetadata) is unchanged.

- [ ] **Step 4: Run the test again to verify it passes**

Run: `node --require ts-node/register --test test/sessionHistoryService.test.ts 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/session/sessionHistoryService.ts test/sessionHistoryService.test.ts
git commit -m "feat(session-history): suppress silent assistant turns on late branch"
```

---

### Task 3: Forward `suppressChatMessages` from both engine controllers

**Files:**
- Modify: `src/modules/codex/controller.ts:155-164`
- Modify: `src/modules/gemini/controller.ts:99-108`

This task does not need new tests at the controller layer — the existing integration coverage in `test/sessionLifecycle.test.ts` and the new service-layer assertions cover the wiring. We do, however, run `npm test` to ensure nothing regresses.

- [ ] **Step 1: Wire Codex controller — both call sites**

Edit `src/modules/codex/controller.ts`. There are two `persistAssistantTurn` call sites. Update both to forward `suppressChatMessages`.

First call site, in the early `if (!result.ok)` block (currently around line 55):

```ts
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      sessionId: params.sessionId,
      mode: "codex_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText: result.error,
      success: false,
      suppressMessage: params.suppressChatMessages,
    });
```

Second call site, in the polling completion block (currently around line 155):

```ts
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      sessionId: params.sessionId,
      mode: "codex_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText,
      success,
      rawEvent: progress.rawOutput,
      resumeSessionId: resumedThreadId,
      suppressMessage: params.suppressChatMessages,
    });
```

- [ ] **Step 2: Wire Gemini controller — both call sites**

Edit `src/modules/gemini/controller.ts`. Same pattern, two sites.

First call site, in the `if (!result.ok)` block (currently around line 45):

```ts
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      sessionId: params.sessionId,
      mode: "gemini_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText: result.error,
      success: false,
      suppressMessage: params.suppressChatMessages,
    });
```

Second call site, in the polling completion block (currently around line 99):

```ts
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      sessionId: params.sessionId,
      mode: "gemini_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText,
      success,
      rawEvent: progress.rawOutput,
      resumeSessionId: params.resumeSessionId,
      suppressMessage: params.suppressChatMessages,
    });
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test 2>&1 | tail -40`
Expected: every existing test continues to pass; the two new service tests from Tasks 1 and 2 pass.

- [ ] **Step 4: Type-check the project**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: clean output (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/modules/codex/controller.ts src/modules/gemini/controller.ts
git commit -m "feat(controllers): forward suppressChatMessages to history persistence"
```

---

## Phase 2 — Legacy backstop filter

### Task 4: Create the `silentTurnFilter` module with TDD

**Files:**
- Create: `src/modules/session/silentTurnFilter.ts`
- Create: `test/silentTurnFilter.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `test/silentTurnFilter.test.ts`:

```ts
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { isLikelySilentToolMessage } from "../src/modules/session/silentTurnFilter";
import type { MessageRecord } from "../src/modules/message/types";

function buildAssistant(text: string): MessageRecord {
  return {
    id: "msg-1",
    role: "assistant",
    text,
    createdAt: "2026-04-15T00:00:00.000Z",
    sourceMode: "codex_cli",
    status: "done",
  };
}

function buildUser(text: string): MessageRecord {
  return {
    id: "msg-1",
    role: "user",
    text,
    createdAt: "2026-04-15T00:00:00.000Z",
    sourceMode: "codex_cli",
    status: "done",
  };
}

test("plain prose assistant message is not flagged as silent tool output", () => {
  const record = buildAssistant(
    "The paper argues that joint optimization beats sequential tuning.",
  );
  assert.equal(isLikelySilentToolMessage(record), false);
});

test("bare mastery question JSON line is flagged", () => {
  const record = buildAssistant(
    '{"question":"why?","topic":"x","difficulty":"foundational"}',
  );
  assert.equal(isLikelySilentToolMessage(record), true);
});

test("reasoning prose followed by a JSON object line with mastery keys is flagged", () => {
  const record = buildAssistant(
    [
      "현재 열린 논문 기준으로 질문을 만들어야 하니 본문을 다시 확인하겠습니다.",
      '{"understood":false,"confidence":0.99,"evaluation":"답변이 부족합니다."}',
    ].join("\n"),
  );
  assert.equal(isLikelySilentToolMessage(record), true);
});

test("artifact card JSON with kind/summary keys is flagged", () => {
  const record = buildAssistant(
    '{"kind":"research-brief","summary":"Overview","sections":[]}',
  );
  assert.equal(isLikelySilentToolMessage(record), true);
});

test("markdown code-fenced JSON example is not flagged", () => {
  const record = buildAssistant(
    [
      "Here is what the response shape looks like:",
      "```json",
      '{"question":"sample"}',
      "```",
    ].join("\n"),
  );
  assert.equal(isLikelySilentToolMessage(record), false);
});

test("user message containing JSON-shaped text is never flagged", () => {
  const record = buildUser(
    '{"question":"can you answer this?","topic":"y","difficulty":"foundational"}',
  );
  assert.equal(isLikelySilentToolMessage(record), false);
});

test("assistant message with only the word ok is not flagged", () => {
  assert.equal(isLikelySilentToolMessage(buildAssistant("ok")), false);
});

test("assistant message whose JSON line lacks any tool key is not flagged", () => {
  const record = buildAssistant('{"unrelated":"value","other":42}');
  assert.equal(isLikelySilentToolMessage(record), false);
});
```

- [ ] **Step 2: Run the test to verify it fails on missing module**

Run: `node --require ts-node/register --test test/silentTurnFilter.test.ts 2>&1 | tail -20`
Expected: failure on `Cannot find module '../src/modules/session/silentTurnFilter'`.

- [ ] **Step 3: Create the implementation**

Create `src/modules/session/silentTurnFilter.ts`:

```ts
import type { MessageRecord } from "../message/types";

const SILENT_TOOL_KEYS = new Set([
  "question",
  "topic",
  "difficulty",
  "understood",
  "confidence",
  "evaluation",
  "misunderstandings",
  "kind",
  "summary",
  "groups",
]);

function isCodeFenceLine(line: string) {
  return line.startsWith("```");
}

function isPlainObjectShape(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lineLooksLikeSilentToolJson(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }

  if (!isPlainObjectShape(parsed)) {
    return false;
  }

  for (const key of Object.keys(parsed)) {
    if (SILENT_TOOL_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Best-effort detector for assistant messages produced by silent tool turns
 * (mastery, paper-workbench cards, related-recommendation requests) that were
 * persisted by versions before suppressMessage suppression existed.
 *
 * Only inspects assistant messages. Walks lines top-to-bottom and ignores
 * anything inside fenced code blocks so that legitimate JSON examples in chat
 * are not hidden.
 */
export function isLikelySilentToolMessage(record: MessageRecord): boolean {
  if (record.role !== "assistant") {
    return false;
  }

  let insideFence = false;
  for (const line of record.text.split(/\r?\n/)) {
    if (isCodeFenceLine(line.trim())) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) {
      continue;
    }
    if (lineLooksLikeSilentToolJson(line)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test again to verify all cases pass**

Run: `node --require ts-node/register --test test/silentTurnFilter.test.ts 2>&1 | tail -30`
Expected: all eight test cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/session/silentTurnFilter.ts test/silentTurnFilter.test.ts
git commit -m "feat(session-history): add silentTurnFilter for legacy snapshots"
```

---

### Task 5: Wire `silentTurnFilter` into `renderMessageHistory`

**Files:**
- Modify: `src/modules/readerPane.ts` (around lines 2889-2907 — the `renderMessageHistory` function and its imports near the top)

- [ ] **Step 1: Add the import near the existing session-related imports**

Edit `src/modules/readerPane.ts`. Find the existing import line `import { sessionHistoryService } from "./session/sessionHistoryService";` (around line 39) and add a sibling import beneath it:

```ts
import { sessionHistoryService } from "./session/sessionHistoryService";
import { isLikelySilentToolMessage } from "./session/silentTurnFilter";
```

- [ ] **Step 2: Update `renderMessageHistory` to filter legacy silent messages**

Locate the function (around line 2889) and replace the body to filter out silent tool messages before rendering:

```ts
function renderMessageHistory(
  chatMessages: HTMLElement,
  sessionId: string,
  placeholderResponse: string,
) {
  const messages = messageStore
    .list(sessionId)
    .filter((message) => !isLikelySilentToolMessage(message));

  if (!messages.length) {
    renderHelpState(chatMessages, placeholderResponse);
    return;
  }

  for (const message of messages) {
    addMessage(
      chatMessages,
      message.status === "error" ? `Error: ${message.text}` : message.text,
      message.role === "assistant" ? "ai" : "user",
    );
  }
}
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: clean.

Run: `npm test 2>&1 | tail -30`
Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/readerPane.ts
git commit -m "feat(reader-pane): filter legacy silent turns from chat history"
```

---

## Phase 3 — "Past sessions" popover UI

### Task 6: Convert `.pp-session-history` from inline panel to absolutely-positioned popover

**Files:**
- Modify: `addon/chrome/content/zoteroPane.css:210-305`

- [ ] **Step 1: Make the session bar a positioning context**

Edit `addon/chrome/content/zoteroPane.css`. Locate the existing `#paper-pilot-session-bar` block (around line 210). Add `position: relative;`:

```css
#paper-pilot-session-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 0 10px;
  position: relative;
}
```

- [ ] **Step 2: Rewrite `.pp-session-history` block as a popover surface**

Replace the existing `.pp-session-history { ... }` block (currently lines ~230-239) with:

```css
.pp-session-history {
  position: absolute;
  top: calc(100% + 4px);
  right: 10px;
  z-index: 50;
  min-width: 280px;
  max-width: calc(100% - 20px);
  max-height: 320px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--pp-border-light);
  border-radius: var(--pp-radius-md);
  background: var(--pp-bg-secondary);
  box-shadow: var(--pp-shadow-sm);
}
```

- [ ] **Step 3: Replace the row-flex helper block to be vertical with single-line items**

Replace the existing flex helper block:

```css
.pp-session-history__header,
.pp-session-history__item,
.pp-session-history__row-actions,
.pp-session-history__actions,
.pp-session-history__item-header,
.pp-session-history__badges {
  display: flex;
  gap: 8px;
  align-items: center;
}

.pp-session-history__header,
.pp-session-history__item {
  justify-content: space-between;
}
```

with:

```css
.pp-session-history__header,
.pp-session-history__actions,
.pp-session-history__item-header,
.pp-session-history__row-actions,
.pp-session-history__badges {
  display: flex;
  gap: 6px;
  align-items: center;
}

.pp-session-history__item {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-top: 1px solid var(--pp-border-light);
  min-width: 0;
}

.pp-session-history__header {
  justify-content: space-between;
}
```

- [ ] **Step 4: Add styles for the new info column and kebab menu**

Append these new rules to the same section (after the existing `.pp-session-history__rename-input` block):

```css
.pp-session-history__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pp-session-history__item-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-session-history__meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-session-history__row-actions {
  flex-shrink: 0;
}

.pp-session-history__kebab {
  position: relative;
}

.pp-session-history__kebab-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 60;
  min-width: 120px;
  padding: 4px;
  border: 1px solid var(--pp-border-light);
  border-radius: var(--pp-radius-md);
  background: var(--pp-bg-primary);
  box-shadow: var(--pp-shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pp-session-history__kebab-menu button {
  text-align: left;
}
```

- [ ] **Step 5: Sanity-check the build**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add addon/chrome/content/zoteroPane.css
git commit -m "style(session-history): convert past-sessions panel to popover"
```

---

### Task 7: Refactor `renderSessionHistory` rows to single-line + kebab menu

**Files:**
- Modify: `src/modules/readerPane.ts:464-465, 532-744` (the closure-scoped state and the `renderSessionHistory` function)

- [ ] **Step 1: Add a `dismissPopoverHandlers` slot in the closure-scoped state**

Edit `src/modules/readerPane.ts`. Locate the existing two lines (around line 464):

```ts
        let sessionHistoryOpen = false;
        let renamingSessionId: string | undefined;
```

Add a third slot directly below them:

```ts
        let sessionHistoryOpen = false;
        let renamingSessionId: string | undefined;
        let dismissPopoverHandlers: (() => void) | undefined;
```

This is referenced by the rewritten `renderSessionHistory` in the next step (close path) and by Task 8's outside-click installer.

- [ ] **Step 2: Replace the entire `renderSessionHistory` function with a single-line, kebab-menu version**

Edit `src/modules/readerPane.ts`. Locate the `const renderSessionHistory = async () => { ... };` definition (around line 532). Replace its full body with:

```ts
        const renderSessionHistory = async () => {
          const entries = await sessionHistoryService.listSavedSessions({
            itemID: item.id,
          });
          pastSessionsButton.textContent = entries.length
            ? `Past sessions (${entries.length})`
            : "Past sessions";
          pastSessionsButton.setAttribute(
            "aria-expanded",
            sessionHistoryOpen ? "true" : "false",
          );

          if (!sessionHistoryOpen) {
            sessionHistoryPanel.style.display = "none";
            sessionHistoryPanel.replaceChildren();
            renamingSessionId = undefined;
            dismissPopoverHandlers?.();
            dismissPopoverHandlers = undefined;
            return;
          }

          const doc = sessionHistoryPanel.ownerDocument;
          sessionHistoryPanel.style.display = "block";
          sessionHistoryPanel.replaceChildren();

          const header = doc.createElement("div");
          header.className = "pp-session-history__header";

          const title = doc.createElement("div");
          title.className = "pp-session-history__title";
          title.textContent = "Past sessions";
          header.appendChild(title);

          const headerActions = doc.createElement("div");
          headerActions.className = "pp-session-history__actions";

          if (entries.length) {
            const deleteAllButton = doc.createElement("button");
            deleteAllButton.type = "button";
            deleteAllButton.className = "pp-btn pp-btn--ghost";
            deleteAllButton.textContent = "Delete all";
            deleteAllButton.addEventListener("click", async () => {
              if (
                !confirmDestructive(
                  pastSessionsButton.ownerDocument,
                  "Delete all sessions",
                  "Delete all saved sessions for this paper? This cannot be undone.",
                )
              ) {
                return;
              }
              await clearBlankSessionState();
              await sessionHistoryService.deleteAllSavedSessions({
                itemID: item.id,
              });
              sessionHistoryOpen = false;
              await rerenderPane();
            });
            headerActions.appendChild(deleteAllButton);
          }

          header.appendChild(headerActions);
          sessionHistoryPanel.appendChild(header);

          if (!entries.length) {
            const emptyState = doc.createElement("div");
            emptyState.className = "pp-session-history__empty";
            emptyState.textContent = "No saved sessions for this paper yet.";
            sessionHistoryPanel.appendChild(emptyState);
            return;
          }

          const currentSessionId = addon.data.currentSessionId;

          for (const entry of entries) {
            const row = doc.createElement("div");
            row.className = "pp-session-history__item";
            row.title = `Created ${new Date(entry.createdAt).toLocaleString()}`;

            const info = doc.createElement("div");
            info.className = "pp-session-history__info";

            const titleRow = doc.createElement("div");
            titleRow.className = "pp-session-history__item-header";

            if (renamingSessionId === entry.sessionId) {
              const renameInput = doc.createElement("input");
              renameInput.className = "pp-session-history__rename-input";
              renameInput.value = entry.title;
              titleRow.appendChild(renameInput);

              const saveRenameButton = doc.createElement("button");
              saveRenameButton.type = "button";
              saveRenameButton.className = "pp-btn pp-btn--secondary";
              saveRenameButton.textContent = "Save";
              saveRenameButton.addEventListener("click", async () => {
                await sessionHistoryService.renameSavedSession({
                  itemID: item.id,
                  sessionId: entry.sessionId,
                  title: renameInput.value,
                });
                renamingSessionId = undefined;
                await renderSessionHistory();
              });
              titleRow.appendChild(saveRenameButton);

              const cancelRenameButton = doc.createElement("button");
              cancelRenameButton.type = "button";
              cancelRenameButton.className = "pp-btn pp-btn--ghost";
              cancelRenameButton.textContent = "Cancel";
              cancelRenameButton.addEventListener("click", async () => {
                renamingSessionId = undefined;
                await renderSessionHistory();
              });
              titleRow.appendChild(cancelRenameButton);
            } else {
              const entryTitle = doc.createElement("div");
              entryTitle.className = "pp-session-history__item-title";
              entryTitle.textContent = entry.title;
              titleRow.appendChild(entryTitle);

              if (currentSessionId === entry.sessionId) {
                const currentBadge = doc.createElement("span");
                currentBadge.className = "pp-session-history__badge";
                currentBadge.textContent = "Current";
                titleRow.appendChild(currentBadge);
              }

              if (
                entry.hasArtifacts ||
                entry.hasRecommendations ||
                entry.hasMasteryState
              ) {
                const cardsBadge = doc.createElement("span");
                cardsBadge.className = "pp-session-history__badge";
                cardsBadge.textContent = "●";
                cardsBadge.setAttribute(
                  "aria-label",
                  "Has saved cards, recommendations, or mastery state",
                );
                titleRow.appendChild(cardsBadge);
              }
            }

            info.appendChild(titleRow);

            const meta = doc.createElement("div");
            meta.className = "pp-session-history__meta";
            meta.textContent = [
              `Updated ${new Date(entry.updatedAt).toLocaleString()}`,
              `${entry.messageCount} msg${entry.messageCount === 1 ? "" : "s"}`,
              entry.lastMode === "gemini_cli" ? "Gemini" : "Codex",
            ].join(" · ");
            info.appendChild(meta);

            row.appendChild(info);

            if (renamingSessionId === entry.sessionId) {
              sessionHistoryPanel.appendChild(row);
              continue;
            }

            const rowActions = doc.createElement("div");
            rowActions.className = "pp-session-history__row-actions";

            const openButton = doc.createElement("button");
            openButton.type = "button";
            openButton.className = "pp-btn pp-btn--secondary";
            openButton.textContent = "Open";
            openButton.disabled = currentSessionId === entry.sessionId;
            openButton.addEventListener("click", async () => {
              await clearSessionRuntimeState();
              await sessionHistoryService.openSavedSession({
                itemID: item.id,
                sessionId: entry.sessionId,
              });
              input.value = "";
              sessionHistoryOpen = false;
              renamingSessionId = undefined;
              await rerenderPane();
            });
            rowActions.appendChild(openButton);

            const kebabContainer = doc.createElement("div");
            kebabContainer.className = "pp-session-history__kebab";

            const kebabButton = doc.createElement("button");
            kebabButton.type = "button";
            kebabButton.className = "pp-btn pp-btn--ghost";
            kebabButton.textContent = "⋯";
            kebabButton.setAttribute(
              "aria-label",
              `More actions for session "${entry.title}"`,
            );

            let kebabMenu: HTMLElement | undefined;
            const closeKebab = () => {
              kebabMenu?.remove();
              kebabMenu = undefined;
            };

            kebabButton.addEventListener("click", (event) => {
              event.stopPropagation();
              if (kebabMenu) {
                closeKebab();
                return;
              }

              kebabMenu = doc.createElement("div");
              kebabMenu.className = "pp-session-history__kebab-menu";

              const renameItem = doc.createElement("button");
              renameItem.type = "button";
              renameItem.className = "pp-btn pp-btn--ghost";
              renameItem.textContent = "Rename";
              renameItem.addEventListener("click", async (renameEvent) => {
                renameEvent.stopPropagation();
                closeKebab();
                renamingSessionId = entry.sessionId;
                await renderSessionHistory();
              });
              kebabMenu.appendChild(renameItem);

              const deleteItem = doc.createElement("button");
              deleteItem.type = "button";
              deleteItem.className = "pp-btn pp-btn--ghost";
              deleteItem.textContent = "Delete";
              deleteItem.addEventListener("click", async (deleteEvent) => {
                deleteEvent.stopPropagation();
                closeKebab();
                if (
                  !confirmDestructive(
                    pastSessionsButton.ownerDocument,
                    "Delete session",
                    `Delete session "${entry.title}"? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                const deletingCurrent =
                  addon.data.currentSessionId === entry.sessionId;
                if (deletingCurrent) {
                  await clearSessionRuntimeState();
                }
                await sessionHistoryService.deleteSavedSession({
                  itemID: item.id,
                  sessionId: entry.sessionId,
                });
                if (deletingCurrent) {
                  resetBlankSessionState();
                }
                renamingSessionId = undefined;
                await rerenderPane();
              });
              kebabMenu.appendChild(deleteItem);

              kebabContainer.appendChild(kebabMenu);
            });

            kebabContainer.appendChild(kebabButton);
            rowActions.appendChild(kebabContainer);

            row.appendChild(rowActions);
            sessionHistoryPanel.appendChild(row);
          }
        };
```

- [ ] **Step 2: Add a small `confirmDestructive` helper near the top of the file**

Find the existing helper functions area (above `function renderHelpState`, around line 2870-2880). Insert this helper:

```ts
function confirmDestructive(
  ownerDocument: Document,
  title: string,
  message: string,
): boolean {
  const services = (
    globalThis as {
      Services?: { prompt?: { confirm?: (...args: unknown[]) => boolean } };
    }
  ).Services;
  const win = ownerDocument.defaultView ?? null;
  const promptConfirm = services?.prompt?.confirm;
  if (typeof promptConfirm === "function") {
    try {
      return Boolean(promptConfirm(win, title, message));
    } catch {
      // fall through to window.confirm
    }
  }
  if (win && typeof win.confirm === "function") {
    return win.confirm(`${title}\n\n${message}`);
  }
  return true;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 4: Run tests to ensure no regression**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/readerPane.ts
git commit -m "feat(session-history-ui): single-line rows with kebab menu and confirms"
```

---

### Task 8: Add outside-click + Escape close handlers and focus restore

**Files:**
- Modify: `src/modules/readerPane.ts` — the area that wires the `pastSessionsButton` click handler (around line 954)

- [ ] **Step 1: Replace the current `pastSessionsButton.addEventListener("click", ...)` block with a version that also installs document-level outside-click and Escape listeners**

Locate the current handler (around line 954):

```ts
        pastSessionsButton.addEventListener("click", async () => {
          sessionHistoryOpen = !sessionHistoryOpen;
          ...
          await renderSessionHistory();
        });
```

Replace it with the following block. (Note: `dismissPopoverHandlers` is the closure-scoped slot already declared in Task 7 Step 1; this task only assigns to it.)

```ts
        const closeSessionHistoryPopover = async (
          options?: { restoreFocus?: boolean },
        ) => {
          sessionHistoryOpen = false;
          renamingSessionId = undefined;
          await renderSessionHistory();
          if (options?.restoreFocus) {
            pastSessionsButton.focus();
          }
        };

        const installPopoverDismissHandlers = () => {
          const ownerDoc = pastSessionsButton.ownerDocument;
          const onDocumentClick = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
              return;
            }
            if (
              sessionHistoryPanel.contains(target) ||
              pastSessionsButton.contains(target)
            ) {
              return;
            }
            void closeSessionHistoryPopover();
          };
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
              event.preventDefault();
              void closeSessionHistoryPopover({ restoreFocus: true });
            }
          };

          ownerDoc.addEventListener("mousedown", onDocumentClick, true);
          ownerDoc.addEventListener("keydown", onKeyDown, true);

          dismissPopoverHandlers = () => {
            ownerDoc.removeEventListener("mousedown", onDocumentClick, true);
            ownerDoc.removeEventListener("keydown", onKeyDown, true);
          };
        };

        pastSessionsButton.addEventListener("click", async () => {
          sessionHistoryOpen = !sessionHistoryOpen;
          renamingSessionId = undefined;
          if (sessionHistoryOpen) {
            installPopoverDismissHandlers();
          }
          await renderSessionHistory();
        });
```

Note: when `sessionHistoryOpen` becomes `false`, `renderSessionHistory` itself runs the cleanup (`dismissPopoverHandlers?.(); dismissPopoverHandlers = undefined;`) per Task 7 Step 2. So toggling closed via the trigger button automatically removes listeners.

- [ ] **Step 2: Type-check and run tests**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean.

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/readerPane.ts
git commit -m "feat(session-history-ui): outside-click and Escape close popover"
```

---

## Phase 4 — Verify and document

### Task 9: Update manual QA notes for the new behaviors

**Files:**
- Modify: `docs/manual-qa.md`

- [ ] **Step 1: Read the existing file to find the session-history section**

Run: `grep -n "session" docs/manual-qa.md | head -20`
Expected: shows existing session-related QA bullets near the top of the file.

- [ ] **Step 2: Append a new "Session history popover and silent-turn QA" subsection**

Edit `docs/manual-qa.md`. Append at the end of the file:

```md

## Session history popover and silent-turn QA (2026-04-15)

After running mastery and one or more workbench tools (research brief, contributions, limitations, follow-ups, paper compare) on a paper, then opening "Past sessions":

- The popover anchors below the "Past sessions" button and does NOT push the chat down.
- Clicking outside the popover or pressing Escape closes it. Escape returns focus to the trigger button.
- Each row is a single line: title (with optional Current / cards-saved badges), meta line, an Open button, and a kebab (⋯) button. Rename and Delete live inside the kebab menu.
- Delete and Delete all show a confirmation dialog. Cancel keeps the data.
- Reopening a session that previously ran mastery / workbench tools shows the natural chat transcript in the message list (prose markdown), with NO raw JSON lines.
- Mastery cards, workbench cards, and recommendation groups still rehydrate when the session is reopened (existing behavior).
- After opening a saved session, sending a fresh chat message continues to work end-to-end with both Codex CLI and Gemini CLI.
```

- [ ] **Step 3: Commit**

```bash
git add docs/manual-qa.md
git commit -m "docs(qa): document session history popover and silent-turn checks"
```

---

### Task 10: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: all tests pass, including the new `silentTurnFilter` and `sessionHistoryService` cases.

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 3: Build the addon**

Run: `npm run build 2>&1 | tail -30`
Expected: build completes successfully.

- [ ] **Step 4: Inspect the final commit log on this branch**

Run: `git log --oneline main..HEAD`
Expected: a chronological set of commits matching the tasks above:

1. `feat(session-history): suppress silent assistant turns on active branch`
2. `feat(session-history): suppress silent assistant turns on late branch`
3. `feat(controllers): forward suppressChatMessages to history persistence`
4. `feat(session-history): add silentTurnFilter for legacy snapshots`
5. `feat(reader-pane): filter legacy silent turns from chat history`
6. `style(session-history): convert past-sessions panel to popover`
7. `feat(session-history-ui): single-line rows with kebab menu and confirms`
8. `feat(session-history-ui): outside-click and Escape close popover`
9. `docs(qa): document session history popover and silent-turn checks`

- [ ] **Step 5: Notify the user the plan is complete**

Tell the user the implementation is complete on the current branch and ready for manual smoke testing inside Zotero. Reference the manual QA bullets in `docs/manual-qa.md` for the checklist.
