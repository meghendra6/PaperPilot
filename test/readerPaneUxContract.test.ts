import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

const readerPaneSource = readFileSync(
  join(process.cwd(), "src", "modules", "readerPane.ts"),
  "utf8",
);
const paneHeaderSource = readFileSync(
  join(process.cwd(), "src", "modules", "ui", "paneHeader.ts"),
  "utf8",
);
const paneStyleSource = readFileSync(
  join(process.cwd(), "addon", "chrome", "content", "zoteroPane.css"),
  "utf8",
);

test("reader pane exposes conversation and progress updates to assistive technology", () => {
  assert.match(
    readerPaneSource,
    /id="chat-messages" role="log" aria-live="polite"/,
  );
  assert.match(
    readerPaneSource,
    /id="chat-streaming-indicator"[^>]*role="status"[^>]*aria-live="polite"/,
  );
  assert.match(
    readerPaneSource,
    /id="chat-compare-helper"[^>]*role="status"[^>]*aria-live="polite"/,
  );
});

test("empty chat guidance is separate from the conversation and clears on first input", () => {
  assert.match(readerPaneSource, /help\.dataset\.ppChatHelp = "true"/);
  assert.match(
    readerPaneSource,
    /querySelector\('\[data-pp-chat-help="true"\]'\)[\s\S]*?\.remove\(\)/,
  );
});

test("engine settings move focus into the dialog when opened", () => {
  assert.match(paneHeaderSource, /popover\.tabIndex = -1/);
  assert.match(paneHeaderSource, /if \(open\) \{[\s\S]*?popover\.focus\(\)/);
});

test("model picker selection is not preempted by document mousedown", () => {
  assert.match(
    paneHeaderSource,
    /doc\.addEventListener\("click", onDocumentClick\)/,
  );
  assert.doesNotMatch(
    paneHeaderSource,
    /doc\.addEventListener\("mousedown",[^\n]*onDocument/,
  );
});

test("reader pane exposes adjustable workspace, section, and overall heights", () => {
  assert.match(readerPaneSource, /label: "Resize Workbench and chat areas"/);
  assert.match(readerPaneSource, /label: "Resize Paper Pilot pane"/);
  assert.match(
    readerPaneSource,
    /initialBodyHeight: paneLayout\.sectionBodyHeights\.workbench/,
  );
  assert.match(
    readerPaneSource,
    /initialBodyHeight: paneLayout\.sectionBodyHeights\.related/,
  );
  assert.match(
    readerPaneSource,
    /initialBodyHeight: paneLayout\.sectionBodyHeights\.sessions/,
  );
});

test("chat composer keeps the Send control inset without covering text", () => {
  assert.match(
    paneStyleSource,
    /#chat-input-shell \{[\s\S]*?position: relative;/,
  );
  assert.match(
    paneStyleSource,
    /#chat-input \{[\s\S]*?padding: 10px 78px 10px 12px;/,
  );
  assert.match(
    paneStyleSource,
    /#chat-send \{[\s\S]*?position: absolute;[\s\S]*?right: 12px;[\s\S]*?bottom: 12px;/,
  );
});

test("run events keep the live transcript while a run is active", () => {
  assert.match(
    readerPaneSource,
    /void rerenderPane\(\{\s*renderTranscript: !getActiveReaderRunMode\(item\.id\),?\s*\}\)/,
  );
  assert.match(
    readerPaneSource,
    /window\.showMessage\(position\.key, position\.offset, \{ focus: false \}\)/,
  );
});

test("session rename keeps its draft and supports the keyboard", () => {
  assert.match(
    readerPaneSource,
    /renameInput\.setAttribute\("aria-label", "Session name"\)/,
  );
  assert.match(
    readerPaneSource,
    /renameDraft\?\.sessionId === entry\.sessionId/,
  );
  assert.match(
    readerPaneSource,
    /event\.key === "Enter"[\s\S]*?saveRename\(\)/,
  );
  assert.match(
    readerPaneSource,
    /event\.key === "Escape"[\s\S]*?cancelRename\(\)/,
  );
});

const workbenchSource = readFileSync(
  join(process.cwd(), "src", "modules", "ui", "readerWorkbench.ts"),
  "utf8",
);
const readerActionsSource = readFileSync(
  join(process.cwd(), "src", "modules", "readerActions.ts"),
  "utf8",
);

// Source contracts for DOM wiring only. Pure decisions have unit tests.
// Real focus, popover, and timing behavior needs manual Zotero QA.
test("Workbench requests refresh their busy state on every run event", () => {
  assert.match(
    readerPaneSource,
    /subscribeToReaderRunEvents\([\s\S]*?renderBusyDependentControls\(\);/,
  );
  assert.match(workbenchSource, /readerBusy: isReaderChatBusy\(itemID\)/);
  for (const button of [
    "researchBriefButton",
    "contributionsButton",
    "limitationsButton",
    "followUpsButton",
    "compareButton",
  ]) {
    assert.match(
      readerPaneSource,
      new RegExp(
        `${button}\\.addEventListener\\("click", async \\(\\) => \\{\\s*if \\(isWorkbenchRequestBlocked\\(\\)\\) return;`,
      ),
    );
  }
});

test("discovery entry points honor engine capability and never click the toggle", () => {
  assert.doesNotMatch(readerPaneSource, /relatedRecommendButton\.click\(\)/);
  assert.match(readerPaneSource, /id="chat-related-availability"/);
  assert.match(
    workbenchSource,
    /findPriorWork\.disabled = true;\s*findPriorWork\.title = options\.discoveryUnavailableReason;/,
  );
  assert.match(
    readerActionsSource,
    /action === "find-prior-work"[\s\S]*?getDiscoveryAvailability/,
  );
});

test("highlighting can be cancelled and announces its status", () => {
  assert.match(
    readerPaneSource,
    /id="chat-auto-highlight-status"[^>]*role="status"[^>]*aria-live="polite"/,
  );
  assert.match(readerPaneSource, /signal: abortController\.signal,/);
  assert.match(readerPaneSource, /AUTO_HIGHLIGHT_CANCELLED_STATUS/);
});

test("composer guards Stop after Send and explains swallowed submits", () => {
  assert.match(
    readerPaneSource,
    /shouldIgnoreStopActivation\(\{[\s\S]*?clickDetail: event\.detail,/,
  );
  assert.match(
    readerPaneSource,
    /id="chat-composer-hint"[^>]*role="status"[^>]*aria-live="polite"/,
  );
  assert.match(
    readerPaneSource,
    /if \(chatTools\.submitSlashCommand\(\)\) return;\s*if \(isReaderChatBusy\(item\.id\)\) \{[\s\S]*?showComposerHint\(/,
  );
  assert.match(
    readerPaneSource,
    /input\.addEventListener\("keydown", async \(e\) => \{\s*if \(e\.defaultPrevented\) return;/,
  );
});

test("engine settings expose pressed state, saved defaults, and in-popover auth help", () => {
  assert.match(
    paneHeaderSource,
    /modeClaudeButton\.setAttribute\("aria-pressed"/,
  );
  assert.match(
    paneHeaderSource,
    /modeCodexButton\.setAttribute\("aria-pressed"/,
  );
  assert.match(paneHeaderSource, /"Default model \(all papers\)"/);
  assert.match(
    paneHeaderSource,
    /modelInput\.addEventListener\("change", onModelSelectionChange\)/,
  );
  assert.match(
    paneHeaderSource,
    /if \(!open && !popover\.hidden\) resetUnsavedModelSelection\(\);/,
  );
  assert.match(paneHeaderSource, /createNativeSelectClickGuard\(\[/);
  assert.match(readerPaneSource, /renderEngineSelection\(params\.modeChip, \{/);
  assert.match(readerPaneSource, /paneHeader\.setCodexAuthStatus\(/);
  assert.doesNotMatch(
    readerPaneSource,
    /addMessage\(\s*chatMessages,\s*buildCodexAuthenticateMessage/,
  );
});

test("Clear cards confirms and persists, and Focus chat keeps its name", () => {
  assert.match(
    readerPaneSource,
    /clearWorkbenchButton\.addEventListener\("click", async \(\) => \{[\s\S]*?confirmDestructive\([\s\S]*?persistActiveSession/,
  );
  assert.doesNotMatch(readerPaneSource, /"Show workbench"/);
  assert.match(paneStyleSource, /\.pp-chat-focus\[aria-pressed="true"\]/);
});

test("the draft card does not expose internal attachment IDs", () => {
  assert.doesNotMatch(readerPaneSource, /PDF \$\{context\.attachmentID/);
  assert.match(readerPaneSource, /formatDraftSourceLabel\(\{/);
});
