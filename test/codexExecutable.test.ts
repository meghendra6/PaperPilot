import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  chooseBestCodexExecutable,
  parseCodexVersion,
} from "../src/modules/codex/executableSelection";
import {
  buildCodexCommandEnvironment,
  resolveCodexUserHome,
} from "../src/modules/codex/environment";
import { classifyCodexLoginFailure } from "../src/modules/codex/statusClassification";

test("parseCodexVersion extracts semantic versions from codex output", () => {
  assert.deepEqual(parseCodexVersion("codex-cli 0.111.0"), [0, 111, 0]);
  assert.equal(parseCodexVersion("no version here"), undefined);
});

test("chooseBestCodexExecutable prefers a logged-in newer NVM binary over legacy Homebrew", () => {
  const best = chooseBestCodexExecutable([
    {
      path: "/opt/homebrew/bin/codex",
      source: "homebrew",
      version: "codex-cli 0.45.0",
      loginStatus:
        "Error loading configuration: unknown variant `xhigh`, expected one of `minimal`, `low`, `medium`, `high`",
      versionOk: true,
      loginOk: false,
    },
    {
      path: "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
      source: "nvm",
      version: "codex-cli 0.111.0",
      loginStatus: "Logged in using ChatGPT",
      versionOk: true,
      loginOk: true,
    },
  ]);

  assert.equal(
    best?.path,
    "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
  );
});

test("chooseBestCodexExecutable does not stick to an explicitly configured stale binary", () => {
  const best = chooseBestCodexExecutable([
    {
      path: "/opt/homebrew/bin/codex",
      source: "configured",
      version: "codex-cli 0.45.0",
      loginStatus:
        "Error loading configuration: unknown variant `xhigh`, expected one of `minimal`, `low`, `medium`, `high`",
      versionOk: true,
      loginOk: false,
    },
    {
      path: "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
      source: "nvm",
      version: "codex-cli 0.111.0",
      loginStatus: "Logged in using ChatGPT",
      versionOk: true,
      loginOk: true,
    },
  ]);

  assert.equal(
    best?.path,
    "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
  );
});

test("chooseBestCodexExecutable prefers higher versions when login state is equal", () => {
  const best = chooseBestCodexExecutable([
    {
      path: "/usr/local/bin/codex",
      source: "usr-local",
      version: "codex-cli 0.45.0",
      loginStatus: "Logged in using ChatGPT",
      versionOk: true,
      loginOk: true,
    },
    {
      path: "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
      source: "nvm",
      version: "codex-cli 0.111.0",
      loginStatus: "Logged in using ChatGPT",
      versionOk: true,
      loginOk: true,
    },
  ]);

  assert.equal(
    best?.path,
    "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
  );
});

test("classifyCodexLoginFailure treats explicit login guidance as login_required", () => {
  assert.equal(
    classifyCodexLoginFailure(
      "Run 'codex login' in your terminal, then click Re-check status.",
    ),
    "login_required",
  );
});

test("classifyCodexLoginFailure treats config parse failures as unavailable", () => {
  assert.equal(
    classifyCodexLoginFailure(
      "Error loading configuration: unknown variant `xhigh`, expected one of `minimal`, `low`, `medium`, `high`",
    ),
    "unavailable",
  );
});

test("classifyCodexLoginFailure treats legacy exec flag errors as unavailable", () => {
  assert.equal(
    classifyCodexLoginFailure(
      "error: unexpected argument '--ask-for-approval' found",
    ),
    "unavailable",
  );
});

test("resolveCodexUserHome derives the macOS home path from the Zotero profile path", () => {
  assert.equal(
    resolveCodexUserHome(
      "/Users/meghendra/Library/Application Support/Zotero/Profiles/abcd.default",
    ),
    "/Users/meghendra",
  );
});

test("buildCodexCommandEnvironment prepends the executable directory so codex shims can find node", () => {
  const environment = buildCodexCommandEnvironment(
    "/opt/homebrew/bin/codex",
    "/Users/meghendra/Library/Application Support/Zotero/Profiles/abcd.default",
  );

  assert.equal(environment.HOME, "/Users/meghendra");
  assert.equal(environment.XDG_CONFIG_HOME, "/Users/meghendra/.config");
  assert.match(environment.PATH || "", /^\/opt\/homebrew\/bin:/);
  assert.match(environment.PATH || "", /\/usr\/bin/);
});
