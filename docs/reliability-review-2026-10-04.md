# Reliability review — 2026-10-04

This review revisits the delivered code-review remediation, chat improvement
specification and September reader review against `main` at `8fb3bd5`. Their
previous findings are historical evidence, not a list of current defects.
The recorded structural-refactor exceptions remain separate from this focused
data-preservation change.

## Confirmed findings

| Area                 | Failure                                                                                                                                               | Correction                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Session history      | A future-version index is rejected for reading but can still be overwritten or removed by save/delete operations, including after an index cache hit. | Check the actual index version before each mutation and reject before changing snapshots or the index.                                   |
| Workspace ownership  | New inputs can overwrite existing unowned files; initial runtime-file registration can adopt existing files and later delete them during cleanup.     | Check all planned input/runtime paths before replacing any owned input. Existing unowned files block preparation and remain untouched.   |
| Ownership manifest   | A supplemental input can replace the manifest itself, breaking later ownership validation and cleanup.                                                | Reserve the manifest path before any writes.                                                                                             |
| Recovery diagnostics | An externally edited input blocks later turns without identifying the file that requires attention.                                                   | Identify the file and workspace in diagnostic details and explain that a new conversation can continue without removing the edited data. |

Two further findings from Claude's independent provider review are included:

- Malformed chat envelopes containing invalid LaTeX backslashes could decode to
  an empty answer while controllers recorded a successful turn. Recovery now
  preserves invalid literal backslashes in complete answer strings, without
  promoting malformed citations. Both controllers use a shared readable
  answer check and fail empty responses with Retry guidance.
- Claude could read partial stdout, then observe an exit marker created after
  that read and incorrectly complete with the old output. It now reads the
  completion marker first, matching Codex. Deterministic interleaving tests
  cover this boundary without relying on timing sleeps.

Workspace collisions require an existing file at a newly claimed path. Most
ordinary chat inputs are already owned from the first turn, and analysis runs
use new directories; this is a bounded preservation fix, not a claim of a common
failure on every run. Preflight checks do not make multiple file operations
atomic against external writers.

## Verification boundary

- The baseline passed 973 Node tests. File-preservation and invalid-LaTeX
  regressions were reproduced before their fixes; added outcome tests cover
  empty answers, provider/process failures and unchanged non-chat contracts.
- The updated suite passes 996 tests with no failures or skips. Source/test
  TypeScript checks and the production XPI build pass.
- The repository lint gate has zero errors and 122 existing warnings.
- Production dependency audit reports zero known vulnerabilities.
- Tests exercise the real repository and workspace helpers with controlled file
  operations. They do not establish native Zotero UI or real-provider behavior.
  The disposable-profile/workspace checks are listed in
  [manual-qa.md](manual-qa.md).

Codex implements the preservation and chat fixes and integrates the change;
Claude independently reviews those changes, implements the progress-reader fix,
and receives an independent Codex review. PR review and hosted CI results are
recorded with the pull request.

## Deferred observations

The review also noted candidate-to-PDF rebinding, legacy preference migration
on recovery, and retained quarantine copies after history deletion. These need
separate reproduction and explicit recovery/deletion contracts before changing
behavior. Quarantine copies are deliberately not deleted by this patch. Proposed
search-focus and dynamic-pane-resize refinements need native Zotero observation.
None is represented as fixed here.
