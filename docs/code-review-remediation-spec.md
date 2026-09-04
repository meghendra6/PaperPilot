# Code review remediation spec

- **Document status:** Implemented by PR #64, with the scoped `SHOULD`
  exceptions recorded in section 2.1. All P0 and P1 requirements are complete.
- **Review target:** `main` at commit `639eea5`, reviewed 2026-09-03
- **Scope reviewed:** all of `src/` (236 files, 62,802 LOC), `test/` (90 files,
  ~28,400 LOC), `scripts/`, `addon/`, `docs/`, root configuration
- **Audience:** contributors and coding agents working under
  [`AGENTS.md`](../AGENTS.md)
- **Related notes:** [`architecture.md`](./architecture.md),
  [`prompt-contracts.md`](./prompt-contracts.md),
  [`manual-qa.md`](./manual-qa.md)

## 1. Normative language

- **MUST** — required for correctness, safety, or data integrity. A release
  should not ship with an open MUST at priority P0.
- **SHOULD** — expected unless a reviewer records a reason to skip it.
- **MAY** — optional improvement.

Every requirement carries a priority. The priority rules are in section 4.

## 2. Summary

Paper Pilot is disciplined in several measurable ways. The repository has zero
empty `catch` blocks across 240 catch sites, zero `TODO`/`FIXME` markers, zero
direct `Zotero.Prefs` reads outside `utils/prefs.ts`, and zero `console.*`
calls. Every DOM node outside one renderer is built with `createElement` and
`textContent`, so model output cannot reach the DOM as markup. The discovery
network boundary classifies non-public IP addresses more strictly than its own
documentation claims. The Research Workspace store is revision guarded per
file, and its staleness propagation terminates on cyclic lineage by
construction. All 749 tests pass and `npx tsc --noEmit` is clean.

The defects cluster in five places.

1. **A shipped preference surface that does nothing.** Two preferences are
   declared in all three required locations and read nowhere. One of them is a
   privacy control. Raw CLI stderr reaches disk unredacted.
2. **The engine launch and shutdown edges.** Gemini chat runs with all
   approvals disabled. Two of three engines miss a PATH fix that the third
   already ships. Shutdown clears timers but never unregisters the reader pane
   section and never signals running CLI processes.
3. **An untyped island.** 46 files and 6,167 lines under `@ts-nocheck` sit
   inside `src/modules/researchWorkspace/`, including the orchestration hub
   `service.ts`. `docs/architecture.md` calls this layer the "typed core".
4. **Two unbounded loops reachable from user input.** A retrieval preference
   typo can freeze Zotero. A model quote of two characters can place a
   highlight on the wrong page of the user's PDF.
5. **No CI gate.** The only workflow runs on release tags. `main` currently
   carries 6 ESLint errors and 5 Prettier-dirty files.

This document records **147 requirements** across 13 workstreams: 10 at P0,
47 at P1, 52 at P2, and 38 at P3. Section 22 indexes them. Section 19 lists
what was examined and found correct, so nobody spends effort there.

### 2.1 Remediation outcome

PR #64 evaluated all 147 requirements. It implements 137 in full and records
10 scoped exceptions to `SHOULD` requirements. No P0 or P1 requirement is
deferred.

| Priority | Implemented | Recorded exceptions |
| -------- | ----------- | ------------------- |
| P0       | 10 / 10     | 0                   |
| P1       | 47 / 47     | 0                   |
| P2       | 44 / 52     | 8                   |
| P3       | 36 / 38     | 2                   |

The exceptions below preserve the normative rule in section 1: each skipped
`SHOULD` has an explicit reviewer rationale. Partial work is noted so future
changes can start at the remaining boundary instead of repeating completed
work.

| Requirement | Status and reviewer rationale                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS-3.9      | Partial: `PaneElements` and `WorkbenchElements` now centralize repeated render arguments. Moving every pane capability out of the 4,800-line lifecycle in this safety remediation would combine large file moves with behavior changes; finish it as isolated, real-Zotero-verified refactors. |
| WS-10.2     | Partial: action-state and artifact-renderer behavior gained focused coverage. The remaining facade-to-pane cases require Zotero DOM/runtime behavior, which this repository intentionally keeps in `docs/manual-qa.md` rather than pretending to cover with Node mocks.                        |
| WS-10.4     | Partial: shared global-state and shell helpers live in `test/helpers`. Existing domain-specific fixtures remain local because migrating them is broad test-only churn with no additional behavior coverage.                                                                                    |
| WS-10.7     | Partial: behavior tests now cover the corrected paths, while a small number of source tripwires remain for wiring that cannot execute without Zotero. Replace each only when its seam becomes a pure exported builder.                                                                         |
| WS-10.9     | Deferred: splitting the largest test files changes organization only and would substantially enlarge this already broad correctness patch. Do it per unit under test in dedicated follow-ups.                                                                                                  |
| WS-10.12    | Deferred: provider tests remain intentionally explicit and isolated, matching the production engine-module boundary. Table-drive only assertions whose provider contracts are proven identical.                                                                                                |
| WS-12.3     | Partial: checkpoint writes skip catalog sync, completion syncs once, and the catalog stores the due-review count. A propagation round still takes before/after snapshots to detect concurrent file changes; replacing those reads needs a separately designed atomic batch contract.           |
| WS-13.3     | Partial: four renderer-local DOM helper copies moved to one shared module. Per-capability renderer extraction is deferred because it is a large structural move across Zotero UI paths and needs dedicated runtime QA.                                                                         |
| WS-13.4     | Partial: dead facade/service paths were removed and shared contracts were extracted. Capability-family file moves are deferred as non-behavioral churn after the correctness boundary is green.                                                                                                |
| WS-13.6     | Deferred: the discovery orchestrators retain their current files. Splitting and hoisting their polling loop should be an isolated change so provider cleanup and cancellation behavior can be compared independently.                                                                          |

Implementation verification on 2026-09-05:

- `npm test`: 835 pass, 0 fail, 0 skip.
- `npm run lint:check`: 0 errors; 98 existing non-null-assertion warnings.
- `npm run build`: passed, including both TypeScript projects and XPI packing.
- Node 20 scaffold build smoke: passed.
- `unzip -t build/paper-pilot.xpi`: no compressed-data errors.
- `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities.
- Runtime import-cycle contract: 0 cycles.
- `@ts-nocheck`: reduced from 46 to 41 source files.

Real-reader, subprocess, and Zotero-library checks remain manual by design and
are listed in [`manual-qa.md`](./manual-qa.md); automated results do not imply
that those runtime checks ran.

## 3. Verified baseline

The following facts were measured on the review target and are the baseline
for every "Verify" line below.

| Check                                                        | Result                                              |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `npx tsc --noEmit`                                           | clean, 1.65 s, 0 test files in the program          |
| `npm test`                                                   | 749 pass / 0 fail / 0 skip, 14.7 s                  |
| `npx eslint src test`                                        | 6 errors (see WS-9.6)                               |
| `npx prettier --check src test scripts addon docs README.md` | 5 files dirty                                       |
| `src/` files over 800 lines                                  | 18                                                  |
| Files under `@ts-nocheck`                                    | 46 files / 6,167 lines, all in `researchWorkspace/` |
| `: any` / `as any` / `<any>` in `src/`                       | 146 sites                                           |
| Non-null assertions in `src/`                                | 46 sites                                            |
| `innerHTML` / `insertAdjacentHTML` / `outerHTML` in `src/`   | 8 sites, all in `components/markdownRenderer.ts`    |
| Empty `catch` blocks                                         | 0 of 240 catch sites                                |
| `TODO` / `FIXME` / `HACK`                                    | 0                                                   |
| Direct `Zotero.Prefs` outside `utils/prefs.ts`               | 0                                                   |
| Import cycles in `src/`                                      | 3 strongly connected components (WS-13.5)           |
| `src/` files with no direct test import                      | 83 of 236                                           |

### 3.1 Method and confidence

Eight scoped reviews covered bootstrap and reader UI, the engine layer,
context/workspace/session, Research Workspace persistence, Research Workspace
derivations, Research Workspace UI and Zotero sync, structured workflows and
discovery, and tests/tooling/docs. Each review read its files in full.

Every P0 requirement and every P1 requirement marked **CONFIRMED** was
re-verified directly against the source after the reviews finished. A
requirement marked **PLAUSIBLE** states what would confirm it. Treat a
PLAUSIBLE item as a hypothesis with a named test, not as a known defect.

## 4. Priority rules

- **P0** — the code can execute untrusted instructions with the user's
  privileges, write wrong data into the user's Zotero library, lock or lose
  user data with no in-app recovery, freeze Zotero, or present a shipped
  privacy control that does nothing.
- **P1** — the code delivers an incorrect result labelled as verified or
  complete, breaks a guarantee stated in `AGENTS.md` or `docs/`, fails on
  supported input, or leaves a required verification gate absent.
- **P2** — the code degrades at realistic scale, blocks safe change, or leaves
  a risky path untested.
- **P3** — hygiene, dead code, documentation, minor UX.

## 5. Non-goals

- **Do not merge the three engine modules.** `AGENTS.md` states that
  `codex/`, `claude/`, and `gemini/` are near-duplicates for isolation. This
  spec asks only for behavior that is already shared to move into
  `modules/ai/`, and for one missing fix to reach all three.
- **Do not restructure the Research Workspace feature set.** Every
  requirement below preserves the current capability boundaries.
- **Do not add a server, a network model client, or a second XPI.**
- **Do not weaken any evidence boundary to make a workflow succeed.**

## 6. WS-1 — Engine execution safety and process lifecycle

The paper workspace holds untrusted text. Every engine reads it. These
requirements keep the launch, permission, and termination paths honest.

#### WS-1.1 Gemini chat MUST NOT disable approvals (P0, CONFIRMED)

- **Where:** `src/modules/gemini/runner.ts:107-108,116`
- **Now:** `params.profile === "chat" ? "--yolo" : "--approval-mode plan"`.
  The command passes no `--sandbox`. `addon/prefs.js` declares no Gemini
  approval preference. `test/geminiRunner.test.ts:63-83` locks the behavior in.
- **Impact:** Gemini accepts every action for a run whose prompt and workspace
  contain paper text. An instruction embedded in a PDF can run shell commands
  with the user's privileges. Codex chat runs sandboxed and Claude chat runs
  under a validated permission preference, so Gemini is the outlier.
  `docs/architecture.md` states "Normal chat uses the configured provider
  permissions", which is false for Gemini.
- **Required:** MUST add a `geminiApprovalMode` preference to `addon/prefs.js`,
  `typings/prefs.d.ts`, and `addon/chrome/content/preferences.xhtml`, with
  default `default`. MUST normalize the value through an allowlist, in the
  shape of `normalizeClaudePermissionMode`. MUST emit
  `--approval-mode <value>`. SHOULD pass `--sandbox` when the installed Gemini
  CLI supports it.
- **Verify:** update `test/geminiRunner.test.ts` to assert the default emits no
  `--yolo`. Add a case per allowlisted mode. Re-run `npm test`.

#### WS-1.2 Codex follow-up turns MUST carry the configured permissions (P1, CONFIRMED)

- **Where:** `src/modules/codex/commandBuilder.ts:83-108`, selected at
  `src/modules/codex/runner.ts:316-341`
- **Now:** `buildCodexResumeCommand` omits `--sandbox` and
  `--ask-for-approval`. The first turn passes both.
- **Impact:** Every chat turn after the first runs under the user's
  `~/.codex/config.toml` defaults. A user who chose `read-only` can get a
  `workspace-write` follow-up.
- **Required:** MUST emit `--ask-for-approval <mode>` and `--sandbox <mode>`
  before `exec` in the resume command, or pass the equivalent `-c` overrides.
- **Verify:** extend the resume case in `test/codexCommandBuilder.test.ts`.

#### WS-1.3 All three runners MUST prepend the executable directory to PATH (P1, CONFIRMED)

- **Where:** `src/modules/codex/environment.ts:23-34` has the fix.
  `src/modules/claude/runner.ts:56-76` and
  `src/modules/gemini/runner.ts:52-72` do not.
- **Now:** Codex computes `executableDir` and puts it first in `PATH`. Claude
  and Gemini build `PATH` from a fixed list. All three replace the login-shell
  `PATH`.
- **Impact:** `test/codexExecutable.test.ts:135` records why the fix exists.
  npm shims start with `#!/usr/bin/env node` and need `node` on `PATH`. A user
  who points `claudeExecutablePath` or `geminiExecutablePath` at an nvm or
  volta install gets `env: node: No such file or directory`.
  `ai/runFailure.ts:51` then blames the path the user just set.
- **Required:** MUST extract one shared helper, for example
  `modules/ai/cliEnvironment.ts`, that takes the executable path and returns
  the environment. MUST use it in all three runners. This is shared behavior,
  so it belongs in `modules/ai/` per `AGENTS.md`, not in a cross-engine import.
- **Verify:** add the Codex PATH assertion to `test/claudeRunner.test.ts` and
  `test/geminiRunner.test.ts`.

#### WS-1.4 Runners MUST catch a rejected `exec` (P1, CONFIRMED code shape)

- **Where:** `src/modules/codex/runner.ts:353-364`,
  `src/modules/claude/runner.ts:377-388`,
  `src/modules/gemini/runner.ts:337-348`
- **Now:** each runner awaits
  `Zotero.Utilities.Internal.exec("/bin/zsh", ["-lc", script])` and then tests
  `result instanceof Error`. Upstream `exec` rejects on a non-zero exit
  instead of resolving with an `Error`, so the branch never runs. The
  controller `.catch` labels the throw `source: "workspace"`
  (`src/modules/codex/controller.ts:205`).
- **Impact:** a failing launch script shows "Paper Pilot could not prepare a
  writable workspace". The `spawn` failure source, the Codex login
  classification on spawn failure, and the `loginState` update never execute.
  `docs/architecture.md` documents `spawn` as a live failure source.
- **Confidence:** the dead branch is CONFIRMED. The upstream rejection
  behavior is PLAUSIBLE from `utilities_internal.js`. Confirm with a fake
  `exec` that throws.
- **Required:** MUST wrap the `exec` call in `try`/`catch` in each runner and
  return `{ ok: false, error }` from the catch. MAY keep the `instanceof`
  check as a second guard.
- **Verify:** add a test per engine with an `exec` stub that throws, and assert
  the failure source is `spawn`.

#### WS-1.5 Shutdown MUST stop the processes it started (P1, CONFIRMED)

- **Where:** `src/hooks.ts:120-135`
- **Now:** `onShutdown` clears pollers, cancels pending completion timeouts,
  and clears progress state. It never calls `stopDetachedRunProcess` or any
  `stop*RunSilently`.
- **Impact:** the runs are detached by design. Disabling the add-on leaves
  `codex`, `claude`, or `gemini` running for up to 30 minutes with no owner,
  no reader, and no workspace cleanup. `docs/architecture.md` claims
  "Pipeline children therefore do not outlive the card", which holds only for
  the Cancel path.
- **Required:** MUST iterate the three run-state maps in `onShutdown` and stop
  each process that still holds a poller, a running state, or an active
  presentation token. MUST keep the call best-effort and non-blocking. MUST
  record the chosen policy in `docs/architecture.md`.
- **Verify:** manual QA. Start a long run, disable the add-on, check `ps`. Add
  the step to `docs/manual-qa.md`.

#### WS-1.6 A failed stop MUST leave an observer in place (P1, CONFIRMED)

- **Where:** `src/modules/ai/runControl.ts:23`,
  `src/modules/codex/stopRun.ts:23,28`, and the same order in
  `claude/stopRun.ts` and `gemini/stopRun.ts`
- **Now:** each `stop*RunSilently` clears the poller first, then awaits the
  kill. On a kill failure the phase stays `running` and nothing re-arms the
  interval or the watchdog.
- **Impact:** the documented recovery is a second Cancel. If the process exits
  on its own first, no code reads the exit file. The card stays at `Running`
  and the 30-minute limit no longer applies.
- **Required:** MUST re-arm the poller, or a slower reconciliation interval,
  when a stop fails. MUST re-arm the watchdog with the original `startedAt`.
- **Verify:** extend the cancellation tests with a kill stub that reports
  failure, then a delayed exit-code file.

#### WS-1.7 Failure classification MUST read stderr, not the whole stream (P1, PLAUSIBLE)

- **Where:** `src/modules/codex/controller.ts:417-423,450-452`, the same shape
  in `claude/controller.ts:369-375` and `gemini/controller.ts:369-375`,
  patterns in `src/modules/ai/runFailure.ts:24-55`
- **Now:** `rawError` is `progress.rawOutput || rawAssistantText`, which for
  Codex is the full JSONL event stream including tool output.
  `EXECUTABLE_PATTERNS` includes `/no such file or directory/i` and the Codex
  login patterns include `/not logged in/i`.
- **Impact:** an agent that ran `cat missing.txt` during a run that failed for
  another reason is reported as a missing executable. Any quoted "not logged
  in" flips the Codex header to `login_required`. Both messages send the user
  to the wrong fix.
- **Confirm with:** a Codex fixture with a non-zero exit whose JSONL contains
  the matching text.
- **Required:** MUST classify on stderr plus the CLI's own error events, which
  `outputParser.ts` already extracts. MUST keep the joined stream in
  `rawEvent` only.
- **Verify:** add the fixture above as a regression test.

#### WS-1.8 `startWorkspaceTextRun` callers MUST NOT release a reservation on a rejected cleanup (P1, CONFIRMED)

- **Where:** contract at `src/modules/ai/workspaceRun.ts:210-235`, correct
  caller at `src/modules/relatedRecommendations.ts:173-181`, incorrect caller
  at `src/modules/researchWorkspace/analysisRunner.ts:56-60`
- **Now:** the deferred-cleanup promise rejects when a late process cannot be
  stopped. `analysisRunner.ts` uses `void cleanup.finally(release)`, so it
  releases on rejection and leaves the rejection unhandled.
- **Impact:** `docs/architecture.md` states that an unconfirmed termination
  keeps the reservation and does not claim cleanup. A Research Workspace
  analysis can start a second run on a paper whose process may still be alive.
- **Required:** MUST export one helper from `workspaceRun.ts` that releases
  only after a confirmed cleanup. MUST use it in every caller. MUST document
  the rejection on `onDeferredCleanup`.
- **Verify:** add a `workspaceRun` test with a stop stub that fails, and assert
  the reservation survives.

#### WS-1.9 The CLI capability probe SHOULD NOT cache a failure for the session (P2, CONFIRMED)

- **Where:** `src/modules/ai/structuredOutput.ts:140-170`
- **Now:** `catch { capabilityCache.set(cacheKey, false); return false; }`
- **Impact:** one slow or interrupted `--help` disables native structured
  output for that executable until Zotero restarts. The parser fallback hides
  the downgrade.
- **Required:** SHOULD cache successful probes only, or cache failures with a
  short TTL. SHOULD log the fallback through `ztoolkit.log`.

#### WS-1.10 Codex SHOULD NOT re-probe every executable candidate per run (P2, CONFIRMED)

- **Where:** `src/modules/codex/executable.ts:170-191`, called from
  `src/modules/codex/runner.ts:92-94`
- **Now:** the resolver probes each candidate with two subprocesses through
  `zsh -lc`, in sequence, and writes `codexExecutablePath` when the winner
  differs. `collectNvmCandidates` adds one candidate per installed node
  version.
- **Impact:** every chat turn and every silent workflow pays several CLI
  launches before workspace preparation. Starting a run also mutates a user
  preference.
- **Required:** SHOULD cache the resolved path for the session and invalidate
  it when the preference changes. SHOULD probe only the resolved path at run
  start. MUST move the preference write to the explicit re-check action
  (see WS-1.14).

#### WS-1.11 The Codex poll tick SHOULD NOT re-parse the whole stream (P2, CONFIRMED)

- **Where:** `src/modules/codex/controller.ts:373-400`,
  `src/modules/codex/runner.ts:385-396`
- **Now:** each 800 ms tick reads three files, parses the entire JSONL, and
  rebuilds run state from three preference reads. Claude and Gemini do
  neither.
- **Impact:** parse cost grows linearly per tick on the main thread. Long
  agentic runs produce multi-megabyte JSONL.
- **Required:** SHOULD track a byte offset and parse only appended lines, or
  parse on completion only.

#### WS-1.12 Claude and Gemini SHOULD clear the pid at claim time (P2, CONFIRMED)

- **Where:** `src/modules/claude/controller.ts:362,399-401`, the same in
  `gemini/controller.ts`, contrast `src/modules/codex/controller.ts:408-409`
- **Now:** between the poller clear and the state clear, the poller is gone,
  the presentation token is active, and `runState.processId` still names the
  exited subshell.
- **Impact:** a stop request inside that window signals a pid that no longer
  belongs to the run. `buildKillProcessTreeScript` performs no start-time or
  command check, so a reused pid would reach an unrelated process tree.
- **Required:** SHOULD clear `processId` immediately after
  `claimPendingEngineCompletion` succeeds. SHOULD add a `ps` sanity check to
  the kill script before it signals.

#### WS-1.13 `codexSandboxMode` MUST be validated, not cast (P3, CONFIRMED)

- **Where:** `src/modules/codex/runner.ts:112-116`
- **Now:** the preference value is cast to the union. `approvalMode` goes
  through an allowlist.
- **Required:** MUST add `normalizeCodexSandboxMode` with a `read-only`
  default.

#### WS-1.14 Runners MUST NOT write preferences (P3, CONFIRMED)

- **Where:** `src/modules/claude/runner.ts:168-170`,
  `src/modules/gemini/runner.ts:142-144`,
  `src/modules/codex/executable.ts:186-188`
- **Now:** a hidden analysis run rewrites the saved model alias. Codex
  rewrites the executable path.
- **Required:** MUST normalize for the command only. Preference migration
  belongs at startup or in the settings pane.

#### WS-1.15 Home directory derivation SHOULD have a real fallback (P3, CONFIRMED)

- **Where:** `src/modules/codex/environment.ts:13-15`,
  `src/modules/claude/runner.ts:58-60`,
  `src/modules/gemini/runner.ts:54-56`
- **Now:** a profile path without `/Library/` yields `userHome = ""`, so
  `~/.local/bin` becomes `/.local/bin` and `HOME` is not exported.
- **Impact:** `~/.local/bin` is the Claude native install location. A custom
  `-profile` location or a non-macOS host loses it.
- **Required:** SHOULD fall back to the directory service Home path or the
  inherited `HOME`.

#### WS-1.16 File reads SHOULD distinguish absent from unreadable (P3, CONFIRMED)

- **Where:** `src/modules/codex/runner.ts:65-74` and the two equivalents
- **Now:** `catch { return ""; }`. An unreadable exit-code file is
  indistinguishable from a run in progress, so the watchdog reports a timeout.
- **Required:** SHOULD return `undefined` on error and log once.

## 7. WS-2 — Privacy controls and data at rest

#### WS-2.1 `privacyRedactLocalFilePaths` MUST work or MUST be removed (P0, CONFIRMED)

- **Where:** declared at `addon/prefs.js:49`, `typings/prefs.d.ts:39`,
  `addon/chrome/content/preferences.xhtml:576`. Helper at
  `src/modules/workspace/redaction.ts`. No reader anywhere in `src/`.
- **Now:** `grep -rn privacyRedactLocalFilePaths src` returns nothing.
  `redactPath` has one caller, a test. Meanwhile
  `src/modules/session/sessionHistoryService.ts:54` persists `rawEvent`, which
  is raw CLI stderr and routinely contains absolute paths.
- **Impact:** the Privacy pane shows an enabled checkbox that changes nothing.
  Users who trust it believe their session history is scrubbed. `AGENTS.md`
  treats a preference that silently does nothing as a defect.
- **Required:** MUST choose one path and finish it.
  - To implement: apply redaction to `rawEvent`, `failure.rawError`, and
    `extractionNotes` before persistence when the preference is on. Extend
    `redactPath` to a pattern over absolute paths.
  - To remove: delete the key from `addon/prefs.js`, `typings/prefs.d.ts`,
    `preferences.xhtml`, `preferences.ftl`, and delete
    `workspace/redaction.ts`.
- **Verify:** add a `sessionHistoryService` test that asserts the stored
  `rawEvent` carries no absolute path when the preference is on. Add the
  preference-sync test from WS-10.5.

#### WS-2.2 Workspace `recent-turns.json` MUST honor the privacy preferences (P0, CONFIRMED)

- **Where:** `src/modules/codex/runner.ts:202-206`,
  `src/modules/claude/runner.ts:259-263`,
  `src/modules/gemini/runner.ts:233-237`
- **Now:** all three runners call `messageStore.recentRaw(...)`, which bypasses
  the preference-aware `list()`. Removal of the file depends on
  `codexAutoCleanWorkspace`, and `cleanupWorkspaceIfEnabled` swallows a
  cleanup failure.
- **Impact:** with "Store local history" off or "Save prompts only" on, the
  user expects no assistant text on disk. Assistant turns still land in
  `recent-turns.json`. Sending recent turns to the engine is legitimate.
  Keeping them after the run under a disabled-history setting is not.
- **Required:** MUST omit assistant turns from `recentTurns` when
  `resolveSessionHistoryPrefs().persistAssistantMessages` is false. MUST force
  workspace cleanup regardless of `codexAutoCleanWorkspace` when history
  persistence is off. MUST document the interaction in
  `docs/architecture.md`.
- **Verify:** extend `test/codexCommandBuilder.test.ts` artifact assertions
  with a prompts-only preference set.

#### WS-2.3 Default storage roots MUST NOT be shared `/tmp` (P0, CONFIRMED)

- **Where:** `src/modules/session/sessionHistoryRepository.ts:227`, and the
  `"/tmp/zotero-paper-ai"` default repeated at `codex/runner.ts:103`,
  `claude/runner.ts:173`, `gemini/runner.ts:147`, `codex/runState.ts:73`,
  `workspace/cleanup.ts:63`, `readerPane.ts:4050`
- **Now:** the session-history fallback writes chat history to
  `/tmp/paperpilot/session-history`. The workspace default is
  `/tmp/zotero-paper-ai`.
- **Impact:** `/tmp` is world-readable on macOS and Linux. Paper text,
  selections, and recent turns land there with the default umask. The
  six-way duplication of the default string is also a drift hazard.
- **Required:** MUST centralize the workspace root in
  `workspace/pathBuilder.ts` and default it to a per-user location, for
  example under `Zotero.getTempDirectory()`. MUST make the session-history
  fallback fail instead of writing chat history to `/tmp`.
- **Verify:** unit-test the new resolver. Add a manual QA step that confirms
  the default root after a fresh install.

#### WS-2.4 OpenDataLoader MUST delete its output directory (P1, CONFIRMED)

- **Where:** `src/modules/tools/paperWorkspaceContent.ts:405-456`
- **Now:** `IOUtils.createUniqueDirectory` creates a run directory. No path
  removes it, on success or on any of the three throw paths.
- **Impact:** every extraction leaves the complete structured text of the
  paper inside the Zotero data directory. Users who enabled workspace
  auto-clean do not know a second copy exists.
- **Required:** MUST remove the directory in a `finally` block.
- **Verify:** add a `paperWorkspaceContent` test with a fake `IOUtils` that
  asserts removal on success and on failure.

#### WS-2.5 `autoOpenPaneOnPdfOpen` MUST work or MUST be removed (P1, CONFIRMED)

- **Where:** declared at `addon/prefs.js:5`, `typings/prefs.d.ts:11`,
  `addon/chrome/content/preferences.xhtml:61`. No reader in `src/`.
- **Required:** MUST implement the behavior on reader tab select, or MUST
  delete the key from all declaration sites and the locale file.

#### WS-2.6 Privacy preferences MUST NOT hide the live transcript (P1, CONFIRMED)

- **Where:** `src/modules/message/messageStore.ts:5-35`, rendered by
  `src/modules/readerPane.ts:4182-4185`
- **Now:** `list()` filters assistant messages when history storage is off.
  `renderMessageHistory` renders `list()`.
- **Impact:** with history disabled, an answer appears once and then vanishes
  on the next pane rebuild, tab switch, or transcript window shift. The same
  text is still in memory. The preference labels describe persistence, not
  display.
- **Required:** MUST keep `list()` unfiltered for the live pane and MUST apply
  the preferences only where data reaches disk, which
  `sessionSnapshot.getPersistedMessages` already does. If hiding is
  intentional, MUST rename the preference strings and document the behavior.

#### WS-2.7 `extractionNotes` SHOULD carry canned reasons (P2, CONFIRMED)

- **Where:** `src/modules/tools/paperWorkspaceContent.ts:123-127`
- **Now:** the note interpolates `String(error.message)`, which for `IOUtils`
  failures includes the path. The note reaches `paper.json`,
  `metadata.json`, and persisted project source records.
- **Required:** SHOULD map known failures to fixed tokens such as
  `java-missing`, `jar-missing`, `no-output`, `invalid-json`. SHOULD keep the
  raw error in the debug log only.

#### WS-2.8 `safeError` redaction SHOULD cover the paths that actually appear (P2, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/operationCoordinator.ts:113-118`
- **Now:** the pattern covers `C:\`, `/Users/`, and `/home/` only.
  `/private/var/folders/...`, `/Volumes/...`, `/tmp/...`, and `/opt/...` pass
  through into persisted run files and exports.
- **Required:** SHOULD redact any absolute path token, or redact the known
  profile and workspace prefixes.

#### WS-2.9 The late-completion branch SHOULD respect `persistHistory` (P2, CONFIRMED)

- **Where:** `src/modules/session/sessionHistoryService.ts:224-262`
- **Now:** the branch reads `persistAssistantMessages` and never checks
  `persistHistory`. It rewrites the snapshot with a new `updatedAt` and resume
  ids.
- **Required:** SHOULD return early when history persistence is off.

## 8. WS-3 — Reader pane correctness and structure

#### WS-3.1 `splitTextIntoChunks` MUST NOT loop forever (P0, CONFIRMED)

- **Where:** `src/modules/tools/splitTextIntoChunks.ts:12-19`. Callers at
  `codex/runner.ts:173-178`, `claude/runner.ts:230-235`,
  `gemini/runner.ts:204-209`. Inputs at
  `addon/chrome/content/preferences.xhtml:427-451`.
- **Now:** the loop advances by `chunkSize - overlapSize`. The runners pass
  the raw `retrievalChunkSize` and `retrievalOverlapSize` values. The two
  number inputs carry no `min` or `max`, so a user can save overlap equal to
  or larger than the chunk size, or a chunk size of zero.
- **Impact:** `startIndex` stops advancing or goes backwards. The array grows
  until the process runs out of memory. The loop runs on the Zotero main
  thread during workspace preparation, so Zotero freezes on every run until
  the preference is corrected by hand.
- **Required:** MUST clamp the step to at least 1 inside
  `splitTextIntoChunks`. MUST reject a non-finite or non-positive chunk size
  and fall back to the default. MUST add `min` and `max` to the three
  retrieval inputs.
- **Verify:** add `test/splitTextIntoChunks.test.ts` covering
  `overlap >= chunk`, `chunk = 0`, `NaN`, empty text, and the trailing chunk.

#### WS-3.2 `sanitizeAssistantText` MUST NOT corrupt code or Markdown (P0, CONFIRMED)

- **Where:** `src/modules/message/assistantOutput.ts:14-39`. Applied at store
  time by `message/messageStore.ts:49-52` and
  `session/sessionHistoryService.ts:50`.
- **Now:** the function strips every bare URL, deletes every `()`, and
  collapses runs of two or more spaces or tabs, across the whole message. A
  fenced Python block loses its indentation and its call parentheses. A DOI
  the user asked for disappears.
- **Impact:** the sanitized text is what the store and the on-disk snapshot
  keep. The original is unrecoverable. Any answer with function calls,
  indented code, a table, or a citation link is damaged.
  `test/sanitizeAssistantText.test.ts` covers two happy paths and never
  asserts code preservation.
- **Required:** MUST skip fenced blocks and inline code spans. MUST drop the
  `()` and multi-space rules, or restrict them to prose lines. SHOULD keep
  URLs when the user turn asked for a link, a URL, a DOI, or a source.
- **Verify:** add regression cases with a fenced code block, an indented list,
  a Markdown table, and a DOI.

#### WS-3.3 Workbench handlers MUST NOT query the whole document by id (P1, CONFIRMED)

- **Where:** `src/modules/readerPane.ts:3774`, and the seven-id lookups at
  `4303-4328`, `4381-4406`, `4470-4495`, `4514-4539`, `4600-4625`
- **Now:** the completion handlers call
  `ownerDocument.querySelector("#chat-research-brief")` and the equivalents.
  Every pane instance renders the same ids from the shared `bodyXHTML`.
- **Impact:** Zotero keeps one item pane per reader tab. `querySelector`
  returns the first match in document order. A Workbench run that finishes in
  the second tab enables and disables the first tab's buttons. The status text
  lands in the right pane because it is passed by reference, so the two
  disagree.
- **Confirm with:** two reader tabs, a Research brief run in the second tab,
  and a watch on the first tab's buttons.
- **Required:** MUST pass the already-captured element references
  (`readerPane.ts:520-543`) into the handlers as one `WorkbenchElements`
  object. Where a query stays, MUST scope it to the pane container. SHOULD
  replace duplicated ids with `data-pp-*` attributes.
- **Verify:** add the two-tab scenario to `docs/manual-qa.md`.

#### WS-3.4 Session decisions MUST read the item-scoped session id (P1, CONFIRMED)

- **Where:** writer at `src/modules/readerPane.ts:3399`, readers at `1307`,
  `1356`, `1405`, `1483-1484`
- **Now:** `addon.data.currentSessionId` is global. `renderPaneState` writes it
  for whichever pane re-renders, including a background tab woken by a run
  event. `sessionStore.get(item.id)?.sessionId` is the item-scoped source and
  is already used elsewhere in the same file.
- **Impact:** with two reader tabs, a run completing in one tab overwrites the
  global. Delete in the other tab then takes the wrong branch, skips the
  runtime transition, and leaves the pane rendering a session that no longer
  exists. The "Current" badge and the disabled Open button also point at the
  wrong session.
- **Required:** MUST replace the four reads with the item-scoped lookup. MAY
  keep the global for `sessionHistoryService`, documented as "last rendered
  pane".

#### WS-3.5 Shutdown MUST unregister the reader pane section (P1, CONFIRMED)

- **Where:** `src/hooks.ts:120-149`, registration at
  `src/modules/readerPane.ts:224-229`, document listeners at
  `src/modules/ui/paneHeader.ts:260-262`
- **Now:** `onShutdown` unregisters the Research Workspace section, the
  launchers, and the window. It never calls `unregisterSection` for
  `paper-pilot-tabpanel` and never runs the pending pane cleanups.
  `aiReaderPaneRegistered` is never reset.
- **Impact:** the pane relies on Zotero's plugin-shutdown auto-unregistration
  and on `onDestroy` running before the compartment unloads. If the order
  differs, the three document-level handlers survive against an unloaded
  compartment and throw on every click.
- **Required:** MUST track rendered bodies, MUST export an unregister function
  that runs every pending cleanup and calls `unregisterSection`, and MUST call
  it first in `onShutdown`. Follow the Research Workspace pattern.
- **Verify:** disable and re-enable the add-on with a reader tab open. Watch
  the error console and count the sections.

#### WS-3.6 The Markdown renderer MUST NOT drop content (P1, CONFIRMED)

- **Where:** table rows at `src/modules/components/markdownRenderer.ts:340-343`,
  block openers at `138-182`
- **Now:** the table loop tests `isSeparatorRow(rows[startCells.length ? 0 :
dataStartIndex])`, a constant row, instead of the current row. A line that
  starts with `$$` or a fence but does not end with one is consumed as an
  opener, and the loop then eats the rest of the message.
- **Impact:** a trailing or repeated separator row empties the table body. A
  line such as `$$x$$ is displayed, then prose` loses the first line and wraps
  the remainder in a math block. Assistant content disappears with no error.
- **Required:** MUST iterate `rows.slice(dataStartIndex)` and skip a row when
  that row is a separator. MUST treat a line as a block opener only when it is
  exactly `$$`, or a bare fence with an optional language tag.
- **Verify:** add `test/markdownRenderer.test.ts` with tables, block openers,
  headings, blockquotes, and nested lists. Note WS-10.6 for the math path.

#### WS-3.7 The preferences pane MUST NOT open a modal on every change (P1, CONFIRMED)

- **Where:** `src/modules/preferenceScript.ts:5-6,55-71`, 20
  `data-placeholder-pref` attributes in
  `addon/chrome/content/preferences.xhtml`
- **Now:** each marked input raises `window.alert(PLACEHOLDER_PREF_NOTICE)` on
  `change`. A text field fires `change` on blur, so typing a path and pressing
  Tab opens a modal. The Claude and Gemini inputs lack the attribute, so the
  behavior is inconsistent. The `data-placeholder-label` attributes are read
  by no code.
- **Impact:** this is scaffold code that shipped. It makes the settings pane
  hostile to use.
- **Required:** MUST delete `bindPrefEvents`, the notice constant, and the
  `data-placeholder-*` attributes. MAY render one non-modal note per group.

#### WS-3.8 Swallowed workflow errors MUST reach the log (P2, CONFIRMED)

- **Where:** `src/modules/readerPane.ts:918`, `2705-2711`, `4065-4077`,
  `4144`, `4711`
- **Now:** each catch shows a generic message and drops the error. The status
  probe renders "Error" while `addon.data.codexLastProbeError` exists for this
  purpose.
- **Impact:** these paths wrap subprocess and filesystem work. A field failure
  leaves nothing for a bug report.
- **Required:** MUST log the error in each catch. SHOULD surface the probe
  error in the status text.

#### WS-3.9 `readerPane.ts` SHOULD be split along its existing seams (P2, CONFIRMED)

- **Where:** `src/modules/readerPane.ts`, 4,863 lines. One function spans
  `224-3317` and its `onRender` closure spans `321-3304` with roughly 60
  nested handlers. The 30-field `renderPaneState({...})` literal appears eight
  times, seven of them copies that omit `isCurrent`.
- **Impact:** `docs/architecture.md` already lists this file as a rough edge.
  WS-3.3 and WS-3.4 are direct consequences of the shape. The seven copies let
  a handler write into detached DOM after dispose.
- **Required:** SHOULD introduce one `PaneElements` interface and pass it to
  `renderPaneState`. SHOULD extract in this order.

  | Seam                      | Current span                    | Target module                    |
  | ------------------------- | ------------------------------- | -------------------------------- |
  | Session history panel     | 1244-1515, 3040-3054            | `ui/sessionHistoryPanel.ts`      |
  | Paper Mastery             | 2142-3038                       | `ui/masteryPanel.ts`             |
  | Critical Read wiring      | 812-1186, 4239-4281             | `criticalRead/paneController.ts` |
  | Workbench and compare     | 1778-1945, 3530-3749, 4283-4635 | `ui/workbenchPanel.ts`           |
  | Related and discovery     | 1947-2140, 3750-4034            | `ui/relatedPanel.ts`             |
  | Engine header handlers    | 1548-1717, 3056-3221            | `ui/paneHeaderController.ts`     |
  | Composer and action queue | 3223-3302, 4636-4863            | `ui/composer.ts`                 |

- **Note:** the mastery handlers mutate state in place with `Object.assign`
  at `2554-2557`, `2810-2820`, `2912-2918`, against the immutability rule in
  the user's coding standards. Fix that during the extraction.

#### WS-3.10 Per-item pane state SHOULD be pruned on tab close (P2, CONFIRMED)

- **Where:** maps declared at `src/addon.ts:56-128`, `onDestroy` at
  `src/modules/readerPane.ts:3305-3310`
- **Now:** `onDestroy` clears body WeakMaps only. Eight per-item maps grow for
  the Zotero session. A `pendingReaderActions` entry saved before a session
  exists carries `sessionId: undefined` and applies to whichever session is
  active later.
- **Required:** SHOULD clear an item's entries on reader tab close. MUST stamp
  `sessionId` when queuing a reader action.

#### WS-3.11 Header toggles SHOULD NOT rebuild the transcript (P2, CONFIRMED)

- **Where:** `src/modules/readerPane.ts:3429-3458`
- **Now:** `renderPaneState` clears `chatMessages` and re-renders up to 48
  Markdown messages. Every engine switch, model save, and web-search toggle
  triggers it.
- **Impact:** scroll position resets and open disclosures collapse.
- **Required:** SHOULD split header refresh from transcript refresh and
  re-render the transcript only on a session change.

#### WS-3.12 Inline math SHOULD NOT capture currency (P3, CONFIRMED)

- **Where:** `src/modules/components/markdownRenderer.ts:37`
- **Now:** the pattern matches `$5 and $` in "It costs $5 and $10 per unit."
- **Required:** SHOULD require a non-space after the opening `$` and a
  non-space before the closing `$`, and reject a following digit.

#### WS-3.13 Placeholder restoration SHOULD use a function replacer (P3, CONFIRMED)

- **Where:** `src/modules/components/markdownRenderer.ts:55-57`
- **Now:** `String.replace(string, string)` interprets `$` sequences in the
  replacement and can be pre-empted by a literal placeholder in model text.
- **Required:** SHOULD use a pattern with a function replacer, and SHOULD
  strip control characters from the input first.

#### WS-3.14 The selection popup SHOULD use the token system (P3, CONFIRMED)

- **Where:** `src/modules/readerActions.ts:102-109`
- **Now:** inline `cssText` hardcodes `#d0d0d0` and `#fff`, the only place in
  this area that bypasses `zoteroPane.css` and its dark-mode block.
- **Required:** SHOULD apply the existing button classes.

#### WS-3.15 The session kebab menu SHOULD dismiss on outside click (P3, CONFIRMED)

- **Where:** `src/modules/readerPane.ts:1433-1450`
- **Now:** the menu closes only when another kebab opens or the panel
  re-renders. The engine popover already uses `ui/popoverDismissal.ts` and
  Escape.
- **Required:** SHOULD reuse `popoverDismissal.ts` and register the listener in
  the cleanup tasks.

## 9. WS-4 — Research Workspace persistence integrity

#### WS-4.1 A half-written project MUST be recoverable (P0, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/persistence/projectRepository.ts:447-464,485-489`,
  caller at `src/modules/researchWorkspace/projectController.ts:203-218`
- **Now:** `createProject` writes `project.json` first and `members.json`
  second. A failure on the second write leaves a directory with a project and
  no members. `getProject` then throws a plain `Error`, not
  `ResearchWorkspaceNotFoundError`, so `ensureQuickProject` never recreates
  it. `writeNew` would refuse anyway because `project.json` exists.
  `recoverStartup` logs a warning and repairs nothing.
- **Impact:** quick projects use `quick-<hash of sorted sourceIDs>` as the id.
  Every later single-paper analysis of that same paper set fails with
  "Project ... is missing members.json." The user has no in-app recovery.
  Reproduced with a fake `fileOps` that fails the second write.
- **Required:** MUST make the state recoverable. Either treat a missing
  `members.json` beside a valid `project.json` as repairable and recreate it at
  revision 0 with a warning, or write `members.json` first and make
  `project.json` the commit marker with `repairCatalog` removing incomplete
  directories.
- **Verify:** add a repository test that fails the second write and then
  asserts the project opens.

#### WS-4.2 Cross-file mutations MUST have a repair path, and the doc MUST say so (P1, CONFIRMED)

- **Where:** `docs/architecture.md:245-246` claims "Writes are atomic and
  revision guarded". Sequences at `projectRepository.ts:926-1027`
  (`createArtifact`), `1379-1421` (`createRun`), `723-749` (`updateMembers`),
  `710-721` (`deleteProject`).
- **Now:** each file write is atomic. The sequences are not. `createArtifact`
  writes the artifact file, then mutates `project.json` with a revision
  captured before the model run, then updates the previous version, then
  propagates staleness, then syncs the catalog.
- **Impact:** a failure after the artifact write leaves an orphan file that no
  `artifactIDs` entry references. `ensureArtifactReference` exists but only
  the migration calls it. A user edit that bumps `project.json` during a run
  makes the mutate throw a revision conflict after the model already finished,
  so the output is on disk and invisible. A crash during `deleteProject`
  leaves a catalog entry with no directory.
- **Required:** MUST reword `docs/architecture.md` to per-file atomicity with
  a named repair story. MUST extend `repairCatalog` and `recoverStartup` to
  scan `artifacts/` and `runs/` for unreferenced files and either re-link or
  quarantine them. SHOULD retry `createArtifact` on a revision conflict by
  re-reading `project.json` instead of failing the completed run.

#### WS-4.3 The unchanged-artifact guard MUST actually work (P1, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/persistence/projectRepository.ts:1038,1059,1066-1068`
- **Now:** `updatedAt` is assigned before the `JSON.stringify` comparison, so
  `changed` is true whenever the clock advanced by a millisecond. The guard
  works only under a frozen test clock.
- **Impact:** an identity update bumps the revision and marks every dependent
  artifact stale with `upstream-artifact-changed`. The lineage check in
  `assertDerivedInputsCurrent` then rejects the next derived run. A measured
  identity update costs 171 file reads.
- **Required:** MUST compare before assigning `updatedAt`. MUST return
  `undefined` from the mutate callback when nothing changed, which
  `fileStore.mutate` already treats as a skip.
- **Verify:** add a test with a moving clock that asserts the revision and the
  dependents are untouched.

#### WS-4.4 `artifactHistoryLimit` MUST be enforced or removed (P1, CONFIRMED)

- **Where:** declared at `persistence/contracts.ts:410`, defaulted at
  `projectRepository.ts:99`, range-checked at `persistence/validation.ts:847-854`.
  No other reference in `src/`.
- **Now:** `createArtifact` supersedes the previous version and deletes
  nothing. Every mastery question and every answer creates an artifact file
  plus a run file.
- **Impact:** artifact count grows without bound, and `listArtifacts` reads
  every file on every project operation. The preference promises a bound that
  does not exist.
- **Required:** MUST prune superseded artifacts of the same type, operation,
  and source set beyond the limit, oldest first, skipping any artifact
  referenced by another artifact's lineage. Or MUST remove the preference.

#### WS-4.5 Migration MUST NOT overwrite an existing source or reset review state (P1, PLAUSIBLE)

- **Where:** `src/modules/researchWorkspace/persistence/legacyMigration.ts:683,696-704`
- **Now:** `putSource(record)` runs with no `expectedRevision`, a blind
  overwrite. The following `addMembers` passes explicit `role: "candidate"` and
  `reviewStatus: "unreviewed"`, and `addMembers` prefers the explicit value
  over the stored one while preserving `screeningEvents`.
- **Impact:** an existing source record loses its fingerprints and
  availability, which invalidates artifacts in every project sharing that
  source. On a resumed migration, an already-screened member either loses its
  status or makes `assertResearchWorkspaceMember` throw on every startup.
- **Confirm with:** migrate, screen one member, then migrate again.
- **Required:** MUST read the source first and skip or merge instead of
  overwriting. MUST pass only `sourceID` to `addMembers` so the stored role and
  review status survive.

#### WS-4.6 Imported legacy artifacts MUST bind to a capability (P1, CONFIRMED)

- **Where:** `legacyMigration.ts:768` writes
  `operation: "legacy-import:<type>"`. `legacyCapabilityAdapters.ts:17-51`
  lists `critical-read`, `paper-mastery`, `paper-mastery-grade`,
  `paper-compare`, `quick-compare-v0`. No `legacy-import:*` entry.
- **Impact:** `readResearchWorkspaceArtifact` returns
  `capabilityID: undefined, legacy: false`, so migration output carries no
  legacy marker even though the migration test is titled "creates stale legacy
  artifacts". Imported mastery stores the payload as `paper.mastery` while the
  facade reads `payload.session`, so resuming an imported session silently
  starts a new one.
- **Required:** MUST emit the canonical legacy operation per type, or MUST add
  `legacy-import:<type>` to each definition. MUST wrap imported mastery as
  `{ session: ... }` or teach the lookup to accept both shapes.

#### WS-4.7 `addPapers` MUST retry a revision conflict (P1, PLAUSIBLE)

- **Where:** `src/modules/researchWorkspace/projectController.ts:228-251,258-273`
- **Now:** the controller reads the source, then writes it with the observed
  revision, with no catch. Living Review writes the same source files from a
  notifier burst and handles the conflict by returning false.
- **Impact:** starting an analysis while a PDF is re-indexed surfaces
  "Research Workspace revision conflict ... expected 3, found 4" and the run
  never starts.
- **Required:** MUST wrap the read-then-write in a bounded retry, as Living
  Review does for the change inbox. SHOULD move `addPapers` inside the project
  claim so two runs cannot interleave source writes.

#### WS-4.8 `validation.ts` SHOULD cover every contract field (P2, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/persistence/validation.ts`
- **Now:** every parser ends with `return value as X` after checking a subset
  of keys. Unvalidated fields include `artifact.checkpoint`, `artifact.payload`
  for every type except `citation-health`, `run.progress`, `source.creators`,
  and the member note fields. Timestamps use a text check, not an ISO check,
  while sorting relies on ISO lexical order. `maxPaperCharacters` accepts the
  string `"100000"` and returns it unchanged.
  `assertResearchWorkspaceMember` runs before `screeningEvents` is checked to
  be an array, so a bad value throws a `TypeError` instead of a validation
  error.
- **Impact:** the `@ts-nocheck` comment claims strict runtime parsers guard the
  core. For payloads that is true for one type. A corrupt `checkpoint` flows
  into the incremental reuse logic. A non-ISO timestamp breaks artifact
  ordering.
- **Required:** SHOULD validate every field in `contracts.ts`, SHOULD use the
  ISO check for all timestamps, SHOULD return normalized copies instead of
  casts, and MUST move the member assertion after the type checks. MAY adopt a
  schema validator instead of extending the hand-rolled checks.

#### WS-4.9 The atomic write SHOULD flush, and stray temp files SHOULD be removed (P2, PLAUSIBLE)

- **Where:** `src/modules/researchWorkspace/storage.ts:86-119`
- **Now:** the code writes a temp file and renames it, with no flush. A crash
  between write and rename leaves a `*.tmp-*` file that nothing lists or
  removes. The non-`IOUtils` fallback writes in place and is not atomic.
- **Required:** SHOULD use the single-call form with `tmpPath` and `flush`.
  SHOULD have `recoverStartup` remove stray temp files. MUST either throw
  instead of the in-place fallback or document the fallback as non-atomic.

#### WS-4.10 Missing-file detection MUST NOT match an error message (P3, CONFIRMED)

- **Where:** `projectRepository.ts:1134-1146`,
  `livingReviewService.ts:189-199`, message source at
  `persistence/fileStore.ts:73`
- **Now:** two call sites compare the exact error text.
- **Impact:** a wording change turns a benign "deleted meanwhile" into a thrown
  error that aborts staleness propagation or a project scan.
- **Required:** MUST add a typed error to `contracts.ts` and use `instanceof`.

#### WS-4.11 `updateMember` MUST reject an unknown source (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/projectController.ts:339-372`
- **Now:** an unmatched `sourceID` still writes the members file and bumps both
  revisions.
- **Impact:** a stale UI row silently forces the next real edit into a revision
  conflict.
- **Required:** MUST throw the not-found error, as the screening decision path
  already does.

#### WS-4.12 The extractor version SHOULD have one source (P3, CONFIRMED)

- **Where:** `projectController.ts:79-82`,
  `src/modules/tools/paperWorkspaceContent.ts:44`, `package.json` caret range
- **Now:** two files hardcode `opendataloader-pdf@2.2.0` while the dependency
  is `^2.2.0`.
- **Impact:** an extractor upgrade never invalidates a fingerprint.
- **Required:** SHOULD export one constant derived from the installed package
  version and import it in both places.

#### WS-4.13 `runIncremental` SHOULD NOT report `complete` with pending units (P3, PLAUSIBLE)

- **Where:** `src/modules/researchWorkspace/operationCoordinator.ts:577-589,838`
- **Now:** the status is `failedUnits.length ? "partial" : "complete"` while
  `pendingUnits` may be non-empty. The reuse predicate ignores
  `promptVersion` and `schemaVersion`.
- **Required:** SHOULD include `pendingUnits` in the status decision. SHOULD add
  both versions to the reuse predicate.

## 10. WS-5 — Evidence and contract fidelity

#### WS-5.1 A verified locator MUST match content (P1, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/evidenceVerification.ts:235-255`,
  consumed by `contradictionGap.ts:221-225` and gated by
  `artifactRenderer.ts:1575-1585`
- **Now:** when a candidate has no exact quote, the verifier accepts any
  structured chunk whose `elementId` equals the model-supplied `elementID` and
  returns `verification("verified", "structured-element")`. The element ids are
  written into the workspace, so the model can read them.
- **Impact:** a model can attach any valid element id to any statement and
  obtain the `verified` status, an Open in PDF action, and admission to the
  contradiction dashboard. `docs/architecture.md:80-87` describes exact local
  quote matching only. The weaker path is intentional per
  `test/researchWorkspaceEvidenceVerification.test.ts:112`, but no document
  states it.
- **Required:** MUST close the gap in one of two ways. Either require the chunk
  text to contain the candidate quote and downgrade otherwise, or keep the path
  under a distinct label, exclude it from the verified-evidence sets used by
  the contradiction dashboard and the claim ledger, and document it in
  `docs/architecture.md`.
- **Verify:** add a test where a valid element id carries an unrelated
  statement, and assert the downgrade or the distinct label.

#### WS-5.2 Parsers MUST reject invalid required and enum fields (P1, CONFIRMED)

- **Where:** `core/crossPaperMastery/parser.ts:26,51,66,69,104,106-107`,
  `core/paperToCode/parser.ts:14-19,43,80,130`,
  `core/reproducibility/parser.ts:42,48,97-99,134,191`,
  `core/evidence/claimExtraction.ts:66-69`,
  `core/literatureGraph/parser.ts:71`,
  `core/evidenceMatrix/parser.ts:49`,
  `core/criticalRead/profiled/parser.ts:69`,
  `core/citationStance/parser.ts:40,57`
- **Now:** 19 sites substitute a default for a missing or invalid required
  field. `difficulty` falls back to `advanced`, `risk` to `unknown`,
  `confidence` to a fabricated `0.7` or `0.35`, and text fields to
  "Unspecified operation". The strict `enumValue` in
  `core/comprehensionCheck/v2/validation.ts:25-31` shows the intended shape.
- **Impact:** `docs/prompt-contracts.md:189` promises rejection so the
  correction run can repair the output. Instead malformed output persists as
  valid. A fabricated confidence becomes a stored reproducibility signal that
  Citation Health later reports. `difficulty` feeds the mastery completion
  gate.
- **Required:** MUST use one shared `enumValue` that throws. MUST treat a
  missing `confidence` as absent instead of inventing one.
- **Verify:** add rejection tests for an invalid `difficulty`, `risk`,
  `severity`, and a non-numeric `confidence`.

#### WS-5.3 The cross-paper grade parser MUST read the top-level feedback (P1, CONFIRMED)

- **Where:** `core/crossPaperMastery/parser.ts:114-179`, schema at
  `outputSchemas.ts:314-326`, prompt at `core/crossPaperMastery/prompt.ts:13`
- **Now:** the parser never reads `root.feedback`. `service.ts` rebuilds a
  feedback string by joining the per-criterion values.
  `test/researchWorkspaceOutputSchemas.test.ts:101` asserts the schema key
  exists, so the drift passes the suite.
- **Impact:** the model's holistic diagnosis is requested and discarded.
- **Required:** MUST read `root.feedback`. MUST change the schema test to
  round-trip a fixture through the parser instead of comparing key lists.

#### WS-5.4 Paper text MUST NOT be able to close its own delimiter (P1, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/contextPlanner.ts:265-267`,
  `projectWorkspaceBuilder.ts:83-85`
- **Now:** the inner `<paper source_id=...>` block embeds raw PDF text. The
  outer `sourceBlock` escapes only its own closing tag.
- **Impact:** a PDF containing `</paper>` closes the inner block. The outer
  block still holds, so this is a hardening gap rather than an open hole.
  `docs/prompt-contracts.md:187` states that inner delimiters are escaped.
- **Required:** MUST apply the same closing-tag escape to the embedded text.
- **Verify:** add a test with `</paper>` inside the paper text.

#### WS-5.5 Paper Mastery prompts MUST carry the injection guardrail (P1, CONFIRMED)

- **Where:** `src/modules/comprehensionCheck/prompt.ts:144-163,165-208,210-248`
- **Now:** `buildInitialMasteryPrompt` has no source-data rule. The evaluate
  and follow-up prompts label the JSON block only. The shared preamble in
  `context/promptPreviewBuilder.ts:48` does add the rule, so this is defense in
  depth.
- **Impact:** `docs/prompt-contracts.md` promises a per-prompt guardrail for
  Paper Mastery JSON turns. The reader answer is the most attacker-adjacent
  input in this workflow.
- **Required:** MUST add the guardrail line used by
  `criticalRead/prompt.ts:455` to all three builders.
- **Verify:** extend `test/comprehensionCheckPrompt.test.ts` to assert it.

#### WS-5.6 Direction detection SHOULD test negation first (P2, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/contradictionGap.ts:632-647`
- **Now:** the positive pattern runs before the negation check, and numbers
  contribute sign only.
- **Impact:** "no improvement", "did not outperform", and "higher latency" read
  as positive. "Reduced error" reads as directionless. Comparability gating
  usually yields `uncertain`, but each pair still emits a gap and a next search
  question.
- **Required:** SHOULD test negation first, SHOULD make polarity metric aware,
  and SHOULD treat a raw number as directionless unless the column is a delta.

#### WS-5.7 Prompt examples SHOULD instantiate their schema (P2, CONFIRMED)

- **Where:** `core/criticalRead/profiled/prompt.ts:27`,
  `core/reproducibility/prompt.ts:15`,
  `core/evidence/claimExtraction.ts:27-30`, schema at `outputSchemas.ts:32-56`
- **Now:** the example evidence object carries three keys. The schema requires
  nine in a closed object.
- **Impact:** the native-schema path and the prompt-plus-parser path accept
  different shapes for the same workflow. The non-native path works only
  because the source lookup falls back to a unique attachment key.
- **Required:** SHOULD generate the example from the schema with null
  placeholders.

#### WS-5.8 Screening supersession MUST form a single chain (P3, CONFIRMED)

- **Where:** `persistence/validation.ts:425-434`, writer at
  `projectController.ts:481-494`
- **Now:** validation requires only that `supersedesEventID` refers to an
  earlier event. The writer is correct.
- **Impact:** a forked chain in an edited `members.json` loads cleanly, and
  "current" is decided by array position.
- **Required:** MUST require the superseded id to equal the previous event id.

#### WS-5.9 Correction signals SHOULD NOT fire on ordinary title words (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/citationHealth.ts:29-43,1174-1197`
- **Now:** a title containing "withdrawal" or "retraction" produces a `high`
  severity finding.
- **Required:** SHOULD restrict the match to the extra field and tags, or to a
  title prefix, and SHOULD lower a title-only hit to `review`.

#### WS-5.10 The grader MUST NOT read the learner's confidence from the model (P3, CONFIRMED)

- **Where:** `core/crossPaperMastery/parser.ts:164-170`
- **Now:** `Number(params.learnerConfidence ?? root.learnerConfidence) || 0`
- **Impact:** calibration compares learner confidence with the score. The model
  can set it.
- **Required:** MUST ignore `root.learnerConfidence`.

#### WS-5.11 Citation identity SHOULD NOT resolve on a substring (P3, PLAUSIBLE)

- **Where:** `src/modules/researchWorkspace/citationContextExtraction.ts:425-441,512-516`
- **Now:** a parsed title of eight or more characters resolves to whichever
  single library item contains it, at 0.9 confidence. The resolver also mutates
  the shared cached reference object.
- **Required:** SHOULD require normalized equality or token overlap plus year.
  MUST replace the mutation with a copy.

## 11. WS-6 — Discovery network boundary

The address classification here is stronger than its documentation. These
requirements close the remaining gaps and correct the two claims that do not
hold.

#### WS-6.1 Open-world venue authority MUST match the documented rule (P1, CONFIRMED)

- **Where:** `src/modules/discovery/workflow.ts:146-195`, used at `1257-1260`
- **Now:** `authorityValidated` is true when the source family is not generic,
  or the hostname is a known authority, **or**
  `hasVenueNamedDomainAuthority` finds that the registrable label equals the
  venue acronym or the joined venue name.
  `docs/prompt-contracts.md` states that a generic venue site requires a
  corroborating link from a reconstructed known publisher, and that "a
  venue-looking hostname is not ownership proof".
- **Impact:** any registrable domain whose second-level label equals the venue
  acronym, plus a page that looks like a program listing, becomes primary-lane
  evidence. The existing test proves a subdomain and a near-miss label fail. An
  exact-label look-alike under another TLD passes by design. The agent reads
  untrusted web pages, so a hostile page can steer it toward such a domain.
- **Required:** MUST resolve the disagreement. Either drop the label-equality
  disjunct and require a known authority hostname, or keep it, state it in
  `docs/prompt-contracts.md` and `docs/architecture.md`, and add a negative
  test for an exact-label look-alike so the accepted risk is explicit.

#### WS-6.2 Provider evidence MUST be built from the bound URL (P1, CONFIRMED)

- **Where:** `src/modules/discovery/workflow.ts:1274-1286,1302-1309`
- **Now:** `providerEvidence` maps `providerCandidate.urls.slice(0, 1)`, then a
  later filter keeps only entries whose URL appears in `boundProviderURLs`.
- **Impact:** Semantic Scholar and OpenAlex list the landing page first and the
  open-access URL second. A `preprint_only` row bound through the second URL
  ends with empty evidence, fails the novelty-lane check, and is dropped as an
  unsupported claim. When a discovery finds only preprints,
  `normalizeResult` then throws "did not include any usable papers" and the
  whole run fails. The existing test covers only the no-shared-URL case.
- **Required:** MUST map `boundProviderURLs.slice(0, 1)` instead.
- **Verify:** add a test where the provider's first URL is a landing page and
  the bound arXiv URL is second.

#### WS-6.3 The blind-request residual MUST be documented (P1, CONFIRMED)

- **Where:** `src/modules/discovery/providers/officialEvidence.ts:464-537`
- **Now:** the pre-connect DNS check and the per-hop URL check run before the
  request. The connected-remote address check runs on `readystatechange` and
  `progress`, which is after the GET reaches the wire. `defaultResolveHost`
  returns an empty list when the DNS service is missing, and the pre-check then
  passes silently.
- **Impact:** a rebinding resolver can still deliver a GET with an
  attacker-chosen path to an internal service. The response body is withheld,
  so this is blind request delivery, not data exfiltration.
  `docs/architecture.md` describes the per-hop checks accurately and does not
  mention this residual.
- **Required:** MUST record the residual in `docs/architecture.md`. MUST make
  the missing-DNS case explicit instead of a silent pass. SHOULD pin the
  resolved address at connect time where the platform allows it.

#### WS-6.4 Official evidence URLs SHOULD be restricted to the default port (P2, CONFIRMED)

- **Where:** `src/modules/discovery/providers/officialEvidence.ts:96-114`
- **Now:** the check covers protocol, hostname, and address class. It never
  inspects the port.
- **Impact:** a public host can expose a non-web service on a high port.
- **Required:** SHOULD require an empty port, or an explicit small allowlist.

#### WS-6.5 The OpenReview notes API SHOULD have its own body budget (P2, PLAUSIBLE)

- **Where:** `src/modules/discovery/providers/officialEvidence.ts:796-813`
- **Now:** the API response shares the 200 KB HTML cap. A truncated body fails
  `JSON.parse`, both hosts fail, and the official status derivation never runs.
- **Impact:** a well-reviewed forum returns every note including full review
  text and can exceed the cap. Combined with the anonymous challenge gate,
  OpenReview-only venues become unverifiable.
- **Confirm with:** a measured `/notes?forum=` payload for a large forum.
- **Required:** SHOULD pass a larger explicit budget for the API path, or
  request only the needed fields. SHOULD report truncation as a distinct
  limitation.

#### WS-6.6 HTML scanning SHOULD NOT use backtracking patterns over 200 KB (P2, PLAUSIBLE)

- **Where:** `src/modules/discovery/providers/officialEvidence.ts:554-589`
- **Now:** `stripHtml` and `linkedHostnames` use lazy `[\s\S]*?` patterns with
  a required closing tag, over untrusted markup, on the main thread.
- **Impact:** many unclosed openers degrade the scan toward quadratic time.
  Input bounding makes it finite, not fast.
- **Confirm with:** a crafted fixture and a timing run.
- **Required:** SHOULD use a single-pass tokenizer, or bound the scan to the
  first slice that the heuristics actually read.

#### WS-6.7 Scholarly providers SHOULD bound the body and back off correctly (P2, CONFIRMED)

- **Where:** `src/modules/discovery/providers/scholarly.ts:29-37`,
  `providers/search.ts:76-99`
- **Now:** `response.json()` has no size cap. The retry loop backs off 150 ms
  and 300 ms regardless of status, so a 429 is retried twice inside half a
  second. No polite-pool identification is sent.
- **Note:** the privacy boundary itself holds. Only bounded, stripped query
  terms leave the machine, and the test at
  `test/discoveryProviders.test.ts:439` pins that.
- **Required:** SHOULD skip the retry on a 4xx or honor `Retry-After`. SHOULD
  cap the JSON body. SHOULD send a contact header for the providers that ask
  for one.

#### WS-6.8 Live verification SHOULD run with bounded concurrency (P3, CONFIRMED)

- **Where:** `src/modules/discovery/workflow.ts:1148-1223`
- **Now:** the loop inspects each evidence URL in sequence, with up to two
  attempts at 15 s each, plus the OpenReview calls.
- **Impact:** 24 rows with two URLs each can consume ten minutes of the
  30-minute budget before the pane updates. The absolute deadline is honored,
  so this is latency, not a hang.
- **Required:** SHOULD run three or four inspections in flight with the same
  signal and deadline.

#### WS-6.9 The provider cache SHOULD evict, and the clock SHOULD be single-source (P3, CONFIRMED)

- **Where:** `src/modules/discovery/providers/search.ts:10-13,115-116,135-138`
- **Now:** expiry is checked on hit only, so the module-level map grows for the
  session. `now` is injectable while the default deadline uses the wall clock.
- **Required:** SHOULD evict expired keys on write or cap the map. SHOULD derive
  the deadline from the injected clock.

#### WS-6.10 Structured candidates SHOULD precede the final format instruction (P3, CONFIRMED)

- **Where:** `src/modules/relatedRecommendations.ts:779-793,814-818`, prompt
  end at `discovery/prompt.ts:411`
- **Now:** up to 40 candidates with unbounded abstracts are appended after the
  "response MUST begin with '{'" line.
- **Impact:** the format instruction is buried for engines without native
  schema support.
- **Required:** SHOULD accept the candidate block inside the question builder
  and place it before the closing instruction. SHOULD truncate each abstract.

## 12. WS-7 — Zotero write paths

Three code paths mutate the user's library. Each one needs a tighter
invariant.

#### WS-7.1 Auto-highlight MUST NOT place a highlight on a weak match (P0, CONFIRMED)

- **Where:** `src/modules/autoHighlight/pdfMatch.ts:101-112,610-626`, consumed
  by `autoHighlight/workflow.ts:227-247`
- **Now:** `normalizeQuoteText` keeps only `[0-9a-z가-힣]`, so it strips Greek,
  CJK, Cyrillic, accented Latin, and all punctuation. `matchQuoteInPages` then
  takes the first `indexOf` hit on any page. There is no minimum length and no
  uniqueness check.
- **Impact:** `Δ = 0.5` normalizes to `05`. `Theorem 1` normalizes to
  `theorem1`. The first page position containing that residue receives a
  highlight annotation in the user's PDF. The prompt asks for one or two
  sentences, and nothing enforces it. This is the highest-impact write in the
  product.
- **Required:** MUST reject a candidate whose normalized quote is shorter than
  a stated threshold, and whose retained-character ratio falls below a stated
  fraction. MUST keep letters from all scripts instead of the current class.
  MUST require uniqueness, or MUST prefer the longest match when a quote
  repeats.
- **Verify:** add cases for a short quote, a Greek quote, a CJK quote, and a
  quote that appears twice.

#### WS-7.2 Sync MUST NOT create a tag through name normalization (P0, PLAUSIBLE)

- **Where:** `src/modules/researchWorkspace/zoteroSyncRuntime.ts:98-100,251-280,504-507`,
  `zoteroSync.ts:172-178,213-221,509-517`
- **Now:** `text()` collapses whitespace runs. Both the observed tag list and
  the per-item tag list pass through it, and apply writes the collapsed name
  with `item.addTag(tagName)`.
- **Impact:** Zotero has no separate tag-creation call. `addTag` attaches the
  given name and materializes the tag when it does not exist. A library tag
  whose raw name differs from its collapsed form is reported as existing under
  the collapsed name, and apply then creates that name. The post-apply check
  collapses too, so it cannot detect the difference. This breaches the
  documented "never creates ... tags" invariant.
- **Confirm with:** a tag named with two consecutive spaces, selected as a sync
  target, in real Zotero.
- **Required:** MUST NOT transform tag names. MUST compare raw strings, trimmed
  at most in the same way Zotero trims. MUST mark a selected tag blocked when
  its raw name is not byte-equal to an observed raw name.
- **Verify:** add a runtime test with a two-space tag. Add the manual QA step.

#### WS-7.3 Recommendations MUST NOT write unverified metadata into an existing item (P1, CONFIRMED)

- **Where:** `src/modules/relatedRecommendations.ts:1208-1226`
- **Now:** for an item that already exists in the library, `fillIfMissing`
  writes `DOI`, `publicationTitle`, and `url` from the recommendation. The live
  verifier reconstructs evidence but leaves `paper.doi` and `venueName` as the
  agent supplied them. The local `normalizeDOI` also lacks the format
  validation of `normalizeDiscoveryDOI`.
- **Impact:** a hallucinated DOI or venue is persisted into the user's
  pre-existing Zotero record, which the user did not create through Paper
  Pilot.
- **Required:** MUST fill the DOI only when the page or a provider corroborated
  it. MUST leave existing items untouched otherwise and record the value in
  `extra` instead. MUST reuse `normalizeDiscoveryDOI`.

#### WS-7.4 Auto-highlight annotations MUST be identifiable and cancellable (P1, CONFIRMED)

- **Where:** `src/modules/autoHighlight/annotation.ts:38-49`,
  `autoHighlight/workflow.ts:85-110,161-165`
- **Now:** the payload carries no tag or comment that names Paper Pilot. The
  `text` field stores the model's quote, not the matched PDF text. The workflow
  polls 300 times at 800 ms, a private four-minute limit unrelated to
  `RUN_TIMEOUT_MS`, and accepts no signal.
- **Impact:** users cannot filter or bulk-remove generated highlights, and
  `isDuplicateHighlight` cannot separate a user highlight from a generated one.
  The stored text can differ from the highlighted span. A long paper on a
  slower engine is killed silently, and the repair pass doubles the wall time.
- **Required:** MUST add an ownership tag or comment. MUST rebuild `text` from
  the matched spans. MUST accept the shared signal and deadline, as the
  discovery run does.

#### WS-7.5 The project surface MUST guard in-flight actions (P1, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/projectWindowView.ts:124-126,454-477,770-795,2354-2355`
- **Now:** the render generation symbol is minted once per surface and passed
  unchanged into every nested `renderProject`, so two overlapping renders both
  pass `isCurrent` and both replace the children. No handler disables its
  button before the await.
- **Impact:** a double click on "Apply approved additive sync" queues a second
  apply. The service serializes and rejects it, and the error banner then lands
  on a freshly rendered project, so the user sees a failure after a success.
  The slower of two renders wins even when it loaded an older revision, which
  forces the next save into a revision conflict. The data is protected by the
  service. The user experience on the main write path is not.
- **Required:** MUST mint a new generation per `renderProject` so a stale
  render aborts. MUST route every action through one helper that marks the
  surface busy for the duration.

#### WS-7.6 Project action handlers MUST report and log failures (P1, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/projectWindowView.ts:84-99,543-587,2317-2340`,
  `window.ts:48-62,127-131,307-315`
- **Now:** `node.addEventListener("click", () => void action())` with no catch
  in the archive, delete, add-papers, and open handlers. "Start a new
  selection" clears the window state and closes the window before the new
  capture runs.
- **Impact:** a rejection becomes an unhandled promise rejection with no banner
  and no log. "Add captured papers" leaves the status at "Adding captured
  papers...". A failure during recapture leaves the user with no window and no
  message, and the menu is the only way back.
- **Required:** MUST catch, report, and log in the shared action helper from
  WS-7.5. MUST create the new dialog before closing the old one.

#### WS-7.7 The observed-state fingerprint SHOULD be narrowed (P2, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/zoteroSync.ts:213-221,406-410`,
  `zoteroSyncRuntime.ts:263-280`
- **Now:** the fingerprint spans every distinct tag name in the library, with a
  100,000 entry cap and a 500 character per-entry limit.
- **Impact:** any tag added or renamed anywhere between preview and apply
  rejects the apply, including a change synced from another device. The
  behavior fails closed, so it is safe. On a large group library, apply may be
  practically unreachable.
- **Required:** SHOULD fingerprint the selected targets only, and SHOULD
  re-check the selected tag names at apply time.

#### WS-7.8 Local search hits SHOULD NOT claim the verifier (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/view.ts:426-450`
- **Now:** a local hit is stamped `status: "verified"`,
  `method: "structured-element"`, with a fresh `verifiedAt` and
  `verifierVersion: "paperpilot-evidence-v2"`, without running the verifier.
- **Impact:** navigation stays safe because it re-checks identity. The
  provenance fields misrepresent how the object was produced.
- **Required:** SHOULD use a distinct method label with no verifier version, or
  SHOULD route the hit through the real verifier.

#### WS-7.9 The item pane section SHOULD stay disabled for unsupported items (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/view.ts:1011-1016`
- **Now:** the section is enabled for any item, then renders "No PDF attachment
  found for this item." for a note.
- **Required:** SHOULD also require a regular item or a PDF attachment.

#### WS-7.10 The reader bridge SHOULD NOT click DOM nodes (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/canonicalReaderCapability.ts:11-59`
- **Now:** the capability finds a button by element id and calls `click()`,
  polling eight times at 125 ms.
- **Impact:** renaming a button id in `readerPane.ts` breaks the bridge
  silently. A pane build slower than one second returns a failure with no
  retry.
- **Required:** SHOULD expose a programmatic entry point from `readerActions.ts`
  and call that.

## 13. WS-8 — Retrieval, session data, and language

#### WS-8.1 Tokenization MUST handle every supported script (P1, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/core/context/hybrid/tokenizer.ts:60-65,80,111`,
  `src/modules/context/retriever.ts:3-20,42-52`
- **Now:** the hybrid tokenizer matches
  `[a-z0-9]+|[가-힣]+|[α-ωΑ-Ω]+` after stripping everything else, and the
  Greek class never matches because the input is already lowercased. The
  reader-pane retriever splits on `[^a-z0-9가-힣]+` and scores a chunk by
  counting substring hits, one point per token.
- **Impact:** measured with the real modules. A Chinese sentence and a Japanese
  sentence both tokenize to an empty list, so a two-chunk index has zero
  document frequencies and every chunk scores the same constant. German and
  French words split into fragments. In the reader pane the effect is that
  `selection.json.retrievedChunks` for a Chinese question is always the first
  `topK` chunks of the paper, in document order. `responseLanguage` supports
  Chinese, so this is a supported path. `contextPlanner.ts:51` already uses the
  Unicode property classes correctly, so the two retrieval paths disagree on
  what a word is.
- **Required:** MUST use Unicode property classes for letters and numbers.
  MUST add a script branch for Han, Hiragana, and Katakana that emits
  character bigrams, in the shape of the existing Korean n-gram path. MUST fold
  diacritics before matching. SHOULD drop very short tokens and a small
  stopword list in the reader-pane scorer, and SHOULD score by term frequency
  rather than substring presence.
- **Verify:** add tokenizer and retriever tests for Chinese, Japanese, Korean,
  and accented Latin input, plus a stopword-only query.

#### WS-8.2 Corrupt and future snapshots MUST be handled explicitly (P1, CONFIRMED)

- **Where:** `src/modules/session/sessionHistoryRepository.ts:257-274,390-405`
- **Now:** `JSON.parse` failure returns `undefined` with no log and leaves the
  file in place. The on-disk `storageVersion` is overwritten on save and never
  compared. A file containing `[]` or `"text"` passes the truthiness guard and
  reaches `applySessionSnapshot`.
- **Impact:** a half-written snapshot makes a session vanish from Past sessions
  with no explanation, and the bad file stays forever. A snapshot written by a
  future version is read as the current version and its unknown fields are
  discarded on the next save.
- **Required:** MUST validate the minimal shape before use. MUST refuse a
  `storageVersion` above the current one with a logged reason. SHOULD rename an
  unparseable file rather than leave it.
- **Verify:** add repository tests for `[]`, a string, and a future version.

#### WS-8.3 The silent-turn filter MUST NOT hide prose (P1, CONFIRMED)

- **Where:** `src/modules/session/silentTurnFilter.ts:16-51,62-80`
- **Now:** one line that parses as an object with two known keys hides the
  whole assistant record. Only backtick fences are recognized. A
  pretty-printed object over several lines is not detected.
- **Impact:** measured with the real module. "Sure. Example config:" followed
  by one unfenced JSON line hides the entire reply on replay, with no
  indicator. The legacy tool turns the filter exists for, which were
  pretty-printed, are still shown. The key set includes ordinary words such as
  `summary`, `kind`, `question`, and `confidence`.
- **Required:** MUST require the JSON to constitute the whole message, or
  nearly all of it, rather than one line. MUST recognize tilde fences and
  indented code. SHOULD accept a multi-line object by parsing the trimmed full
  text.
- **Verify:** add both measured cases as regression tests.

#### WS-8.4 The nearby-context source map MUST survive case folding (P2, CONFIRMED)

- **Where:** `src/modules/context/nearbyContext.ts:19-20,39-45`
- **Now:** the builder pushes one source index per input character, but
  `toLowerCase()` can produce two UTF-16 units for one input character. Every
  later index then drifts.
- **Impact:** measured. Text prefixed with ten dotted capital I characters
  returns the wrong "Before selection" text. Turkish, Azerbaijani, and
  Lithuanian papers are affected. The engine is told this is the real
  surrounding text.
- **Required:** MUST push one source index per output code unit. SHOULD strip
  Markdown syntax before matching, because the source text is OpenDataLoader
  Markdown when extraction succeeded. SHOULD prefer the occurrence nearest the
  current page marker.

#### WS-8.5 The chunk index store SHOULD be library-scoped and bounded (P2, CONFIRMED)

- **Where:** `src/modules/context/indexStore.ts:11-34`, key built at
  `codex/runner.ts:174`
- **Now:** the store keys on the bare item key, never evicts, and
  `clearIndexedChunks` has no caller. Chunks are larger than the paper text
  because of overlap.
- **Impact:** a long Zotero session accumulates tens of megabytes that are
  released only at shutdown. Item keys are unique per library, not globally,
  so a personal and a group item can share a slot. The content hash prevents
  wrong data and turns the collision into repeated re-chunking.
- **Required:** SHOULD key on library and item, SHOULD bound the map as the
  content cache does, and SHOULD clear it on reader close.

#### WS-8.6 The localization posture MUST be stated and made consistent (P2, CONFIRMED)

- **Where:** `addon/locale/` holds `en-US` only.
  `src/modules/readerPane.ts:244-320` and roughly 40 further sites,
  `ui/paneHeader.ts:114-185`, `ui/runProgressCard.ts:18-25`,
  `ui/criticalReadSection.ts:27-51`, `ui/discoveryRow.ts:15-35`,
  `researchWorkspace/projectWindowView.ts`, `view.ts`, `window.ts`,
  `menu.ts:12`
- **Now:** 17 `getString` or `l10nID` call sites exist in all of `src/`,
  against more than 120 hardcoded English strings. The Fluent plumbing is in
  place and `mainWindow.ftl` covers two section headers and one menu item.
  The Research Workspace menu uses Fluent for its managed entry and a
  hardcoded fallback label. `responseLanguage` changes model output only.
- **Impact:** the presence of locale files implies translatability that does not
  exist. The README ships in Korean and two Chinese variants while the UI is
  English only.
- **Required:** MUST choose one posture and record it. Either state
  "the interface is English only" in the README and stop shipping unused
  keys, or move the pane labels to Fluent and route status strings through
  `getString`.
- **Verify:** if Fluent stays, add a test that every `getString` key exists in
  the locale files.

#### WS-8.7 The Claim Ledger label language SHOULD follow the user, not the paper (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/artifactRenderer.ts:1856-1864`
- **Now:** the renderer selects the Korean label table when the sampled text
  contains Hangul.
- **Required:** SHOULD select on the user's locale or the response-language
  preference.

#### WS-8.8 The tokenizer alias table SHOULD NOT be domain-specific (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/core/context/hybrid/tokenizer.ts:2-13`
- **Now:** measured. `sd of the mean` expands to include
  `speculative-decoding` and `draft-verification`.
- **Impact:** Paper Pilot is a general Zotero tool. The table injects
  LLM-serving vocabulary into every user's queries and inflates document
  frequency for terms absent from the paper.
- **Required:** SHOULD make the expansion opt-in per project, or move the table
  to a preference with an empty default.

## 14. WS-9 — Type safety and verification gates

#### WS-9.1 `addonInstance` MUST NOT be the scaffold default (P0, CONFIRMED)

- **Where:** `package.json:9`, used at `src/index.ts:7,12` and
  `src/hooks.ts:148`
- **Now:** `"addonInstance": "AddonTemplate"`. `src/index.ts` installs the
  singleton at `Zotero.AddonTemplate` and skips bootstrap when that global
  already exists. `onShutdown` deletes it.
- **Impact:** any other plugin generated from the same template that kept the
  default collides. Whichever loads second never installs itself, and shutdown
  removes the other plugin's instance. The failure is silent and hard to
  diagnose from a user report.
- **Required:** MUST rename the value, for example to `PaperPilot`, and MUST
  check `addon/` for the same token.
- **Verify:** add an assertion to `test/addonManifest.test.ts`.

#### WS-9.2 CI MUST verify every push and pull request (P1, CONFIRMED)

- **Where:** `.github/workflows/release.yml` is the only workflow
- **Now:** it triggers on `v*` tags and manual dispatch. It runs the tests and
  the build. It never runs ESLint or Prettier.
- **Impact:** every quality rule in `AGENTS.md` is enforced by contributor
  discipline alone. `main` carries 6 ESLint errors and 5 Prettier-dirty files,
  which is what a missing gate looks like. A broken `main` is discovered at tag
  time.
- **Required:** MUST add a workflow that runs on push to `main` and on pull
  request, executing the typecheck, the read-only lint check, the test suite,
  and the build. MUST make it a required status check.

#### WS-9.3 The typecheck MUST cover `test/` (P1, CONFIRMED)

- **Where:** `tsconfig.json:9`, `package.json:38`
- **Now:** `tsc --noEmit --listFilesOnly` includes zero test files. Tests are
  type-checked only as a side effect of the ts-node compile at run time.
- **Impact:** the documented typecheck gives no signal about 28,400 lines of
  tests. A type error in a rarely executed test path surfaces only when that
  file runs.
- **Required:** MUST add a second project that includes `test/`, and MUST run
  both in the verification command and in CI.

#### WS-9.4 `scripts/doctor.sh` MUST match its documentation (P1, CONFIRMED)

- **Where:** `scripts/doctor.sh:80-104`, referenced by `AGENTS.md:33` and
  `CONTRIBUTING.md:19`
- **Now:** the script prints "oh-my-copilot doctor" and requires
  `.github/copilot-instructions.md`, `.github/prompts/*`, `.github/agents/*`,
  `.github/skills/*`, and two `.vscode/` files. `.gitignore:10` excludes
  `.github/*`, so a clean clone fails every check. Running it here reports two
  errors for the `.vscode/` files alone. The script never inspects Node, npm,
  Java, Zotero, or a CLI.
- **Impact:** a new contributor who follows `CONTRIBUTING.md` receives errors
  about files the repository deliberately does not ship, and learns nothing
  about the tools that actually break builds. The script also documents the
  private agent harness layout inside a tracked file.
- **Required:** MUST either delete the script and both references, or MUST
  replace its body with real checks: Node 20 or newer, npm, Java 11 or newer as
  a warning, the vendored extractor JAR, at least one engine CLI as a warning,
  and `git status --short` against the never-commit paths.

#### WS-9.5 The untyped Research Workspace island MUST shrink (P1, CONFIRMED)

- **Where:** 46 files and 6,167 lines carry `// @ts-nocheck`, all under
  `src/modules/researchWorkspace/`, including `service.ts` (944 lines) and 36
  of 40 `core/` files. The facade constructs the service through
  `as any` at `facade.ts:143` and calls it through `run<any>` at eight sites.
- **Now:** the files are compiled CommonJS emit pasted into `.ts`, with
  idioms such as `(0, json_1.readString)(...)`. The header comment states that
  strict runtime parsers guard the layer. For payload validation that holds
  for one artifact type (see WS-4.8). `docs/architecture.md:24` calls this the
  "typed core".
- **Impact:** the clean `tsc --noEmit` result says nothing about 6,167 lines
  that build every prompt, run every parser, and produce every persisted
  payload. WS-5.3 is exactly the class of drift a compiler would catch. A
  persisted `session` payload reaches the mastery controller with no
  validation.
- **Required:** MUST correct `docs/architecture.md` now. MUST add an exported
  environment interface and a typed constructor signature for
  `service.ts`, and MUST remove the `as any` at the construction site. SHOULD
  type `run<T>` per capability, which `outputSchemas.ts` already knows. SHOULD
  remove `@ts-nocheck` leaf first, starting with `core/context/hybrid/types.ts`,
  `core/evidence/types.ts`, `core/comprehensionCheck/v2/json.ts`, and
  `core/researchWorkspace/state.ts`.
- **Verify:** track the file count and the line count in this document as the
  work proceeds.

#### WS-9.6 The six ESLint errors and five Prettier files MUST be cleared (P1, CONFIRMED)

- **Where:** `src/modules/session/historyPrefs.ts:26,30,34,38`
  (`no-extra-boolean-cast`), `src/modules/session/sessionTitle.ts:7`
  (`no-useless-escape`), `test/researchWorkspaceProjectRepository.test.ts:1172`
  (`prefer-const`). Prettier flags
  `src/modules/researchWorkspace/zoteroSync.ts`,
  `test/autoHighlightPdfMatch.test.ts`,
  `test/researchWorkspaceZoteroSync.test.ts`,
  `test/silentTurnFilter.test.ts`, `scripts/check-release-tag-version.mjs`.
- **Required:** MUST fix all eleven, in one commit, before WS-9.2 lands.

#### WS-9.7 The machine-specific test path MUST go (P1, CONFIRMED)

- **Where:** `test/codexCliCompatibility.test.ts:6-9`
- **Now:** the candidate list contains an absolute path under a named user's
  home directory. The test skips when neither candidate exists, so the Codex
  flag-ordering contract is verified on one machine and silently skipped
  everywhere else.
- **Impact:** a personal path is committed to a public repository, and the
  suite reports coverage it does not have.
- **Required:** MUST resolve the binary from an environment variable or from
  `which`, and MUST document the variable in `AGENTS.md` as an opt-in
  integration test.

#### WS-9.8 A read-only lint command MUST exist (P2, CONFIRMED)

- **Where:** `package.json:30`, warnings at `AGENTS.md:56,113` and
  `CLAUDE.md:25-28`
- **Now:** `lint` runs `prettier --write .` and `eslint . --fix`. Two documents
  spend three paragraphs telling contributors not to run it.
- **Required:** MUST add `lint:check` that runs both tools in check mode. SHOULD
  rename the current script to `lint:fix` and point the documents at the check
  command.

#### WS-9.9 `scripts/` SHOULD be linted (P2, CONFIRMED)

- **Where:** `eslint.config.mjs:8`, workaround at `AGENTS.md:110`
- **Now:** the directory is ignored, and `AGENTS.md` compensates with a manual
  `node --check` instruction.
- **Required:** SHOULD add a config block for `scripts/**/*.mjs` with Node
  globals, and SHOULD delete the manual instruction.

#### WS-9.10 The build MUST typecheck before it packages (P2, CONFIRMED)

- **Where:** `package.json:29,31`
- **Now:** `build` runs the packaging step and then `tsc --noEmit`. `release`
  never type-checks. esbuild does not type-check, so a type error still
  produces a complete XPI.
- **Required:** MUST move the typecheck first in `build`, and MUST make
  `release` depend on it.

#### WS-9.11 The TypeScript configuration SHOULD leave the scaffold defaults (P2, CONFIRMED)

- **Where:** `tsconfig.json`
- **Now:** `target` is `ES2016` with no `lib`, while esbuild targets
  `firefox115` and ignores the setting. The program compiles only because
  `@types/node` pulls newer libraries in. `include` lists `node_modules/*`.
  Measured deltas: `noImplicitOverride`, `noFallthroughCasesInSwitch`, and
  `noImplicitReturns` each add zero errors. `noUncheckedIndexedAccess` adds 221. `exactOptionalPropertyTypes` adds 323.
- **Required:** SHOULD set an accurate `target` and explicit `lib`, SHOULD drop
  `node_modules/*` from `include`, and SHOULD enable the three zero-cost flags
  now. SHOULD treat `noUncheckedIndexedAccess` as a scoped follow-up for
  `researchWorkspace/persistence/` and `discovery/`, where index access on
  model output is riskiest. MAY skip the other flags.

#### WS-9.12 Two disabled ESLint rules SHOULD come back (P2, CONFIRMED)

- **Where:** `eslint.config.mjs:22-30`
- **Now:** three rules are off. Measured with them forced on:
  `no-unused-vars` 37, `no-non-null-assertion` 112, `no-explicit-any` 258. The
  configuration also passes options to a rule that is off, which is dead.
- **Required:** SHOULD enable `no-unused-vars` with an underscore escape after
  a one-time cleanup of 37 sites. SHOULD set `no-non-null-assertion` to warn
  and reduce the 63 source sites, where the three engine controllers share the
  same six. MAY leave `no-explicit-any` off. MUST delete the dead options
  object.

#### WS-9.13 `getPref` and `setPref` SHOULD be typed (P2, CONFIRMED)

- **Where:** `src/utils/prefs.ts:3,10,20`
- **Now:** both take `key: string` and return `any`, so
  `typings/prefs.d.ts` is decorative and every call site coerces the result.
- **Impact:** a typo compiles, and the two dead preferences in WS-2.1 and
  WS-2.5 were never flagged.
- **Required:** SHOULD key both functions on the generated preference map.

#### WS-9.14 Dependencies SHOULD be trimmed (P2, CONFIRMED)

- **Where:** `package.json:35`
- **Now:** `zotero-plugin@2.0.30` has no importer and no script that uses its
  binaries. The project builds through `zotero-plugin-scaffold`.
  `@opendataloader/pdf` is consumed only by the build-time copy step.
- **Required:** SHOULD remove the unused dependency and SHOULD move the
  extractor package to `devDependencies`.

#### WS-9.15 The vendored JAR SHOULD leave git history (P3, CONFIRMED)

- **Where:** `addon/chrome/content/vendor/opendataloader/`,
  `scripts/prepare-opendataloader.mjs:38-39`
- **Now:** a 22.9 MB binary is tracked, and the prepare step overwrites it on
  every `start`, `build`, and `release`. The dependency uses a caret range, so
  the next bump commits another copy permanently.
- **Required:** SHOULD ignore the vendor directory and remove the blob from the
  index, because the build recreates it. MAY pin the dependency exactly and
  print the copied JAR digest for release logs.

#### WS-9.16 The Node version SHOULD be declared (P3, CONFIRMED)

- **Where:** `package.json`, `scripts/zotero-plugin-cli.mjs:4-16`
- **Now:** there is no `engines` field and no version file, while the CLI shim
  patches a Node 20 gap. `update-deps` runs `npm update --save`, which would
  float two pinned beta dependencies.
- **Required:** SHOULD add `engines` and a version file. SHOULD remove
  `update-deps` or replace it with `npm outdated`.

#### WS-9.17 The never-commit list MUST match `.gitignore` (P3, CONFIRMED)

- **Where:** `.gitignore`, `AGENTS.md:36`, `CLAUDE.md:36-39`
- **Now:** both documents state that `reference/` and `.worktrees/` are
  untracked or ignored by design. Neither appears in `.gitignore`.
  `.worktrees/` is excluded only through a machine-local file. An untracked
  `2026-08-27/` directory sits at the repository root and Prettier flags its
  Markdown.
- **Required:** MUST add both paths to `.gitignore` so the documents hold on
  every clone. SHOULD move or delete the root directory.

## 15. WS-10 — Test architecture

#### WS-10.1 Untested pure logic MUST get focused tests (P1, CONFIRMED)

- **Where:** 83 of 236 source files have no test that imports them. 31 hold
  pure logic. The highest-value gaps are
  `session/sessionSnapshot.ts` (658 lines),
  `core/comprehensionCheck/v2/validation.ts` (368),
  `core/criticalRead/profiled/profiles.ts` (393) and its parser,
  `core/reproducibility/parser.ts`, `core/evidenceMatrix/parser.ts`,
  four exporters, the five `core/context/hybrid/` modules,
  `components/markdownRenderer.ts`, `tools/splitTextIntoChunks.ts`,
  `ai/retryEngineRequest.ts`, and `researchWorkspace/projectRunAdmission.ts`.
- **Impact:** `AGENTS.md` requires focused regression tests whenever prompt
  contracts, parsing, or structured rendering change. Four parsers and four
  exporters have no importing test, so a change there ships with a green
  suite. `sessionSnapshot.ts` is covered only by a regular expression over its
  own source text.
- **Required:** MUST add one focused test per untested parser, exporter, and
  prompt builder. These are pure functions today, so no refactoring is needed
  first. SHOULD add a CI guard that fails when a new
  `src/modules/**/{parser,prompt,export}*.ts` has no importer in `test/`.

#### WS-10.2 The Research Workspace UI SHOULD be behaviorally tested (P2, CONFIRMED)

- **Where:** `test/researchWorkspaceZoteroSyncIntegration.test.ts:10-37` is the
  only test that touches `projectWindowView.ts`, and it asserts source text.
  Nothing imports `view.ts`, `window.ts`, or `menu.ts`.
- **Impact:** roughly 4,000 lines of UI run only in real Zotero.
  `test/researchWorkspaceArtifactRenderer.test.ts` already proves the fake
  document approach works here. WS-7.5 and WS-7.6 are both reachable with a
  stubbed facade.
- **Required:** SHOULD make the facade injectable and SHOULD cover the sync
  panel gating, the screening log, and render re-entrancy.

#### WS-10.3 The Markdown renderer SHOULD be testable including math (P2, CONFIRMED)

- **Where:** `tsconfig.json` has no `esModuleInterop`, so under ts-node
  `import katex from "katex"` yields `undefined` and every `renderKatex` call
  falls back to escaped text.
- **Impact:** a test that asserts rendered math would fail while the bundle
  renders correctly. This is why WS-3.6 has no test today.
- **Required:** SHOULD switch to a named import or enable the interop flag, and
  then SHOULD add math cases to the new renderer test.

#### WS-10.4 Fixture builders SHOULD live in `test/helpers` (P2, CONFIRMED)

- **Where:** `source()` appears in 10 files with three incompatible
  signatures, `paper()` in 6, `setup()` in 6. `installGlobals`,
  `createService`, and `buildSnapshot` are duplicated between
  `sessionHistoryService` and `sessionLifecycle`. Each file defines its own
  in-memory file store. `test/helpers/` holds one 11-line file.
- **Impact:** a new required contract field needs the same edit in ten files.
  The three `source()` shapes also mean three different records are asserted
  as valid.
- **Required:** SHOULD add shared fixture and globals helpers, with per-file
  overrides passed as parameters.

#### WS-10.5 A preference-sync test MUST exist (P2, CONFIRMED)

- **Where:** no test compares `addon/prefs.js`, `typings/prefs.d.ts`,
  `preferences.xhtml`, and the `getPref` call sites.
- **Impact:** this test would have caught WS-2.1 and WS-2.5 on the commit that
  introduced them, and it enforces the three-way rule that `AGENTS.md`
  declares.
- **Required:** MUST add a test that parses all three declaration sites and
  greps `src/` for each key. MUST allow an explicit exemption list for
  internal preferences such as `paneSectionState`.

#### WS-10.6 Tests MUST restore the globals they replace (P2, CONFIRMED)

- **Where:** `test/relatedPaperRecommendations.test.ts:381,402,440,463,497`.
  The suite has zero `before`, `after`, `beforeEach`, or `afterEach` hooks.
- **Now:** two tests assign `globalThis.Zotero` and return without restoring
  it, so later tests in the same file run against whichever fake was installed
  last.
- **Impact:** intra-file order dependence. Reordering or filtering by name
  changes which fake a later test sees. Node runs each file in its own
  process, so the leak does not cross files.
- **Required:** MUST restore in a per-test hook, through a shared helper.

#### WS-10.7 Source-text assertions SHOULD be replaced by behavior (P2, CONFIRMED)

- **Where:** `test/readerPaneUxContract.test.ts` (88 lines of patterns over
  three source files), `test/canonicalMastery.test.ts:197-207`,
  `test/researchWorkspaceCapabilityRegistry.test.ts:151,167,195,221,250`
- **Now:** these read source files and match patterns such as
  `id="chat-messages" role="log" aria-live="polite"`.
- **Impact:** brittle in both directions. An attribute reorder breaks them with
  no behavior change, and a real regression that keeps the literal text passes.
  They exist because `readerPane.ts` and `sessionSnapshot.ts` have no pure
  seams, which WS-3.9 and WS-10.1 address.
- **Required:** SHOULD extract the attribute and snapshot builders as pure
  functions and test those. SHOULD keep at most one source-text tripwire per
  file, named as a tripwire. The "no CommonJS residue" assertion in
  `researchWorkspaceCore.test.ts:61` is a legitimate use and SHOULD stay.

#### WS-10.8 Manual QA MUST cover the paths only real Zotero can reach (P2, CONFIRMED)

- **Where:** `docs/manual-qa.md`
- **Now:** the checklist has no two-reader-tab scenario, no add-on-disable
  scenario, no double-submit scenario, and no oversize or compressed response
  case for the evidence fetch.
- **Required:** MUST add steps for WS-1.5, WS-3.3, WS-3.4, WS-3.5, WS-7.2,
  WS-7.5, WS-7.6, and WS-6.6.

#### WS-10.9 Oversized test files SHOULD be split (P3, CONFIRMED)

- **Where:** `test/discovery.test.ts` 3,675 lines and 87 tests,
  `sessionHistoryService.test.ts` 1,430,
  `researchWorkspaceProjectRepository.test.ts` 1,221,
  `paperCompare.test.ts` 1,038
- **Impact:** the Node runner parallelizes per file, so one very large file is
  a serial hotspot and a merge-conflict magnet.
- **Required:** SHOULD split by unit under test.

#### WS-10.10 The slow integration tests SHOULD be separable (P3, CONFIRMED)

- **Where:** `test/runCompletion.test.ts:132-190` takes 2,061 ms and spawns a
  real shell tree. `test/autoHighlightPdfMatch.test.ts:23` takes 560 ms and
  parses a real PDF.
- **Note:** both are correct as written. The kill test is platform guarded and
  cleans up.
- **Required:** SHOULD tag them so a unit-only run stays fast.

#### WS-10.11 The suite SHOULD run in transpile-only mode (P3, CONFIRMED)

- **Where:** `package.json:38`
- **Now:** the suite takes 14.7 s. With ts-node in transpile-only mode it takes
  5.15 s with the same 749 passes, because most of the time is spent
  type-checking.
- **Required:** SHOULD switch the test script to transpile-only once WS-9.3
  provides the type signal.

#### WS-10.12 The duplicated engine tests SHOULD be table driven (P3, CONFIRMED)

- **Where:** `test/claudeRunCancellation.test.ts` and
  `test/geminiRunCancellation.test.ts` differ only in identifiers, as do the
  two runner tests.
- **Note:** the production modules stay separate by design. This applies to the
  tests only.
- **Required:** SHOULD iterate one engine descriptor list.

## 16. WS-11 — Documentation truth

`AGENTS.md` is the declared source of truth, so a wrong sentence there
misdirects both contributors and agents.

#### WS-11.1 `AGENTS.md` MUST NOT call `CONTEXT_INDEX.md` Codex-only (P1, CONFIRMED)

- **Where:** `AGENTS.md:100`, against `codex/runner.ts:219`,
  `claude/runner.ts:279`, `gemini/runner.ts:253`
- **Now:** the sentence reads "note that `CONTEXT_INDEX.md` and `figures/` are
  Codex-only today". All three runners write the index. Only `figures/` is
  Codex-only. The artifact table in `docs/architecture.md` and all four READMEs
  are already correct.
- **Impact:** the sentence sits inside the rule "Update the runner and the
  prompt together", so an agent that follows it would edit the Codex runner
  alone.
- **Required:** MUST correct the sentence to name `figures/` only.

#### WS-11.2 Readiness claims MUST match the recorded QA (P1, CONFIRMED)

- **Where:** `README.md:21,379`, `docs/manual-qa.md:605-665`
- **Now:** section 12 holds a 59-item Research Workspace checklist with no item
  checked and no runtime record. The recorded Zotero 9 and Zotero 10 smokes
  cover the reader pane, discovery, and Critical Read, dated 2026-08-13 to
  2026-08-23, before the project window, templates, Living Review, Citation
  Health, and sync commits. The README says "focused Zotero 9 and 10 runtime
  smokes are recorded" with no scope.
- **Impact:** `AGENTS.md` requires conservative readiness claims and a clear
  line between automated verification and real runtime QA.
- **Required:** MUST either record a Research Workspace runtime session, or
  MUST scope the README sentence to the surfaces that were actually exercised.

#### WS-11.3 Spec status headers MUST state the real status (P2, CONFIRMED)

- **Where:** `docs/research-workspace-redesign-spec.md:3,50,54` against its own
  sections 25.1 to 25.5 and 27. `docs/architecture.md:10`.
  `docs/prompt-workflow-hardening-spec.md:3-7`.
  `docs/agent-led-research-discovery-and-critical-read-spec.md:1073-1074`.
- **Now:** the redesign spec header says "Status: Proposed ... must not be
  interpreted as shipped functionality" while six of its own sections begin
  "Implementation status: delivered". `architecture.md:10` still calls it a
  proposal. The hardening spec gives no verdict although `ai/runProfile.ts`
  implements its section 1. The discovery spec says Step 5 "does not yet
  perform the Step 6 author comparison" although
  `criticalRead/parser.ts:120-138` implements it.
- **Required:** MUST update the redesign header to name the delivered phases
  and the remaining proposals. MUST fix the `architecture.md` line. MUST add a
  status line to the hardening spec. MUST delete the stale sentence in the
  discovery spec.

#### WS-11.4 `docs/architecture.md` MUST match the modules it names (P2, CONFIRMED)

- **Now:** four corrections beyond the ones already required above.
  - `:59-62` names `projectWindow.ts` and `selectionCapture.ts`. The files are
    `projectWindowView.ts`, `window.ts`, and `selectionSnapshot.ts`.
  - `:56-63` describes `view.ts` as a compact launcher. It is the full
    single-paper operations surface, 1,043 lines, embedded by the project
    window. `menu.ts` and the window singleton state are not described.
  - `:43-45` says `collapsibleSection.ts` owns four surfaces including Critical
    Read. The code creates three sections and Critical Read sits inside
    Workbench.
  - `:242-245` omits `preferences-v1.json`, the migration marker,
    `sync-receipts/`, `cache/`, and `exports/`.
  - `:24` calls the ported layer the typed core (see WS-9.5).
  - the `metadata.json` row omits `extractionMethod` and `extractionNotes`.
  - the `thread_id` extraction is attributed to `outputParser.ts` but happens
    in `codex/controller.ts:429-444`.
  - the macOS-only runtime assumption is nowhere stated, although
    `runCompletion.ts` and `codex/environment.ts` hardcode `/bin/zsh`,
    `/usr/bin/pgrep`, `/bin/ps`, and a `/Library/` split.
- **Required:** MUST apply each correction. SHOULD move the `thread_id`
  extraction into the parser so the sentence becomes true.

#### WS-11.5 The repository maps MUST cover the largest half of `src/` (P2, CONFIRMED)

- **Where:** `AGENTS.md:14-34`, `CONTRIBUTING.md:35-53`
- **Now:** neither map mentions `researchWorkspace/`, which is 32,957 of
  62,802 lines, nor `discovery/`, `criticalRead/`, `ui/`, `note/`,
  `message/`, `tools/`, `translation/`, or `components/`. `CONTRIBUTING.md`
  lists `autoHighlight/` and `AGENTS.md` does not. `AGENTS.md` advertises
  "redaction" under `modules/workspace/`, which WS-2.1 shows is unused.
- **Required:** MUST add one line per missing directory and MUST resolve the
  redaction entry with WS-2.1.

#### WS-11.6 `CONTRIBUTING.md` MUST state the supported Zotero range (P2, CONFIRMED)

- **Where:** `CONTRIBUTING.md:7,13` say Zotero 7 to 9.
  `docs/manual-qa.md:308` says a 7 to 9 matrix. The manifest allows up to
  `10.0.*` and every other document says 7 to 10.
- **Required:** MUST update both files.

#### WS-11.7 The translated READMEs SHOULD stay in step (P2, PLAUSIBLE for the Chinese files)

- **Where:** `README.md:16` against `README.ko.md:12-19`,
  `README.zh-CN.md:12-19`, `README.zh-TW.md:18-25`
- **Now:** the English "At a glance" list has nine bullets and all three
  translations have eight. In the Korean file the missing bullet is the
  OpenDataLoader extraction line. `README.zh-TW.md:11-15` carries an extra
  engine-mode paragraph that the other three lack.
- **Note:** requirements, known limitations, artifact lists, Codex model names,
  and the Research Workspace paragraph are in step across all four.
- **Required:** SHOULD add the missing bullet, SHOULD resolve the extra
  paragraph, and SHOULD record in `CONTRIBUTING.md` that the list must have the
  same length in all four files.

#### WS-11.8 Remaining smaller corrections (P3, CONFIRMED)

| Document                   | Line          | Claim                                                        | Actual                                                                                      |
| -------------------------- | ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                | 20            | "280 Node tests"                                             | 749                                                                                         |
| `README.md`                | 335           | `scripts/` is the scaffold CLI entrypoint                    | also the extractor prep, the release-tag guard, and `doctor.sh`                             |
| `README.md`                | 356-365       | verification list of eight legacy areas                      | omits discovery, Critical Read, session history, and about 40 Research Workspace test files |
| `docs/architecture.md`     | 444-446       | parsers are "string/escape-aware"                            | two parsers use a naive first-brace scan (WS-13.1)                                          |
| `docs/prompt-contracts.md` | 189           | invalid fields are rejected                                  | 19 sites default silently (WS-5.2)                                                          |
| `docs/prompt-contracts.md` | 193           | missing classification degrades to `unclear`                 | the parser emits `uncertain`                                                                |
| `docs/prompt-contracts.md` | Mastery shape | omits `criterionScores`                                      | the shipped schema requires four entries                                                    |
| `docs/architecture.md`     | 176-177       | notifier data included "where the Zotero API accepts it"     | the runtime records that it passed the option, not that Zotero accepted it                  |
| `docs/prompt-contracts.md` | Critical Read | revising a step invalidates all dependent downstream outputs | the encoded map is narrower than the real prompt dependency graph                           |

## 17. WS-12 — Performance at realistic scale

#### WS-12.1 The extractor subprocess MUST have a timeout and a pid (P1, CONFIRMED)

- **Where:** `src/modules/tools/paperWorkspaceContent.ts:401-424`, cancel path
  at `src/modules/ai/workspaceRun.ts:205-236`
- **Now:** the Java invocation runs through `exec` with no timeout, no pid
  file, and no wrapper. The interrupted-preparation path awaits the runner
  before it cleans up, so cleanup and the per-item barrier wait for Java.
- **Impact:** a large or malformed PDF can hold the run for many minutes. The
  30-minute watchdog can only fire a callback, because it has no pid to kill.
  During that window Cancel appears to succeed while the item stays locked and
  the runner keeps writing workspace files.
- **Required:** MUST bound the extraction, either through the same detached
  script pattern with a pid file, or with a timeout wrapper and a race. MUST
  record a failed extraction in `extractionNotes` so `extractionMethod` falls
  back honestly.

#### WS-12.2 Citation Health SHOULD NOT normalize inside inner loops (P2, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/citationHealth.ts:598-637,704-720`,
  called per context at `1002-1009`. Same shape at
  `contradictionGap.ts:741-764`.
- **Now:** the library match normalizes every item title per context, and the
  support check tokenizes every corpus string per draft statement. The stated
  bounds are 20,000 items, 2,000 contexts, and 200 statements.
- **Impact:** on the order of tens of millions of Unicode normalizations on the
  Zotero main thread for a large project.
- **Required:** SHOULD precompute maps by DOI, normalized title, and library
  identity. SHOULD memoize token sets. SHOULD group observations by source and
  dimension.

#### WS-12.3 Artifact mutation SHOULD NOT re-read the whole set (P2, CONFIRMED)

- **Where:** `projectRepository.ts:373-388,1065-1076,1150-1251`,
  `operationCoordinator.ts:743-798`, `projectController.ts:120-143`
- **Now:** measured with a fake store and 40 artifacts. One identity
  `updateArtifact` costs 171 reads and 2 writes. One `createArtifact` that
  supersedes costs 219 reads and 4 writes. The staleness propagation calls the
  artifact list twice per round, and the catalog sync calls it again. The home
  screen reads every artifact of every project only to count due mastery
  reviews.
- **Impact:** `runIncremental` updates after every unit, so a 12-paper matrix
  in a project with 100 artifacts issues thousands of reads and full JSON
  parses. Artifact count is unbounded until WS-4.4 lands.
- **Required:** SHOULD skip the catalog sync for checkpoint updates and sync
  once at the end. SHOULD read each artifact once per propagation round.
  SHOULD store the due-review count in the catalog entry, as the stale count
  already is.

#### WS-12.4 Session persistence SHOULD NOT re-read every snapshot per turn (P2, CONFIRMED)

- **Where:** `src/modules/session/sessionHistoryRepository.ts:281-323,355-379,407-435`
- **Now:** reading the paper index recovers sessions from disk and then loads
  every indexed snapshot again. Saving a snapshot reads the index first, and
  the service saves after every user message and every assistant turn.
- **Impact:** a paper with 40 sessions costs about 80 full file reads and JSON
  parses per chat turn, on the main thread. Session count per paper is
  unbounded.
- **Required:** SHOULD read each snapshot once per index build. SHOULD cache
  the index per item and invalidate on write. MAY store the summary fields the
  index needs in a sidecar.

#### WS-12.5 The hybrid index cache SHOULD be bounded (P2, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/facade.ts:96`,
  `service.ts:172-191`, `core/context/hybrid/index.ts:18-35`,
  `search.ts:62-69`
- **Now:** the module-level cache never evicts. Each indexed chunk retains its
  token array, which is only needed to build the document frequencies. The
  search recomputes the title tokens and lowercases the chunk text for every
  chunk on every query.
- **Impact:** twelve papers of 1.5 million characters hold tens of megabytes
  for the process lifetime. A removed paper is never evicted.
- **Required:** SHOULD drop the token array after building the frequencies.
  SHOULD precompute the title tokens and the lowercased text. SHOULD bound the
  cache and clear it at shutdown.

#### WS-12.6 The fallback text read SHOULD be lazy (P3, CONFIRMED)

- **Where:** `src/modules/tools/paperWorkspaceContent.ts:107`
- **Now:** `attachmentText` is read before the structured extraction, and its
  value is used only when that extraction fails.
- **Impact:** the read can trigger Zotero's own full-text indexing, which
  doubles first-open time for no benefit on the common path.
- **Required:** SHOULD move the read into the failure branch.

#### WS-12.7 Living Review SHOULD invalidate only on a change (P3, CONFIRMED)

- **Where:** `src/modules/researchWorkspace/livingReviewService.ts:148-167,202-204`
- **Now:** each scan runs the invalidation for every ready source, even when
  the refresh reported no change.
- **Impact:** each notifier burst costs work proportional to projects times
  sources times artifacts. Correctness is preserved by the direct match.
- **Required:** SHOULD gate the call on a content or availability change.

#### WS-12.8 A negative Java probe SHOULD be cached (P3, PLAUSIBLE)

- **Where:** `src/modules/tools/paperWorkspaceContent.ts:349-380,411`
- **Now:** nothing caches "Java unavailable", so every run and every project
  paper load spawns a login shell and the platform `java` stub again.
- **Impact:** on macOS without a JDK the stub can raise the system install
  prompt. `extractionMethod` still reports the fallback correctly.
- **Required:** SHOULD probe once per session and cache the result. SHOULD
  surface a single notice.

## 18. WS-13 — Structural debt

#### WS-13.1 JSON extraction MUST have one implementation (P1, CONFIRMED)

- **Where:** six copies of the balanced-brace extractor in
  `researchBrief.ts:75-149`, `paperTools.ts:64-138`,
  `paperCompare.ts:160-234`, `autoHighlight/prompt.ts:26-100`,
  `comprehensionCheck/prompt.ts:271-356`, and inline in
  `discovery/parser.ts:190-223`. Two naive extractors at
  `criticalRead/parser.ts:232-240` and `relatedRecommendations.ts:291-309`.
  Five copies of the fence stripper, four of the optional-string helper, nine
  of the whitespace normalizer.
- **Now:** `docs/architecture.md:444-446` says parsers are escape-aware so a
  closing brace inside a quoted value cannot truncate the payload. The Critical
  Read extractor takes the first brace and the last brace, so trailing prose
  containing a brace breaks it. `parseRelatedPaperResponse` gates the tolerant
  discovery parser behind its own stricter naive parse, so output the discovery
  parser would accept is rejected first.
- **Impact:** roughly 375 duplicated lines that have already drifted, and a
  documented guarantee that two paths do not provide.
- **Required:** MUST extract one shared module, for example
  `modules/ai/jsonCandidates.ts`, with the fence stripper, the escape-aware
  extractor, and the first-object parse. MUST use it in all eight places,
  including Critical Read and the related-paper gate.
- **Verify:** add a case with trailing prose containing a closing brace.

#### WS-13.2 Identity and hashing helpers SHOULD have one home (P2, CONFIRMED)

- **Where:** eleven FNV-1a copies inside `researchWorkspace/`, three
  `normalizeDOI` and three `normalizeTitle` copies with divergent behavior
  (`screeningLog.ts:81-95`, `citationHealth.ts:284-301`,
  `citationContextExtraction.ts:119-136`), plus `text`, `strings`, and `clamp`
  copies across `core/`. `relatedRecommendations.ts` has its own
  `normalizeTitle` without the decomposition that `normalizeDiscoveryTitle`
  applies, and its own `normalizeDOI` without format validation.
- **Impact:** the citation extractor omits the NFKC step that the other two
  apply, so duplicate detection and identity resolution can disagree on the
  same title. The recommendation library match and the same-paper check can
  disagree on diacritics.
- **Required:** SHOULD add one identity module with the hash and the
  normalizers, and one shared `core/` JSON helper module including the strict
  `enumValue` from WS-5.2.

#### WS-13.3 The two largest renderers SHOULD be split (P2, CONFIRMED)

- **Where:** `researchWorkspace/artifactRenderer.ts` 3,692 lines,
  `projectWindowView.ts` 2,469 lines
- **Now:** the renderer mixes view-model types, tolerant coercion of untrusted
  payloads, a 167-line label table with Markdown export, and the DOM renderers.
  Thirteen render functions exceed 90 lines. One section-and-card block repeats
  about 18 times. The project view repeats one status-await-render-catch block
  18 times and passes the same five-tuple to every panel.
- **Impact:** every new capability edits the same two files. The pure view-model
  builders, which are directly unit-testable, are interleaved with DOM code.
  WS-7.5 and WS-7.6 exist because the action pattern is copied rather than
  centralized.
- **Required:** SHOULD extract per-capability view builders and renderers, one
  shared card-section helper, one evidence renderer, and the label table.
  SHOULD extract one panel context type with a single action helper, then one
  module per panel, starting with the three sync panels.

#### WS-13.4 `facade.ts` and `service.ts` SHOULD be split by capability family (P2, CONFIRMED)

- **Where:** `researchWorkspace/facade.ts` 1,471 lines with 42 exports,
  `service.ts` 944 lines with 27 methods
- **Now:** the facade holds repository construction, project preparation,
  single-paper operations, mastery, multi-paper operations, synthesis, citation
  work, export rendering, derived dashboards, and 20 thin delegations. The
  service holds the retry loop, evidence verification, hybrid indexing, eight
  per-capability methods, the cross-paper mastery state machine, and a legacy
  export with no caller.
- **Required:** SHOULD split the facade into per-family modules with the
  current file as a re-export index. SHOULD extract the structured-run helper
  and the mastery state machine from the service.

#### WS-13.5 The three import cycles SHOULD be broken (P2, CONFIRMED)

- **Where:** measured over 236 files and 711 edges.
  - `ai/runLifecycle.ts` to `session/sessionHistoryService.ts` to
    `session/sessionSnapshot.ts` to `criticalRead/workflow.ts` to
    `relatedRecommendations.ts` to `ai/workspaceRun.ts` to `ai/runLifecycle.ts`
  - `persistence/projectRepository.ts` to `persistence/validation.ts` to
    `citationHealth.ts` to `projectController.ts` to
    `persistence/projectRepository.ts`
  - `view.ts` to `window.ts` to `projectWindowView.ts` to `view.ts`, closed by
    a dynamic import at `view.ts:347`
- **Impact:** the second cycle is the layering inversion in WS-13.7. The first
  couples the engine lifecycle to two feature workflows through the snapshot
  type. The third is already softened by the dynamic import.
- **Required:** SHOULD move the shared types into type-only modules so the
  runtime edges disappear.

#### WS-13.6 The discovery orchestrators SHOULD be split (P2, CONFIRMED)

- **Where:** `discovery/workflow.ts` 1,342 lines,
  `relatedRecommendations.ts` 1,257 lines
- **Now:** the workflow holds page heuristics, venue-agreement algebra,
  OpenReview derivation, registrar identity matching, generic-source authority,
  and the live verification driver. The recommendations module holds the legacy
  view projection, the pane reducers, library matching, Zotero mutation, and
  two full run orchestrators. Lane computation is not duplicated, because the
  parser owns it. The eighty-line start-poll-stop-cleanup loop appears three
  times, counting `autoHighlight/workflow.ts:62-134`.
- **Required:** SHOULD split each along the responsibilities above, and SHOULD
  hoist the direct-run poll loop into `ai/workspaceRun.ts`, which already owns
  the deadline and the signal.

#### WS-13.7 Persistence SHOULD NOT import feature modules (P2, CONFIRMED)

- **Where:** `persistence/validation.ts:24-26` imports `citationHealth.ts` and
  `projectTemplates.ts`. `persistence/projectRepository.ts:47-52` imports
  `zoteroSync.ts`.
- **Impact:** the lowest layer imports two feature modules and the sync module.
  The graph is acyclic at runtime only because one import is type-only. Deep
  payload validation exists for exactly one artifact type, which is
  asymmetric and surprising.
- **Required:** SHOULD invert the dependency with a payload-validator registry
  that feature modules register into, and SHOULD move receipt parsing behind a
  repository that composes the project repository.
- **Note:** `core/` is clean in the other direction. Only two edges leave it,
  one type-only and one runtime import of `comprehensionCheck/analytics.ts`.

#### WS-13.8 The duplicated DOM helpers SHOULD be shared (P3, CONFIRMED)

- **Where:** `element()` in `artifactRenderer.ts:1543`,
  `projectWindowView.ts:72`, `view.ts:68`, `window.ts:36`, plus three copies of
  `button()` and two of `metric()`
- **Required:** SHOULD add one shared DOM module for the Research Workspace
  surfaces.

#### WS-13.9 Dead code SHOULD be deleted (P3, CONFIRMED)

- **Where:** `src/modules/tools/pdfTextCache.ts` (whole file, no importer),
  `src/modules/workspace/redaction.ts` (see WS-2.1),
  `src/modules/codex/controller.ts:552-596` (`retryLastCodexQuestion`,
  `cancelCodexRun`), `src/modules/codex/shell.ts:17-29`
  (`buildCodexShellScript`), the unreferenced `declare const Zotero` in three
  `stopRun.ts` files, `typings/zotero-subprocess.d.ts` (never used, the code
  casts instead), `src/modules/readerPane.ts:4088-4127` (a warning gated on
  `&& false`, two no-op card renderers), `ui/paneHeader.ts:174-203` (two
  buttons never appended, three hidden cards), `src/hooks.ts:151-158`
  (`onNotify`, not wired), `src/utils/wait.ts`, `src/utils/window.ts`,
  `src/utils/ztoolkit.ts:36-47`, `src/addon.ts:51-55`,
  `addon/locale/en-US/addon.ftl:6-7`,
  `researchWorkspace/core/researchWorkspace/repository.ts` (only a test
  imports it), `service.ts` `configure`, `runCriticalRead`,
  `createEvidenceMatrix`, `exportWorkspace`, `facade.ts:221-226` and
  `1462-1471`, `message/messageStore.ts:37-39`,
  `context/indexStore.ts:32-34`
- **Impact:** `retryLastCodexQuestion` bypasses the retry claim that
  `ai/retryEngineRequest.ts` enforces, so wiring it later would reopen a
  closed admission race. The legacy repository still knows the v3 file name.
  `AGENTS.md` advertises redaction as a live capability.
- **Required:** SHOULD delete each item, or MUST wire it where a requirement
  above depends on it.

#### WS-13.10 The fabricated relevance score SHOULD go (P3, CONFIRMED)

- **Where:** `src/modules/relatedRecommendations.ts:227-232,362-364`
- **Now:** the score is derived from the ordinal relationship and then used to
  sort. No UI consumer reads it, and the sort is stable, so the current effect
  is nil. The field survives in persisted state.
- **Impact:** `docs/prompt-contracts.md` states that no fabricated relevance
  percentage is shown.
- **Required:** SHOULD sort by the relationship rank directly and remove the
  field.

## 19. Accepted design, not defects

These were examined and are correct as they stand. Do not "fix" them.

- **The three engine modules are near-duplicates by design.** `AGENTS.md`
  states isolation over reuse. Measured overlap after normalizing engine names
  is 73 percent between the Codex and Claude controllers and 100 percent
  between the Claude and Gemini controllers. Only WS-1.3 and WS-13.1 move code
  out, because that code is already shared behavior.
- **Shell quoting is correct.** Every interpolated value that reaches
  `zsh -lc` passes through `shellEscape`, including the executable path, the
  workspace path, the model, the resume id, the permission mode, the inline
  schema, and every environment value. The workspace slug is reduced to
  `[a-z0-9-]` before it becomes a path, and cleanup refuses any last segment
  that does not match `^\d+-[a-z0-9][a-z0-9-]*$`.
- **The pid is validated before it reaches the shell.** The runner requires
  `^[1-9]\d*$` and a value above 1, so pid-file garbage cannot be interpolated.
- **The kill escalation is thorough.** It walks children, signals children
  first, retries the terminate signal, freezes survivors before the kill, and
  verifies termination. A real terminate-ignoring process tree is tested.
- **The IPv6 address rule is stricter than documented.** Only the global
  unicast range may pass, and Teredo is rejected as a whole prefix rather than
  decoded. No bypass was found in the address sets.
- **Secret-bearing URL parameters are rejected** before any URL is stored or
  fetched, which the documentation does not even claim.
- **The two `new Function` calls** in `autoHighlight/pdfMatch.ts` are dynamic
  import shims for an ES module under a CommonJS target, not evaluated user
  input.
- **The approval token is a deterministic non-cryptographic fingerprint.** It
  detects drift, which is its job. Any in-process caller can compute it, so the
  retype field is a review ritual and the checkbox carries the consent. Nothing
  in the documentation overclaims this.
- **`direct-contradiction` is hard to reach with the shipped presets**, because
  comparability requires two exact matches on free-text design cells. That
  matches the documented rule. Treat it as a preset design question, not a bug.
- **Node runs each test file in its own process**, so the global leak in
  WS-10.6 cannot cross files.
- **Zotero notes escape model text.** Every note builder escapes the three
  markup characters and wraps the content in a preformatted block.

## 20. Remediation sequence

Each stage ends with a green verification run. Do not begin a stage before the
previous one is green.

| Stage | Contents                                                                                 | Rationale                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0     | WS-9.6, WS-9.7, WS-9.2, WS-9.3, WS-9.8, WS-9.10                                          | Establish the gate before changing behavior. Clearing the eleven existing violations first keeps the first CI run meaningful. |
| 1     | Every P0: WS-1.1, WS-2.1, WS-2.2, WS-2.3, WS-3.1, WS-3.2, WS-4.1, WS-7.1, WS-7.2, WS-9.1 | Execution safety, privacy controls, data corruption, library writes. Each is small and independently shippable.               |
| 2     | WS-1.2 to WS-1.8, WS-3.3 to WS-3.7, WS-12.1                                              | Correctness at the engine and pane edges, and the unbounded extractor.                                                        |
| 3     | WS-4.2 to WS-4.7, WS-5.1 to WS-5.5, WS-6.1 to WS-6.3, WS-7.3 to WS-7.6, WS-8.1 to WS-8.3 | Contract fidelity and persistence integrity. WS-5.1 and WS-6.1 each need a decision recorded before the code changes.         |
| 4     | WS-9.5, WS-10.1, WS-10.5, WS-11.1 to WS-11.6, WS-13.1                                    | Type coverage, the missing tests, and the documents that misdirect contributors.                                              |
| 5     | remaining P2                                                                             | Performance, structure, and test architecture.                                                                                |
| 6     | remaining P3                                                                             | Hygiene and dead code.                                                                                                        |

Two requirements are decisions, not code, and block their stage: WS-5.1
(is a structured-element match verification?) and WS-6.1 (is a venue-named
domain ownership proof?). Record the answer in `docs/` first.

## 21. Verification

Use the commands `AGENTS.md` prescribes. Do not run `npm run lint`, because it
rewrites files that the change did not touch.

```bash
npm ci                                    # when dependencies are missing
npx tsc --noEmit                          # plus the test project after WS-9.3
npm test
npx eslint <changed paths>
npx prettier --check <changed paths>
npm run build                             # packaging or manifest changes
```

Per-stage expectations:

- **Stage 0** ends with zero ESLint errors, zero Prettier-dirty files, and a
  green CI run on a pull request.
- **Stage 1** adds at least one regression test per requirement. WS-1.1,
  WS-7.1, and WS-7.2 also need a real-Zotero pass from
  `docs/manual-qa.md`.
- **Stage 3** requires an updated `docs/prompt-contracts.md` in the same pull
  request as any contract change, per `AGENTS.md`.
- **Stage 4** should reduce the `@ts-nocheck` count. Record the new count here.

Anything that cannot be verified without a real reader pane, a real
subprocess, or a real Zotero item belongs in `docs/manual-qa.md`, not in a
mocked test that implies coverage.

## 22. Appendix — requirement index

| Workstream                             | Requirements | P0     | P1     | P2     | P3     |
| -------------------------------------- | ------------ | ------ | ------ | ------ | ------ |
| WS-1 Engine execution and lifecycle    | 16           | 1      | 7      | 4      | 4      |
| WS-2 Privacy and data at rest          | 9            | 3      | 3      | 3      | 0      |
| WS-3 Reader pane                       | 15           | 2      | 5      | 4      | 4      |
| WS-4 Persistence integrity             | 13           | 1      | 6      | 2      | 4      |
| WS-5 Evidence and contracts            | 11           | 0      | 5      | 2      | 4      |
| WS-6 Discovery boundary                | 10           | 0      | 3      | 4      | 3      |
| WS-7 Zotero write paths                | 10           | 2      | 4      | 1      | 3      |
| WS-8 Retrieval, session data, language | 8            | 0      | 3      | 3      | 2      |
| WS-9 Type safety and gates             | 17           | 1      | 6      | 7      | 3      |
| WS-10 Test architecture                | 12           | 0      | 1      | 7      | 4      |
| WS-11 Documentation truth              | 8            | 0      | 2      | 5      | 1      |
| WS-12 Performance                      | 8            | 0      | 1      | 4      | 3      |
| WS-13 Structural debt                  | 10           | 0      | 1      | 6      | 3      |
| **Total**                              | **147**      | **10** | **47** | **52** | **38** |
