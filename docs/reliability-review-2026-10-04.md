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

Workspace collisions require an existing file at a newly claimed path. Most
ordinary chat inputs are already owned from the first turn, and analysis runs
use new directories; this is a bounded preservation fix, not a claim of a common
failure on every run. Preflight checks do not make multiple file operations
atomic against external writers.

## Verification boundary

- The baseline passed 973 Node tests. Twelve added regression cases failed
  against the prior implementation and pass after the fixes.
- The updated suite passes 985 tests with no failures or skips. Source/test
  TypeScript checks and the production XPI build pass.
- The baseline repository lint gate has zero errors and 122 existing warnings.
- Production dependency audit reports zero known vulnerabilities.
- Tests exercise the real repository and workspace helpers with controlled file
  operations. They do not establish native Zotero UI or real-provider behavior.
  The disposable-profile/workspace checks are listed in
  [manual-qa.md](manual-qa.md).

Codex implements and integrates the change; Claude independently reviews the
code and the reachable failure conditions. PR review and hosted CI results are
recorded with the pull request.
