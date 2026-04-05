import { test } from "node:test";
import * as assert from "node:assert/strict";

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
