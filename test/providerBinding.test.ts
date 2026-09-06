import * as assert from "node:assert/strict";
import { test } from "node:test";
import { getVerifiedProviderResume } from "../src/modules/session/providerBinding";
import type { PaperSession } from "../src/modules/session/types";

test("native resume requires the exact observed provider, PaperPilot session and PDF source binding", () => {
  const session: PaperSession = {
    sessionId: "paperpilot-session",
    itemID: 1,
    mode: "claude_code",
    createdAt: "2026-09-07",
    updatedAt: "2026-09-07",
    threadTitle: "Paper",
    lastClaudeSessionID: "observed-provider-id",
  };
  const sourceID = "zotero:1:PAPER:PDF";
  const fingerprint = "original-pdf";
  assert.equal(
    getVerifiedProviderResume(session, "claude_code", sourceID, fingerprint),
    undefined,
  );
  session.providerBindings = {
    claude_code: {
      engine: "claude_code",
      status: "verified",
      sessionId: "observed-provider-id",
      sourceID,
      sourceFingerprint: fingerprint,
      paperpilotSessionId: session.sessionId,
    },
  };
  assert.equal(
    getVerifiedProviderResume(session, "claude_code", sourceID, fingerprint),
    "observed-provider-id",
  );
  assert.equal(
    getVerifiedProviderResume(
      session,
      "claude_code",
      "zotero:1:PAPER:OTHER",
      fingerprint,
    ),
    undefined,
  );
  assert.equal(
    getVerifiedProviderResume(
      { ...session, sessionId: "branch" },
      "claude_code",
      sourceID,
      fingerprint,
    ),
    undefined,
  );
  assert.equal(
    getVerifiedProviderResume(
      { ...session, lastClaudeSessionID: "latest" },
      "claude_code",
      sourceID,
      fingerprint,
    ),
    undefined,
  );
  assert.equal(
    getVerifiedProviderResume(session, "codex_cli", sourceID, fingerprint),
    undefined,
  );
  assert.equal(
    getVerifiedProviderResume(
      session,
      "claude_code",
      sourceID,
      "replacement-pdf",
    ),
    undefined,
  );
  delete session.providerBindings.claude_code!.sourceFingerprint;
  assert.equal(
    getVerifiedProviderResume(session, "claude_code", sourceID, fingerprint),
    undefined,
  );
});
