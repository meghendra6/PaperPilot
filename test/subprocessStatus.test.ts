import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  parseExitStatusMarker,
  withExitStatusMarker,
} from "../src/modules/ai/subprocessStatus";
import { probeCodexExecutable } from "../src/modules/codex/executable";
import {
  probeJavaRuntime,
  resetJavaRuntimeProbeForTests,
} from "../src/modules/tools/paperWorkspaceContent";
import { createGlobalStateRestorer } from "./helpers/globalState";

/**
 * Mirrors Zotero.Utilities.Internal.subprocess: it returns stdout only and
 * never looks at the exit status.
 */
function zoteroLikeSubprocess(env?: NodeJS.ProcessEnv) {
  return async (_command: string, args: string[] = []) =>
    spawnSync("/bin/sh", ["-c", args[args.length - 1]], {
      encoding: "utf-8",
      env: env ?? process.env,
    }).stdout;
}

function runMarked(script: string) {
  return parseExitStatusMarker(
    spawnSync("/bin/sh", ["-c", withExitStatusMarker(script)], {
      encoding: "utf-8",
    }).stdout,
  );
}

test("parseExitStatusMarker splits the status from the combined output", () => {
  assert.deepEqual(parseExitStatusMarker("hello\n__PAPERPILOT_EXIT__=0\n"), {
    exitCode: 0,
    output: "hello",
  });
  assert.deepEqual(parseExitStatusMarker("partial output"), {
    exitCode: undefined,
    output: "partial output",
  });
});

test("withExitStatusMarker reports real exit statuses and merges stderr", () => {
  assert.equal(runMarked("true").exitCode, 0);
  assert.equal(runMarked("exit 3").exitCode, 3);
  const missing = runMarked("/no/such/paperpilot-binary --version");
  assert.equal(missing.exitCode, 127);
  const stderr = runMarked("echo 'Not logged in' >&2; exit 1");
  assert.equal(stderr.exitCode, 1);
  assert.equal(stderr.output.trim(), "Not logged in");
});

test("probeCodexExecutable reports a logged-out or missing CLI as not ready", async () => {
  const restore = createGlobalStateRestorer(["Zotero"]);
  const dir = mkdtempSync(join(tmpdir(), "paperpilot-codex-probe-"));
  try {
    const loggedOut = join(dir, "codex");
    writeFileSync(
      loggedOut,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "codex-cli 0.163.0"; exit 0; fi',
        'echo "Not logged in" >&2',
        "exit 1",
      ].join("\n"),
    );
    chmodSync(loggedOut, 0o755);
    (globalThis as Record<string, unknown>).Zotero = {
      Utilities: { Internal: { subprocess: zoteroLikeSubprocess() } },
    };

    const probe = await probeCodexExecutable(loggedOut);
    assert.equal(probe.versionOk, true);
    assert.equal(probe.version, "codex-cli 0.163.0");
    assert.equal(probe.loginOk, false);
    assert.match(probe.loginStatus || "", /Not logged in/);

    const missing = await probeCodexExecutable(join(dir, "missing-codex"));
    assert.equal(missing.versionOk, false);
    assert.equal(missing.loginOk, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restore();
  }
});

test("probeJavaRuntime reports a missing Java even though subprocess resolves", async () => {
  const restore = createGlobalStateRestorer(["Zotero"]);
  resetJavaRuntimeProbeForTests();
  try {
    (globalThis as Record<string, unknown>).Zotero = {
      Utilities: {
        Internal: {
          subprocess: zoteroLikeSubprocess({ PATH: "/nonexistent" }),
        },
      },
      logError: () => undefined,
    };
    assert.equal(await probeJavaRuntime(), false);
  } finally {
    resetJavaRuntimeProbeForTests();
    restore();
  }
});
