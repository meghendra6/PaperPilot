import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  cliSupportsFlag,
  compatibleNativeOutputSchema,
  helpSupportsFlag,
  nativeStructuredOutputSchemaIssue,
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

test("native structured output validation enforces closed, fully-required objects", () => {
  const valid = {
    type: "object",
    additionalProperties: false,
    required: ["value", "details"],
    properties: {
      value: { type: "string" },
      details: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["note"],
            properties: { note: { type: "string" } },
          },
          { type: "null" },
        ],
      },
    },
  };
  assert.equal(nativeStructuredOutputSchemaIssue(valid), undefined);
  assert.equal(compatibleNativeOutputSchema(valid), valid);

  const openObject = {
    ...valid,
    properties: {
      ...valid.properties,
      details: { type: "object", properties: {}, required: [] },
    },
  };
  assert.equal(
    nativeStructuredOutputSchemaIssue(openObject),
    "root.properties.details.additionalProperties must be false",
  );
  assert.equal(compatibleNativeOutputSchema(openObject), undefined);

  const optionalProperty = { ...valid, required: ["value"] };
  assert.equal(
    nativeStructuredOutputSchemaIssue(optionalProperty),
    "root.required must list every property exactly once",
  );
  assert.equal(compatibleNativeOutputSchema(optionalProperty), undefined);

  const typelessEnum = {
    ...valid,
    properties: {
      ...valid.properties,
      value: { enum: ["one", "two"] },
    },
  };
  assert.equal(
    nativeStructuredOutputSchemaIssue(typelessEnum),
    "root.properties.value.type is required",
  );
  assert.equal(compatibleNativeOutputSchema(typelessEnum), undefined);
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
