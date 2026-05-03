import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { buildBackgroundCodexShellScript } from "../src/modules/codex/shell";

test("buildBackgroundCodexShellScript exports environment before running codex", () => {
  const script = buildBackgroundCodexShellScript({
    promptPath: "/tmp/prompt.txt",
    outputPath: "/tmp/out.jsonl",
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
  assert.match(
    script,
    /cat '\/tmp\/prompt\.txt' \| '\/opt\/homebrew\/bin\/codex' 'exec' '-'/,
  );
});

test("buildBackgroundCodexShellScript quotes paths with apostrophes", () => {
  const script = buildBackgroundCodexShellScript({
    promptPath: "/tmp/Paper Pilot/Smith's paper/prompt.txt",
    outputPath: "/tmp/Paper Pilot/Smith's paper/out.jsonl",
    exitCodePath: "/tmp/Paper Pilot/Smith's paper/exit.txt",
    pidPath: "/tmp/Paper Pilot/Smith's paper/pid.txt",
    command: ["/opt/Homebrew Tools/codex's bin/codex", "exec", "-"],
    environment: {
      HOME: "/Users/meghendra/O'Connor",
    },
  });

  const syntax = spawnSync("/bin/zsh", ["-n"], {
    input: script,
    encoding: "utf8",
  });

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(script, /Smith'\\''s paper/);
  assert.match(script, /codex'\\''s bin/);
  assert.match(script, /O'\\''Connor/);
});
