import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  CHOICE_PREFERENCE_FIELDS,
  getChoicePreferenceField,
  resolveChoicePreference,
} from "../src/modules/preferences/choiceFields";

const root = process.cwd();
const preferencesXhtml = readFileSync(
  join(root, "addon", "chrome", "content", "preferences.xhtml"),
  "utf8",
);
const preferencesFtl = readFileSync(
  join(root, "addon", "locale", "en-US", "preferences.ftl"),
  "utf8",
);

function ftlMessageIds(source: string) {
  return new Set(
    [...source.matchAll(/^([a-z][a-z0-9-]*)\s*=/gm)].map((match) => match[1]),
  );
}

test("choice preferences repair known free-text values and keep unknown ones", () => {
  const permission = getChoicePreferenceField("claudePermissionMode");
  assert.deepEqual(resolveChoicePreference(permission, "acceptedits"), {
    kind: "known",
    value: "acceptEdits",
    repaired: true,
  });
  assert.deepEqual(resolveChoicePreference(permission, "plan"), {
    kind: "known",
    value: "plan",
    repaired: false,
  });
  assert.deepEqual(resolveChoicePreference(permission, "yolo"), {
    kind: "unrecognized",
    value: "yolo",
  });

  const sandbox = getChoicePreferenceField("codexSandboxMode");
  assert.deepEqual(resolveChoicePreference(sandbox, "workspace write"), {
    kind: "known",
    value: "workspace-write",
    repaired: true,
  });

  const mode = getChoicePreferenceField("defaultMode");
  assert.deepEqual(resolveChoicePreference(mode, "claude"), {
    kind: "known",
    value: "claude_code",
    repaired: true,
  });
  assert.deepEqual(resolveChoicePreference(mode, "gpt"), {
    kind: "unrecognized",
    value: "gpt",
  });

  const approval = getChoicePreferenceField("codexApprovalMode");
  assert.deepEqual(resolveChoicePreference(approval, "suggested"), {
    kind: "known",
    value: "never",
    repaired: true,
  });
});

test("empty choice preferences map to the value the runtime already uses", () => {
  const expected: Record<string, string> = {
    defaultMode: "codex_cli",
    claudeReasoningEffort: "",
    claudePermissionMode: "default",
    codexReasoningEffort: "medium",
    codexSandboxMode: "read-only",
    codexApprovalMode: "never",
  };
  for (const field of CHOICE_PREFERENCE_FIELDS) {
    const resolved = resolveChoicePreference(field, "");
    assert.equal(resolved.kind, "known", field.key);
    assert.equal(resolved.value, expected[field.key], field.key);
  }
  assert.deepEqual(
    resolveChoicePreference(
      getChoicePreferenceField("claudeReasoningEffort"),
      "",
    ),
    { kind: "known", value: "", repaired: false },
  );
});

test("every choice option resolves to itself", () => {
  for (const field of CHOICE_PREFERENCE_FIELDS) {
    for (const option of field.options) {
      assert.deepEqual(
        resolveChoicePreference(field, option),
        { kind: "known", value: option, repaired: false },
        `${field.key}=${option}`,
      );
    }
  }
});

test("the settings pane declares each choice as a select with matching options", () => {
  const messages = ftlMessageIds(preferencesFtl);
  for (const field of CHOICE_PREFERENCE_FIELDS) {
    const select = preferencesXhtml.match(
      new RegExp(
        `<html:select[^>]*id="zotero-prefpane-__addonRef__-input-${field.inputSuffix}"[^>]*>([\\s\\S]*?)</html:select>`,
      ),
    );
    assert.ok(select, `missing select for ${field.key}`);
    assert.match(
      select[0],
      new RegExp(
        `preference="extensions\\.zotero\\.__addonRef__\\.${field.key}"`,
      ),
    );
    const options = [...select[1].matchAll(/<html:option\s+value="([^"]*)"/g)];
    assert.deepEqual(
      options.map((match) => match[1]),
      [...field.options],
      `${field.key} options`,
    );
    for (const match of select[1].matchAll(/data-l10n-id="([^"]+)"/g)) {
      assert.ok(messages.has(match[1]), `missing Fluent message ${match[1]}`);
    }
    assert.ok(
      messages.has(field.unrecognizedL10nId),
      `missing Fluent message ${field.unrecognizedL10nId}`,
    );
  }
});
