# Full feature audit — 2026-10-24

## Scope and evidence

Baseline: `f7863280a9be53adacf2a11ceb4de0ca36541391` (`origin/main` at the
start of this audit), package version 0.2.4. The audit covers the documented
reader, Research Workspace and Research Studio feature inventory, the complete
Node regression suite, package construction, dependency advisories, selected
real provider workloads, and UI checks on macOS. It is not a claim that every
feature/provider/OS/Zotero-version combination has been exercised end to end.

The baseline suite passed 1,383 tests. That result did not detect the additional
failure cases below. New regression cases reproduce lost data and unconfirmed
process ownership rather than only checking successful requests.

## Findings corrected

| Finding                                             | Trigger and previous result                                                                          | Correction and evidence                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty CSV/TSV row lost                              | Save a one-column table ending in an empty cell; reopening treats the last row as a trailing newline | Quote empty fields; round-trip tests cover no final newline, LF and CRLF. Browser save/reopen retains the empty row.                                                                                          |
| Empty grid accepts invisible rows                   | Add a row before a CSV has columns; the grid reports a row but renders no editable cell              | Require the first column, explain the next action and disable Add row until ready. JSONL empty objects remain valid and visible.                                                                              |
| Last-column removal discards row identity           | Remove the only CSV column while rows exist                                                          | Require rows to be removed first, without mutating data on rejection.                                                                                                                                         |
| Concurrent kernel restarts lose ownership           | Two Restart requests terminate the same session independently                                        | Coalesce termination and prevent execution while restart is pending. A regression verifies one kill and retention of the replacement session.                                                                 |
| Failed kernel launch forgets a possibly live worker | Launch acknowledgement and cleanup both fail                                                         | Retain the failed session and block another worker until restart confirms termination.                                                                                                                        |
| Compiler retry can overlap an unconfirmed process   | Build cancellation cleanup fails, then Build is pressed again                                        | Retain the job and retry its cleanup before a new build is prepared.                                                                                                                                          |
| AI retry can overlap an unconfirmed process         | CLI launch/Stop fails and a new request uses replacement ports                                       | Retain the owned job by project runtime path; retry cleanup before new CLI preparation or local inference.                                                                                                    |
| DOCX link button loses its accessible name          | Editor selection updates replace the link button attributes                                          | A guarded patch for the pinned SuperDoc build retains the label in both selection-update paths. Actual browser accessibility changes from `undefined unset` to `Link dropdown`.                               |
| Local model returns malformed review JSON           | A real Ollama `qwen3:8b` request produces an unparsable response                                     | Send the existing review schema through `response_format` as well as the prompt. Unsupported endpoints fail explicitly; no unconstrained retry. Local validation and manual proposal review remain mandatory. |
| Dependency advisories                               | `npm audit` reports three affected dependency packages                                               | Update KaTeX to 0.18.2, adm-zip to 0.6.1, and brace-expansion to 1.1.21/2.1.7. Audit reports zero advisories. A math regression rejects inherited trusted-link settings.                                      |

KaTeX's [upstream security release](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.2)
and [Ollama's structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs)
support the dependency and local-provider changes. Dependency advisory presence
alone does not establish exploitability in Paper Pilot.

## Feature coverage

The following rows identify automated coverage and the remaining runtime boundary.
A passing injected-port test is not evidence of a successful native subprocess,
PDF annotation, Zotero transaction, or scholarly judgment.

| Feature family                                                                                               | Automated coverage exercised                                                                                          | Runtime boundary in this audit                                                             |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Reader chat, per-paper engine/model, retry, branch, pins, summaries                                          | Chat contracts, context admission, source fingerprints, run states, continuity and privacy tests                      | Final installed Zotero reader smoke; not every model/effort combination                    |
| Session history, reopen, rename, clear, migration                                                            | Session repositories, mutation queues, snapshot/silent-turn filtering                                                 | Existing sessions retained; broad historical migration UI matrix not repeated              |
| Selection Ask/Explain/Summarize/Translate                                                                    | Reader actions, selection binding, language and prompt contracts                                                      | Selection gestures and each generated answer remain separate native checks                 |
| Dictionary                                                                                                   | Naver lookup parsing, normalization, failures, bounded selection                                                      | Live third-party dictionary response not comprehensively revalidated                       |
| Figure/table explanation                                                                                     | Caption matching, request scope, response provenance, cancel and image fallback                                       | Area-annotation capture and both engine image paths not fully repeated                     |
| Research brief, Contributions, Limitations, Follow-ups, Compare                                              | Prompt/schema/parser, exact requested peer set, artifact state                                                        | Generated research quality is not established by parser tests                              |
| Notes, collection artifacts, clear cards                                                                     | Note/export sanitization, artifact reuse and scope                                                                    | Real note/collection writes not exhaustively exercised                                     |
| Verified prior work and public-review insights                                                               | Provider parsing, official evidence verification, identity/track checks, ranking, trust boundaries                    | Current scholarly-site availability and full live-discovery recall remain unverified       |
| Critical Read                                                                                                | Seven-step state machine, prerequisite/invalidation rules, reports and locale contracts                               | Full reader-input workflow and research efficacy not measured                              |
| Paper Mastery                                                                                                | Question/evaluation parsing, grading state, drafts, report restoration                                                | Learning efficacy and full native multi-round session not measured                         |
| Auto-highlight                                                                                               | Exact PDF text matching, deduplication and owned annotation logic                                                     | Actual annotation creation not repeated on the user's PDFs                                 |
| Extraction/retrieval and CLI execution                                                                       | OpenDataLoader command/fallback, chunk retrieval, environment, flag ordering, completion/stop, filesystem protections | Java and authenticated CLIs detected; packaged JAR verified                                |
| Workspace project intake, candidates, reading and screening                                                  | Persistence, IDs, binding, readiness, protocols and export                                                            | Native project window rendering inspected                                                  |
| Claim Ledger, profiled Critical Read, Methodology Audit, Reproducibility Audit, Paper-to-Code, Paper Mastery | Capability contracts, strict parsers, evidence reconciliation and run profiles                                        | All capability/provider workloads not run on real paper sets                               |
| Evidence Matrix, Quick Compare, Relationship Graph, Project Synthesis, Cross-paper Mastery                   | Cross-paper references, graph integrity, rubric and provenance tests                                                  | Multi-paper research accuracy requires separate evaluation                                 |
| Citation Context, Citation Stance, Citation & Reference Health                                               | Source-bound classification and deterministic health checklist tests                                                  | Native passage navigation and bibliographic-source changes not fully repeated              |
| Contradiction/gap review, Living Review, project templates                                                   | Revision and invalidation checks, local change signals, immutable template snapshots                                  | Live library changes not induced in the user's collection                                  |
| Workspace persistence, export, sync preview/approval/undo                                                    | Atomic writes, lineage, bundles, receipt-owned writes and fail-closed transaction tests                               | Actual library transaction/undo matrix not performed                                       |
| Studio DOCX, Markdown/source, file history and rename                                                        | Save coordinator, revision conflicts, format-preserving rename and link repair                                        | Browser create/edit/save/reopen/rename/history; exported DOCX opened and rendered in Word  |
| Studio assistant and review                                                                                  | Captured revision checks, exact replacements, edited proposal receipts, cancellation, process ownership               | Actual Codex proposal/apply, Claude reply and Ollama reply after the structured-output fix |
| Studio tables                                                                                                | CSV/TSV escaping, typed JSONL, precision, malformed data, row/column mutation                                         | Browser empty-grid guidance and empty-row save/reopen                                      |
| Studio notebooks                                                                                             | Notebook format, output updates/provenance, lifecycle, cancellation; real Python worker integration                   | Browser Python state sharing and Matplotlib; real worker integration; R/IRkernel absent    |
| Studio compilers and PDF                                                                                     | Commands, snapshots, cancellation, cache boundaries, output signatures                                                | Typst/Tectonic/MyST unavailable on current PATH; prior dated records remain historical     |
| Studio references, templates, Kanban, graphs and backups                                                     | BibTeX/CSL, field preservation, template copies, board links, checksum/restore transactions                           | Complex Word field refresh and full backup UI round-trip remain separate gates             |
| Packaging, settings and security boundaries                                                                  | Typecheck, lint, XPI build, license notices, dependency audit, host/browser separation                                | Actual installed XPI hash and native launch recorded separately                            |

## Verification record

- Node 24 satisfies the repository's Node 22.18+ baseline. The shell's default
  Node 20 is not used for these checks.
- `npm ci` completed in an isolated worktree.
- `npm test`: 1,392 passed, zero failures/skips after the regression additions.
- `npm run build`: typechecks source/tests and packages the add-on with the
  OpenDataLoader runtime and guarded editor patches.
- `npm run lint:check`: zero errors; 157 pre-existing warnings remain.
- `npm audit`: zero advisories after the targeted updates.
- `python test/studio_kernel_worker_test.py`: three real Python worker integration
  tests passed in a disposable environment with jupyter-client, ipykernel and
  matplotlib, including interrupts, queued cancellation and display updates.
- Browser DOCX export writes directly to the preview host's export directory;
  it is not a browser download event. Exported bytes were opened in Word 16.89.1
  and the Korean/English text and accepted Codex edit rendered correctly.
- Word displayed a license restriction and disabled editing/saving. Word-side
  edits, field refresh and reimport are therefore not claimed as passed.

Remaining manual checks are tracked in [manual QA](./manual-qa.md). Broader
Zotero 7–10, Windows/Linux, R, compiler installations, third-party service
availability and research efficacy remain distinct from the local automated
results. The original worktree, supplied user files and unrelated worktree were
preserved.
