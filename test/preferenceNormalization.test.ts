import { test } from "node:test";
import * as assert from "node:assert/strict";

import { getDefaultMode, resolveEngineMode } from "../src/modules/ai/modeStore";
import { resolveClaudePermissionMode } from "../src/modules/claude/permissionMode";
import { buildClaudeCommand } from "../src/modules/claude/runner";
import { normalizeCodexApprovalMode } from "../src/modules/codex/commandBuilder";
import {
  getCodexReasoningEffortOptions,
  normalizeCodexReasoningEffort,
} from "../src/modules/codex/modelOptions";
import {
  normalizeCodexSandboxMode,
  resolveCodexSandboxMode,
} from "../src/modules/codex/sandboxMode";

test("default AI mode accepts hand-typed engine names", () => {
  assert.equal(resolveEngineMode("codex_cli"), "codex_cli");
  assert.equal(resolveEngineMode("claude_code"), "claude_code");
  assert.equal(resolveEngineMode("claude"), "claude_code");
  assert.equal(resolveEngineMode(" Claude Code "), "claude_code");
  assert.equal(resolveEngineMode("claude-code"), "claude_code");
  assert.equal(resolveEngineMode("Codex"), "codex_cli");
  assert.equal(resolveEngineMode("codex cli"), "codex_cli");
  assert.equal(resolveEngineMode("gemini_cli"), "codex_cli");
  assert.equal(resolveEngineMode("gpt"), undefined);
  assert.equal(resolveEngineMode(""), undefined);
  assert.equal(resolveEngineMode(undefined), undefined);
});

test("the runtime default mode honors hand-typed engine names", () => {
  const globals = globalThis as { Zotero?: unknown };
  const previous = globals.Zotero;
  try {
    globals.Zotero = { Prefs: { get: () => "claude" } };
    assert.equal(getDefaultMode(), "claude_code");
    globals.Zotero = { Prefs: { get: () => "gpt" } };
    assert.equal(getDefaultMode(), "codex_cli");
  } finally {
    globals.Zotero = previous;
  }
});

test("Claude permission mode accepts case and spacing variants", () => {
  assert.equal(resolveClaudePermissionMode("acceptEdits"), "acceptEdits");
  assert.equal(resolveClaudePermissionMode("acceptedits"), "acceptEdits");
  assert.equal(resolveClaudePermissionMode("Accept Edits"), "acceptEdits");
  assert.equal(resolveClaudePermissionMode("accept-edits"), "acceptEdits");
  assert.equal(
    resolveClaudePermissionMode("bypass_permissions"),
    "bypassPermissions",
  );
  assert.equal(resolveClaudePermissionMode("dont ask"), "dontAsk");
  assert.equal(resolveClaudePermissionMode("PLAN"), "plan");
  assert.equal(resolveClaudePermissionMode("yolo"), undefined);
  assert.equal(resolveClaudePermissionMode(""), undefined);
});

test("Claude command uses the resolved permission mode and keeps the safe fallback", () => {
  const command = (permissionMode: string) =>
    buildClaudeCommand({
      promptPath: "/tmp/p",
      outputPath: "/tmp/out/o",
      stderrPath: "/tmp/out/e",
      exitCodePath: "/tmp/out/x",
      pidPath: "/tmp/out/pid",
      workspacePath: "/tmp/w",
      model: "sonnet",
      executablePath: "claude",
      permissionMode,
    });
  assert.match(command("acceptedits"), /--permission-mode 'acceptEdits'/);
  assert.match(command("yolo"), /--permission-mode 'default'/);
});

test("Codex sandbox mode accepts case and spacing variants", () => {
  assert.equal(resolveCodexSandboxMode("workspace write"), "workspace-write");
  assert.equal(resolveCodexSandboxMode("Workspace_Write"), "workspace-write");
  assert.equal(resolveCodexSandboxMode("Read Only"), "read-only");
  assert.equal(resolveCodexSandboxMode("readonly"), "read-only");
  assert.equal(
    resolveCodexSandboxMode("danger full access"),
    "danger-full-access",
  );
  assert.equal(resolveCodexSandboxMode("full"), undefined);
  assert.equal(normalizeCodexSandboxMode("workspace write"), "workspace-write");
  assert.equal(normalizeCodexSandboxMode("full"), "read-only");
});

test("Codex approval mode accepts case and spacing variants", () => {
  assert.equal(normalizeCodexApprovalMode("On Request"), "on-request");
  assert.equal(normalizeCodexApprovalMode("on_failure"), "on-failure");
  assert.equal(normalizeCodexApprovalMode("NEVER"), "never");
  assert.equal(normalizeCodexApprovalMode("auto edit"), "never");
  assert.equal(normalizeCodexApprovalMode("sometimes"), undefined);
});

test("Codex reasoning effort ignores letter case", () => {
  assert.equal(normalizeCodexReasoningEffort("High", "gpt-6-astra"), "high");
  assert.equal(normalizeCodexReasoningEffort(" XHIGH ", "gpt-6-luna"), "xhigh");
  assert.deepEqual(getCodexReasoningEffortOptions(), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]);
});
