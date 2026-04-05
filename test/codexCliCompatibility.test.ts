import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import * as assert from "node:assert/strict";

const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/codex",
  "/Users/meghendra/.nvm/versions/node/v20.16.0/bin/codex",
];

function findCodexBinary() {
  return CANDIDATE_PATHS.find((candidate) => existsSync(candidate));
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
