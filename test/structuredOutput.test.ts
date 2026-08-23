import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  cliSupportsFlag,
  helpSupportsFlag,
} from "../src/modules/ai/structuredOutput";

test("helpSupportsFlag detects exact CLI capability flags", () => {
  assert.equal(
    helpSupportsFlag(
      "Usage: codex exec --output-schema <FILE>",
      "--output-schema",
    ),
    true,
  );
  assert.equal(
    helpSupportsFlag(
      "Usage: codex exec --output-format json",
      "--output-schema",
    ),
    false,
  );
});

test("cliSupportsFlag falls back without failing when help probing fails", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        subprocess: async () => {
          throw new Error("old CLI");
        },
      },
    },
  };

  try {
    assert.equal(
      await cliSupportsFlag({
        executablePath: "old-cli-for-test",
        helpArgs: ["--help"],
        flag: "--json-schema",
      }),
      false,
    );
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("cliSupportsFlag probes with the runner environment and safe shell quoting", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const calls: Array<{ path: string; args: string[] }> = [];
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        subprocess: async (path: string, args: string[]) => {
          calls.push({ path, args });
          return "Usage: claude --json-schema <schema>";
        },
      },
    },
  };

  try {
    assert.equal(
      await cliSupportsFlag({
        executablePath: "/tmp/Claude's bin/claude",
        helpArgs: ["--help"],
        flag: "--json-schema",
        environment: { PATH: "/tmp/Claude's bin:/usr/bin" },
      }),
      true,
    );
    assert.equal(calls[0].path, "/bin/zsh");
    assert.deepEqual(calls[0].args.slice(0, 1), ["-lc"]);
    assert.match(calls[0].args[1], /export PATH='/);
    assert.match(calls[0].args[1], /Claude'\\''s bin/);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
