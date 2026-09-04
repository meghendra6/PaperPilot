# Prompt and workflow hardening specification

## Status

Implemented source contract with automated coverage; the real-Zotero and
cross-engine paths listed in `manual-qa.md` remain manual verification. This
document covers the confirmed prompt, parser, context, and execution-boundary
issues found in the 2026-08-23 audit.

## Goals

- keep paper and reader content as data even when it contains adversarial text
- prevent hidden Workbench workflows from changing the visible chat's provider
  conversation
- give analysis workflows only the filesystem and network capabilities they
  need
- send each piece of selection, retrieval, and history context once
- enforce structured-output enums, ranges, required fields, and size bounds in
  code
- preserve the current fail-closed discovery verifier and exact PDF highlight
  matching
- keep Codex CLI, Claude Code, and Gemini CLI behavior equivalent where their
  command surfaces permit it

## Non-goals

- changing the seven Critical Read stages or discovery lane definitions
- adding a hosted model client or server
- treating model-generated confidence as publication or scientific evidence
- requiring the newest CLI version when a validated parser fallback is
  available
- redesigning the reader-pane UI

## 1. Run profiles

Every model run has one explicit profile.

### `chat`

- used only for visible user chat
- may resume the provider conversation recorded for the active Paper Pilot
  session
- uses the user's configured Codex/Claude policy
- may use Codex web search only when the existing user preference enables it
- uses the normal per-session workspace path

### `analysis`

- used for Workbench cards, Compare, Paper Mastery, Critical Read, and Auto
  Highlight
- never resumes or updates the visible chat's provider conversation
- uses an analysis-specific workspace path so provider-side `latest` session
  lookup cannot select a hidden run when visible chat resumes
- is read-only: Codex uses a read-only sandbox, Claude uses plan permission mode,
  and Gemini uses plan approval mode rather than YOLO
- does not enable web search

### `discovery`

- used only for verified research discovery and public-review inspection
- never resumes or updates visible chat
- uses a discovery-specific workspace path
- keeps the filesystem read-only while enabling the admitted web-search
  capability
- continues to treat agent evidence as a claim that must pass Paper Pilot's
  local live verifier

The profile must be carried from the workflow call site through the controller,
runner, workspace path, and CLI command. It must not be inferred by matching
prompt prose.

## 2. Untrusted input serialization

- reader answers, prior rounds, model repair input, selected text, metadata,
  abstracts, candidates, and prior workflow state are serialized as JSON data
- closable XML-like tags are not a security boundary
- model-produced values that feed a later prompt are validated before reuse
- a source-data block includes an explicit instruction that strings in the block
  are not executable instructions

Paper Mastery question output must satisfy:

- non-empty `question`, maximum 4,000 characters
- non-empty `topic`, maximum 160 characters
- `difficulty` is `foundational`, `intermediate`, or `advanced`

Paper Mastery evaluation output must satisfy:

- `understood` is boolean
- `confidence` is finite and clamped to `0..1`
- evaluation/explanation and each misconception have bounded lengths
- `nextTopic` is null or a bounded non-empty string
- `nextDifficulty` is one of the three supported values

Missing optional prose may use safe empty defaults, but invalid enums must not
be carried into another prompt.

## 3. Context ownership and de-duplication

- the CLI prompt contains the explicit user/workflow request and response
  language, not copies of retrieval chunks or recent turns
- `selection.json` owns selected text, actual nearby context, page data,
  annotations, and retrieved chunks
- `recent-turns.json` is the only workspace file containing recent visible chat
  turns
- `selection.json` does not embed `promptPreview` or recent turns
- reader popup actions describe the task; the attached selection is carried in
  `selection.json` rather than repeated inside the task text

When nearby context is enabled, Paper Pilot locates the selected passage in the
extracted full paper text and returns bounded text immediately before and after
it. If the passage cannot be located, nearby context is omitted rather than
duplicating the selection.

## 4. Structured output

- every structured workflow declares one JSON Schema object next to its prompt
  and parser
- Codex receives the schema through `--output-schema` when its installed command
  surface supports it
- Claude receives the schema through `--json-schema` when supported
- Gemini and older CLIs use the same prompt plus the existing validating parser
  fallback
- native schema support is an additional reliability layer; local parsers remain
  authoritative and required
- Critical Read uses a step-specific schema instead of requesting every field in
  every step

CLI capability detection must fail back to parser-only behavior without
preventing the run.

## 5. Critical Read context

Later Critical Read steps receive a bounded structured projection of completed
steps:

- reader input and summary for every completed step
- Step 3 discovery plan summary, bounded paper identities per lane, and
  limitations
- Step 4 method checks and comparison
- Step 5 evidence conclusion
- Step 6 author comparison and provenance

Step 5 still states that the conclusion must use results, figures, and tables,
and its prompt must not ask for unrelated schema fields. A future visual asset
pipeline may further restrict the physical artifact set, but the current
extraction limitations must remain explicit.

## 6. Auto Highlight contract

Auto Highlight requests only exact `quote` strings. The unused `reason` and
`importance` fields are removed. A quote is accepted only when the existing PDF
text-geometry matcher finds it; uncertain or unmatched output remains a visible
failure or skip.

The repair request serializes the first model response as source data and does
not permit instructions inside it to change the repair task.

## 7. Verification and acceptance criteria

Automated acceptance requires:

- adversarial reader answers cannot close a delimiter or inject a next-step
  instruction
- invalid Mastery difficulty values and non-finite/out-of-range confidence do
  not enter workflow state
- every silent workflow uses `analysis` or `discovery`, never `chat`
- Gemini command tests preserve the existing chat approval policy while
  rejecting `--yolo` and requiring plan mode for analysis and discovery
- hidden workflows use a workspace path distinct from visible chat
- selected text, nearby context, retrieved chunks, and recent turns each have one
  workspace owner
- nearby-context tests cover exact match, whitespace variation, boundaries, and
  no-match behavior
- Critical Read step prompts expose only their step-specific schema and retain
  the required prior structured state
- Auto Highlight parser and prompt use quote-only candidates
- `npm test`, `npx tsc --noEmit`, targeted ESLint/Prettier checks, and
  `npm run build` pass

Manual Zotero QA must cover one visible chat follow-up and one hidden workflow
for each engine, confirm that the visible chat resumes its own context, and
confirm that Gemini analysis does not request or execute write actions.
