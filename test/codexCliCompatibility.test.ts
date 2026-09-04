import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import * as assert from "node:assert/strict";

function findCodexBinary() {
  const configuredPath = process.env.PAPERPILOT_CODEX_BIN;
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const whichResult = spawnSync("which", ["codex"], { encoding: "utf-8" });
  const discoveredPath = whichResult.stdout.trim();
  return whichResult.status === 0 && existsSync(discoveredPath)
    ? discoveredPath
    : undefined;
}

test(
  "codex CLI accepts approval flags only before exec",
  {
    skip: !findCodexBinary(),
  },
  () => {
    const codexPath = findCodexBinary();
    assert.ok(codexPath);

    const misplacedFlagResult = spawnSync(
      codexPath,
      ["exec", "--ask-for-approval", "never", "--help"],
      {
        encoding: "utf-8",
      },
    );
    assert.notEqual(misplacedFlagResult.status, 0);
    assert.match(
      misplacedFlagResult.stderr || misplacedFlagResult.stdout,
      /unexpected argument '--ask-for-approval'/,
    );

    const topLevelFlagResult = spawnSync(
      codexPath,
      ["--ask-for-approval", "never", "exec", "--help"],
      {
        encoding: "utf-8",
      },
    );
    assert.equal(topLevelFlagResult.status, 0);
    assert.match(topLevelFlagResult.stdout, /Usage:\s+codex exec/i);
  },
);
