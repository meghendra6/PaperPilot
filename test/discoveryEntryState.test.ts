import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWebSearchRequiredMessage,
  describeDiscoveryAvailability,
  WEB_SEARCH_SETTING_LABEL,
} from "../src/modules/discovery/capabilities";
import {
  DISCOVERY_ALREADY_RUNNING_MESSAGE,
  getDiscoveryButtonPresentation,
  resolveDiscoveryRequest,
} from "../src/modules/ui/discoveryEntryState";

const ready = {
  agentWebSearch: true,
  structuredCandidateSearch: true,
  officialEvidenceFetch: true,
};

test("discovery is available only with live web search and evidence fetch", () => {
  assert.deepEqual(describeDiscoveryAvailability("codex_cli", ready), {
    available: true,
  });
  assert.deepEqual(
    describeDiscoveryAvailability("claude_code", {
      ...ready,
      agentWebSearch: false,
    }),
    {
      available: false,
      reason: "Needs Codex CLI with web search allowed (engine settings).",
    },
  );
  const codexOff = describeDiscoveryAvailability("codex_cli", {
    ...ready,
    agentWebSearch: false,
  });
  assert.equal(codexOff.available, false);
  assert.ok(!codexOff.available);
  assert.match(codexOff.reason, /^Needs web search/);
  assert.ok(codexOff.reason.includes(`“${WEB_SEARCH_SETTING_LABEL}”`));
  const noFetch = describeDiscoveryAvailability("codex_cli", {
    ...ready,
    officialEvidenceFetch: false,
  });
  assert.ok(!noFetch.available);
  assert.match(noFetch.reason, /^Needs network access/);
});

test("web-search errors name the same toggle as engine settings", () => {
  for (const mode of ["codex_cli", "claude_code"] as const) {
    const message = buildWebSearchRequiredMessage("Research discovery", mode);
    assert.match(message, /^Research discovery needs/);
    assert.ok(message.includes("“Allow web search when needed”"));
    assert.doesNotMatch(message, /Enable Codex web search/);
  }
  assert.match(
    buildWebSearchRequiredMessage("Research discovery", "claude_code"),
    /Switch to Codex CLI/,
  );
});

test("the pane button cancels a running task and explains an unavailable engine", () => {
  assert.deepEqual(
    getDiscoveryButtonPresentation({
      reviewInsightRunning: false,
      running: true,
      hasResults: false,
      unavailableReason: "Needs Codex CLI",
    }),
    { label: "Cancel discovery", disabled: false, note: "" },
  );
  assert.deepEqual(
    getDiscoveryButtonPresentation({
      reviewInsightRunning: true,
      running: false,
      hasResults: true,
    }),
    { label: "Cancel review insights", disabled: false, note: "" },
  );
  assert.deepEqual(
    getDiscoveryButtonPresentation({
      reviewInsightRunning: false,
      running: false,
      hasResults: true,
      unavailableReason: "Needs Codex CLI",
    }),
    {
      label: "Refresh verified prior work",
      disabled: true,
      note: "Needs Codex CLI",
    },
  );
  assert.deepEqual(
    getDiscoveryButtonPresentation({
      reviewInsightRunning: false,
      running: false,
      hasResults: false,
    }),
    { label: "Find verified prior work", disabled: false, note: "" },
  );
});

test("a second Find prior work request never cancels the running search", () => {
  assert.deepEqual(
    resolveDiscoveryRequest({ running: true, unavailableReason: "Needs X" }),
    { action: "already_running", message: DISCOVERY_ALREADY_RUNNING_MESSAGE },
  );
  assert.match(
    DISCOVERY_ALREADY_RUNNING_MESSAGE,
    /^Discovery is already running/,
  );
  assert.deepEqual(
    resolveDiscoveryRequest({ running: false, unavailableReason: "Needs X" }),
    { action: "unavailable", message: "Needs X" },
  );
  assert.deepEqual(resolveDiscoveryRequest({ running: false }), {
    action: "start",
  });
});
