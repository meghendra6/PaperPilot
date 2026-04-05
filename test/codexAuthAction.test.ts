import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildCodexAuthenticateMessage } from "../src/modules/codex/authAction";

test("buildCodexAuthenticateMessage reports already-authenticated state", () => {
  assert.match(
    buildCodexAuthenticateMessage("ready"),
    /already authenticated/i,
  );
});

test("buildCodexAuthenticateMessage reports login guidance only when login is required", () => {
  assert.match(buildCodexAuthenticateMessage("login_required"), /codex login/i);
});

test("buildCodexAuthenticateMessage surfaces unavailable diagnostics", () => {
  assert.equal(
    buildCodexAuthenticateMessage(
      "unavailable",
      "Error loading configuration: bad value",
    ),
    "Codex CLI is unavailable: Error loading configuration: bad value",
  );
});
