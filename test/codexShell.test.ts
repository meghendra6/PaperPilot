import { test } from "node:test";
import * as assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import {
  buildBackgroundCodexShellScript,
  shellExportLine,
} from "../src/modules/codex/shell";
import { checkShellSyntax } from "./helpers/shellSyntax";

test("buildBackgroundCodexShellScript exports environment before running codex", () => {
  const script = buildBackgroundCodexShellScript({
    promptPath: "/tmp/prompt.txt",
    outputPath: "/tmp/out.jsonl",
    stderrPath: "/tmp/stderr.log",
    exitCodePath: "/tmp/exit.txt",
    pidPath: "/tmp/pid.txt",
    command: ["/opt/homebrew/bin/codex", "exec", "-"],
    environment: {
      HOME: "/Users/meghendra",
      XDG_CONFIG_HOME: "/Users/meghendra/.config",
      PATH: "/Users/meghendra/.nvm/versions/node/v20.16.0/bin:/usr/bin:/bin",
    },
  });

  assert.match(script, /export HOME='\/Users\/meghendra'/);
  assert.match(script, /export XDG_CONFIG_HOME='\/Users\/meghendra\/\.config'/);
  assert.match(
    script,
    /export PATH='\/Users\/meghendra\/\.nvm\/versions\/node\/v20\.16\.0\/bin:\/usr\/bin:\/bin'/,
  );
  assert.match(script, /2> '\/tmp\/stderr\.log'/);
  assert.match(
    script,
    /cat '\/tmp\/prompt\.txt' \| '\/opt\/homebrew\/bin\/codex' 'exec' '-'/,
  );
});

test("buildBackgroundCodexShellScript quotes paths with apostrophes", () => {
  const script = buildBackgroundCodexShellScript({
    promptPath: "/tmp/Paper Pilot/Smith's paper/prompt.txt",
    outputPath: "/tmp/Paper Pilot/Smith's paper/out.jsonl",
    stderrPath: "/tmp/Paper Pilot/Smith's paper/stderr.log",
    exitCodePath: "/tmp/Paper Pilot/Smith's paper/exit.txt",
    pidPath: "/tmp/Paper Pilot/Smith's paper/pid.txt",
    command: ["/opt/Homebrew Tools/codex's bin/codex", "exec", "-"],
    environment: {
      HOME: "/Users/meghendra/O'Connor",
    },
  });

  const syntax = checkShellSyntax(script);

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(script, /Smith'\\''s paper/);
  assert.match(script, /codex'\\''s bin/);
  assert.match(script, /O'\\''Connor/);
});

test("PATH keeps the fixed CLI directories first and then the login PATH", () => {
  const line = shellExportLine("PATH", "/opt/homebrew/bin:/usr/bin");
  assert.equal(line, `export PATH='/opt/homebrew/bin:/usr/bin':"$PATH"`);
  const result = spawnSync(
    "/bin/sh",
    ["-c", `PATH=/login/only/bin; ${line}; printf '%s' "$PATH"`],
    { encoding: "utf-8" },
  );
  assert.equal(result.stdout, "/opt/homebrew/bin:/usr/bin:/login/only/bin");
  assert.equal(shellExportLine("HOME", "/Users/me"), "export HOME='/Users/me'");
});
