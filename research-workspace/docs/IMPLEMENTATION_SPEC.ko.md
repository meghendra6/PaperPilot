# PaperPilot Research Workspace 0.3.0 구현 스펙

- **문서 상태:** Implemented specification
- **대상 구현:** `paperpilot-research-workspace@meghendra6`
- **버전:** 0.3.0
- **작성 기준일:** 2026-08-27
- **대상 플랫폼:** Zotero 7–10
- **배포 형태:** 기존 PaperPilot과 함께 설치하는 독립 companion add-on
- **Canonical source:** repository의 `research-workspace/src/`, `addon/`, `build-support/`, `scripts/`, `tests/`

---

## 1. 문서 목적

이 문서는 PaperPilot Research Workspace 0.3.0에 구현된 Phase 1–3 기능의 요구사항, architecture, data model, state transition, AI prompt contract, retrieval algorithm, persistence, 보안 경계, UI, build 및 acceptance criteria를 정의한다.

이 문서는 아이디어 제안서가 아니라 현재 제공되는 XPI의 동작과 source code를 설명하는 **implementation-aligned specification**이다. 각 주요 요구사항에는 실제 구현 파일을 연결한다.

규범적 표현은 다음 의미로 사용한다.

- **MUST:** 구현 정확성이나 데이터 무결성을 위해 반드시 지켜야 한다.
- **SHOULD:** 특별한 이유가 없다면 지켜야 한다.
- **MAY:** 선택적으로 지원할 수 있다.

---

## 2. 제품 정의

PaperPilot Research Workspace는 Zotero에서 논문을 다음 흐름으로 다루는 연구용 workbench다.

```text
논문 불러오기
  → local hybrid retrieval
  → claim/evidence 구조화
  → 분야별 Critical Read
  → reproducibility 및 Paper-to-Code 분석
  → Paper Mastery 2.0
  → 여러 논문의 Evidence Matrix / Literature Graph / Cross-paper Mastery
  → Citation Stance / Research Monitor
  → versioned workspace 저장 및 export
```

제품의 중심 원칙은 다음과 같다.

1. **Evidence grounding:** 중요한 claim과 평가에는 가능한 경우 PDF attachment/page/section evidence를 붙인다.
2. **Learner measurement:** 설명을 보여주는 것뿐 아니라 사용자가 이해했는지를 rubric으로 평가한다.
3. **Local orchestration:** Zotero add-on이 설치된 Codex CLI, Claude Code, Gemini CLI를 local process로 실행한다.
4. **Provider independence:** feature logic은 특정 AI provider SDK에 종속되지 않는다.
5. **Versioned state:** paper-level 및 collection-level artifact를 schema-versioned state로 보존한다.
6. **Fail closed:** malformed JSON, unsafe evidence locator, dangling graph edge, invalid rubric 등의 입력을 조용히 수용하지 않는다.

---

## 3. 범위

### 3.1 구현 범위

Phase 1:

- Paper Mastery 2.0 core
- structured `EvidenceReference`
- claim–evidence ledger
- CLI/process abstraction
- versioned workspace persistence 기반

Phase 2:

- local hybrid retrieval
- 분야별 Critical Read profile
- Reproducibility Assistant
- Paper-to-Code

Phase 3:

- Evidence Matrix
- Cross-paper Mastery
- Literature Graph
- Citation Stance
- Research Monitor
- workspace export

### 3.2 현재 배포 형태

0.3.0은 원본 PaperPilot `readerPane.ts`를 직접 교체하지 않는다. 별도 item pane section인 **Research Workspace**를 등록하는 companion add-on이다.

```text
Add-on ID: paperpilot-research-workspace@meghendra6
Pane ID:   paperpilot-research-workspace-pane
Chrome URI: chrome://paperpilot-research-workspace/
```

이 설계는 다음 목적을 가진다.

- 기존 PaperPilot 0.1.x workflow를 손상시키지 않는다.
- Phase 1–3 기능을 독립적으로 설치하고 검증한다.
- upstream integration 전에 state와 feature contract를 안정화한다.

### 3.3 Non-goals

0.3.0은 다음을 보장하지 않는다.

- AI inference가 완전히 offline이라는 보장
- 모든 provider가 동일한 web-search capability를 제공한다는 보장
- PDF bounding-box temporary highlight
- 원본 PaperPilot session history와 companion workspace의 자동 병합
- 별도 vector database 또는 external embedding server
- 자동 Zotero note synchronization
- 여러 PDF attachment 중 현재 열린 attachment를 정확히 우선하는 attachment role manager

---

## 4. System architecture

### 4.1 Layer model

```text
┌──────────────────────────────────────────────────────────────┐
│ Zotero Item Pane UI                                          │
│ src/companion/view.ts                                        │
├──────────────────────────────────────────────────────────────┤
│ Application Service                                          │
│ src/companion/service.ts                                     │
├──────────────────────────────────────────────────────────────┤
│ Feature Engines                                              │
│ Mastery / Retrieval / Critical Read / Matrix / Graph / ...   │
├──────────────────────────────────────────────────────────────┤
│ Platform Adapters                                            │
│ CLI process / Zotero items / PDF open / IO / export          │
│ src/companion/platform.ts, src/companion/agent.ts             │
├──────────────────────────────────────────────────────────────┤
│ Versioned Repository                                         │
│ researchWorkspace/state.ts, repository.ts                    │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Entry lifecycle

`src/companion/entry.ts`는 다음을 수행한다.

1. Zotero initialization 완료를 기다린다.
2. `structuredClone`이 없는 환경에는 JSON 기반 fallback을 설치한다.
3. `Zotero.ItemPaneManager.registerSection()`으로 pane을 등록한다.
4. main window에 stylesheet를 삽입한다.
5. pane render 시 active item을 service와 view에 전달한다.
6. shutdown 시 pane과 stylesheet를 제거한다.

MUST:

- 동일 session에서 section이 중복 등록되지 않아야 한다.
- shutdown 후 service singleton과 stylesheet가 남아서는 안 된다.
- reader tab이 아닌 곳에서는 section body를 숨겨야 한다.

### 4.3 Service orchestration

`ResearchWorkspaceService`는 UI가 feature engine을 직접 호출하지 않도록 다음을 orchestration한다.

- paper registration 및 indexing
- provider configuration
- AI prompt execution
- feature parser 실행
- result persistence
- export

UI는 raw state mutation을 수행하지 않고 service method를 호출해야 한다.

---

## 5. Source package 구조

```text
research-workspace/
├── addon/                       # XPI static files
│   ├── bootstrap.js
│   ├── manifest.json
│   ├── content/
│   └── locale/
├── src/                         # 53개 unminified runtime module body
│   ├── companion/
│   └── modules/
├── build-support/
│   ├── bundle-prefix.js
│   ├── bundle-suffix.js
│   ├── module-order.json
│   └── runtime.sha256
├── scripts/
│   ├── build.mjs
│   ├── package-xpi.mjs
│   ├── module-loader.mjs
│   └── verify.mjs
├── tests/run.mjs
├── docs/IMPLEMENTATION_SPEC.ko.md
└── package.json
```

### 5.1 Source representation

`src/**/*.ts`는 검토된 unminified runtime bundle을 module 단위로 분리한 CommonJS-compatible JavaScript body다. 파일명은 module ID와 deterministic build를 유지하기 위해 `.ts`를 보존한다.

- runtime logic 전체를 포함한다.
- minification 또는 obfuscation이 적용되지 않았다.
- `scripts/build.mjs`로 deterministic runtime bundle을 재생성한다.
- `build-support/runtime.sha256`가 review된 source bundle의 expected identity를 고정한다.

0.3.0 source release는 **runtime-reproducible source**다. Phase 2–3 전체를 original authoring TypeScript AST로 복원한 package는 아니다.

---

## 6. Global workspace state

### 6.1 Schema version

```text
RESEARCH_WORKSPACE_SCHEMA_VERSION = 3
```

구현 파일:

- `src/modules/researchWorkspace/state.ts`
- `src/modules/researchWorkspace/repository.ts`

### 6.2 Root state

```ts
interface ResearchWorkspaceStateV3 {
  schemaVersion: 3;
  revision: number;

  papers: Record<string, PaperWorkspaceRecord>;
  matrices: EvidenceMatrix[];
  graphs: LiteratureGraph[];

  crossPaperMastery: CrossPaperMasterySession[];
  crossPaperQuestions: CrossPaperQuestion[];
  crossPaperAttempts: CrossPaperAttempt[];

  citationContexts: CitationContext[];
  citationResults: CitationStanceResult[];

  monitors: ResearchMonitor[];
  monitorRuns: ResearchMonitorRun[];

  preferences: {
    provider: "codex" | "claude" | "gemini";
    executables: {
      codex: string;
      claude: string;
      gemini: string;
    };
    responseLanguage: string;
    maxPaperCharacters: number;
  };

  createdAt: string;
  updatedAt: string;
}
```

Default:

```json
{
  "provider": "codex",
  "executables": {
    "codex": "codex",
    "claude": "claude",
    "gemini": "gemini"
  },
  "responseLanguage": "English",
  "maxPaperCharacters": 1500000
}
```

`maxPaperCharacters`는 10,000–10,000,000 범위로 clamp한다.

### 6.3 Paper record

```ts
interface PaperWorkspaceRecord {
  paperKey: string;
  itemID?: number;
  attachmentKey: string;
  title: string;
  extractionQuality:
    | "structured"
    | "zotero_text"
    | "plain_text"
    | "unavailable";
  indexedAt?: string;

  claimLedger?: ClaimLedger;
  mastery?: MasterySessionV2;
  criticalReads: ProfiledCriticalReadReport[];
  reproducibilityReports: ReproducibilityReport[];
  paperToCodeReports: PaperToCodeReport[];
}
```

### 6.4 Persistence contract

기본 경로:

```text
<Zotero profile>/paperpilot-research-workspace/workspace-v3.json
```

Run artifact:

```text
<Zotero profile>/paperpilot-research-workspace/runs/<purpose>-<timestamp-random>/prompt.txt
```

Export:

```text
<Zotero profile>/paperpilot-research-workspace/exports/
```

Repository는 다음을 MUST 만족한다.

- write 시 temporary file을 만든 뒤 atomic move를 수행한다.
- successful save마다 `revision`을 증가시킨다.
- load 시 schema migration을 수행한다.
- persisted JSON이 corrupt하면 빈 state로 조용히 덮어쓰지 않고 error를 발생시킨다.
- caller에게 반환하는 state는 clone이어야 한다.

---

## 7. Paper source contract

구현 파일: `src/companion/platform.ts`

### 7.1 PDF resolution

- item 자체가 PDF attachment이면 그 attachment를 사용한다.
- parent bibliographic item이면 `getAttachments()` 중 첫 번째 PDF attachment를 사용한다.
- PDF가 없으면 operation을 중단한다.

현재 implementation은 active Reader attachment role이나 supplement role을 판별하지 않는다.

### 7.2 Text extraction

우선순위:

1. `attachment.attachmentText`
2. parent item abstract
3. unavailable placeholder

```text
zotero_text  → attachmentText 사용
plain_text   → abstract fallback
unavailable  → paper text 없음
```

Context는 metadata와 paper text를 결합한다.

```markdown
# <title>
Authors: ...
Date: ...
Publication: ...

## Abstract
...

## Extracted paper text
...
```

MUST:

- context 길이는 preference의 `maxPaperCharacters`를 넘지 않는다.
- unavailable text를 정상적인 full-paper extraction처럼 표시하지 않는다.
- UI에 `extractionQuality`, word count, attachment key를 표시한다.

---

## 8. Evidence model

구현 파일:

- `src/modules/evidence/types.ts`
- `src/modules/evidence/claimLedger.ts`
- `src/modules/evidence/claimExtraction.ts`

### 8.1 EvidenceReference

```ts
interface EvidenceReferenceV1 {
  schemaVersion: 1;
  attachmentKey: string;
  pageIndex?: number;       // zero-based
  pageLabel?: string;
  sectionPath?: string[];
  elementType?:
    | "paragraph"
    | "figure"
    | "table"
    | "equation"
    | "footnote"
    | "appendix"
    | "other";
  elementId?: string;
  quote?: string;
  quoteHash?: string;
  boundingBox?: {
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  extractionMethod?:
    | "structured"
    | "zotero_text"
    | "ocr"
    | "annotation"
    | "external";
  confidence?: number;
}
```

Validation:

- `attachmentKey`는 필수이며 slash, NUL, `.` 또는 `..`를 허용하지 않는다.
- `pageIndex`는 integer이고 최소 0이다.
- page count가 주어졌을 때 범위를 벗어난 page는 reference 전체를 거부한다.
- bounding box는 normalized coordinates `[0,1]`로 clamp한다.
- pageIndex와 bounding-box page가 불일치하면 box를 제거한다.
- `confidence`는 `[0,1]`로 clamp한다.
- section path는 최대 12 segment다.
- quote는 최대 1,200자다.
- 중복 reference는 stable key로 제거한다.

### 8.2 Evidence navigation

UI의 evidence button은 다음을 수행한다.

1. fallback attachment ID를 가져온다.
2. evidence의 attachment key가 다르면 accessible Zotero library에서 key를 탐색한다.
3. `Zotero.Reader.open(attachmentID, {pageIndex})`를 호출한다.
4. Reader API가 없으면 `viewAttachment()`로 fallback한다.

0.3.0은 page navigation까지 구현한다. bounding-box temporary highlight는 구현하지 않는다.

### 8.3 Claim ledger

Claim은 다음 source class를 구분해야 한다.

```text
author_claim
empirical_result
assumption
reader_inference
external_evidence
```

Verification status는 evidence에 따라 계산한다.

```text
verified
partially_verified
unverified
conflicting
```

Ledger는 duplicate evidence를 merge하지만, unsupported input을 자동으로 `verified`로 승격해서는 안 된다.

---

## 9. Phase 1 — Paper Mastery 2.0

구현 디렉터리: `src/modules/comprehensionCheck/v2/`

### 9.1 Mastery dimensions

Blueprint는 다음 여섯 차원을 사용한다.

```text
contribution
mechanism
assumption
evidence
limitation
transfer
```

Concept importance:

```text
core
supporting
```

### 9.2 Question modes

```text
recall
teach_back
figure_explanation
mechanism_trace
counterfactual
transfer
comparison
```

Difficulty:

```text
foundational
intermediate
advanced
```

### 9.3 Hidden blueprint trust boundary

AI가 blueprint를 생성한 후 question generator가 변경할 수 있는 것은 다음뿐이다.

- wording
- difficulty
- mode

Question parser는 `expectedClaims`, `rubric`, `evidence`를 question-generation response에서 신뢰하지 않고 validated blueprint에서 다시 주입한다.

MUST:

- question의 `conceptId`가 selected concept와 다르면 거부한다.
- rubric ID, max score, essential flag가 blueprint와 다르면 거부한다.
- learner가 답변하기 전 DOM에는 concept identity, expected claims, rubric, evidence를 넣지 않는다.

구현:

- `validation.ts`
- `engine.ts`
- `viewModel.ts`

### 9.4 Deterministic concept selection

우선순위는 다음 요소를 합산한다.

1. open major misconception
2. due review
3. untested core concept
4. developing concept의 낮은 score
5. supporting concept
6. 이미 mastered된 concept의 periodic review

Prerequisite가 모두 mastered되지 않은 concept은 선택 대상에서 제외한다.

### 9.5 Criterion-level grading

각 rubric criterion은 다음을 가진다.

```ts
interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  essential: boolean;
  evidence: EvidenceReference[];
}
```

Pass 조건:

```text
normalized score >= 0.70
AND 모든 essential criterion이 maxScore의 50% 이상
```

Concept mastered 조건:

```text
bestScore >= 0.80
AND 현재 grade에 major misconception이 없음
```

### 9.6 Metrics

```text
Coverage       = tested concept weight / total concept weight
AnswerQuality  = weighted earned score / weighted possible score
Calibration    = 1 - mean(|learnerConfidence - normalizedScore|)
Retention      = mean(delayed-review score)
```

Core concept weight는 2, supporting concept weight는 1이다.

### 9.7 Completion gate

Session은 다음을 모두 만족할 때만 complete다.

```text
coverage >= 0.90
core concept mastery ratio >= 0.90
answer quality >= 0.80
blueprint에 존재하는 모든 dimension이 최소 한 번 검사됨
advanced 또는 transfer question을 최소 한 번 pass
open major misconception = 0
```

AI가 임의로 `nextTopic = null`을 반환했다는 이유만으로 session을 종료하지 않는다.

### 9.8 Spaced review

Interval sequence:

```text
1, 3, 7, 14, 30, 60, 120 days
```

Rules:

- major misconception 또는 score < 0.5 → 1일
- score < 0.8 또는 hint level >= 3 → 3일
- 성공 review → sequence에서 다음 interval
- hint를 사용했으면 interval을 절반으로 줄이되 최소 1일

### 9.9 Misconception lifecycle

```text
open → repaired → retested
```

Misconception은 concept ID, statement, severity, evidence, timestamp를 보존한다.

---

## 10. Phase 2 — Local hybrid retrieval

구현 디렉터리: `src/modules/context/hybrid/`

### 10.1 Indexing

각 chunk는 다음 정보를 가진다.

```ts
interface HybridChunk {
  id: string;
  text: string;
  title?: string;
  pageIndex?: number;
  sectionPath?: string[];
  attachmentKey?: string;
  metadata?: Record<string, unknown>;
}
```

Index build 시 생성한다.

- normalized tokens
- term frequency
- document frequency
- average document length
- deterministic hash embedding

Default embedding dimension은 192이며 32–1,024 범위로 제한한다.

### 10.2 Tokenization

Tokenizer는 다음을 지원한다.

- technical identifier: `qk_scale`, `kv-cache`, `eagle3`
- punctuation-normalized identifier
- Korean 2–3 character n-gram
- stopword 제거
- domain aliases

대표 alias:

```text
ttft ↔ time-to-first-token / first-token-latency / prefill-latency
tpot ↔ time-per-output-token / inter-token-latency / decode-latency
itl ↔ inter-token-latency / time-per-output-token
kv ↔ key-value / kv-cache / cache
swa ↔ sliding-window-attention / window-attention
sd ↔ speculative-decoding / draft-verification
npu/gpu ↔ accelerator
```

### 10.3 Ranking

Default combined score:

```text
0.38 × lexical BM25-normalized
0.34 × semantic cosine-normalized
0.11 × title token overlap
0.10 × exact phrase match
0.07 × preferred-section match
```

BM25 parameters:

```text
k1 = 1.35
b  = 0.72
```

Top candidates에서 MMR diversity selection을 수행한다.

```text
MMR lambda = 0.82
candidate multiplier = 5
```

Return value에는 component score와 matched terms를 포함한다.

### 10.4 Chunking

Default:

```text
chunk size = 1,400 characters
overlap    = 220 characters
```

가능하면 paragraph 또는 sentence boundary에서 자른다. Markdown heading을 section title/path로 유지한다.

### 10.5 Evaluation

Retrieval evaluator는 다음을 계산한다.

```text
Recall@K
MRR
nDCG
```

Metric 계산은 relevant result가 없거나 empty index인 경우에도 NaN을 반환해서는 안 된다.

---

## 11. Phase 2 — Profiled Critical Read

구현 디렉터리: `src/modules/criticalRead/profiled/`

### 11.1 Profile IDs

```text
empirical_ml
ml_systems
systems
theory
clinical
qualitative
general
```

### 11.2 Detection

Profile detector는 paper context에 나타나는 signal phrase를 scoring한다. 최고 score가 threshold를 넘지 못하면 `general`을 선택한다. 두 번째 profile이 충분히 가까우면 secondary profile을 기록한다.

Detector output:

```ts
{
  primary: ProfileID;
  secondary?: ProfileID;
  confidence: number;
  scores: Record<ProfileID, number>;
  reasons: string[];
}
```

### 11.3 Common checks

모든 profile은 다음을 포함한다.

- claim–scope alignment
- claim–evidence traceability
- alternative explanations
- reproducibility

### 11.4 ML Systems checks

- workload representativeness
- hardware/software configuration
- metric integrity
- baseline parity
- end-to-end accounting
- resource trade-offs

특히 다음을 구분해야 한다.

```text
TTFT / TPOT / ITL / throughput / tail latency
warm-up / steady-state
kernel-only / end-to-end
host overhead / device execution
draft cost / target verification cost
simulator / silicon
```

### 11.5 Parser contract

각 required check는 report에 대응 finding을 가져야 한다. Finding status:

```text
supported
partial
unsupported
not_applicable
unclear
```

Severity:

```text
none
minor
major
critical
```

Parser는 unknown check, duplicate check, malformed evidence를 거부해야 한다.

---

## 12. Phase 2 — Reproducibility Assistant

구현 디렉터리: `src/modules/reproducibility/`

### 12.1 Artifact kinds

주요 kind:

```text
code
commit
dataset / data
model
environment
hardware
training_config / training
inference_config / inference
evaluation_command / evaluation
random_seeds
license
results
other
```

Availability:

```text
available
partial
missing
not_applicable
unclear
```

### 12.2 Readiness score

Artifact kind별 weight를 적용한다. 대표 weight:

```text
code                3.0
dataset/data        3.0
evaluation command  2.5
commit               2.0
environment          2.0
training config      2.0
inference config     2.0
hardware             1.5
random seeds         1.0
```

Availability value:

```text
available       1.0
partial         0.5
unclear         0.2
missing         0.0
not_applicable  excluded
```

Blocker penalty:

```text
critical  0.18 each
major     0.08 each
minor     0.025 each
```

Label:

```text
score < 0.35 or critical blocker → not_ready
score < 0.60                     → partial
score < 0.82                     → mostly_ready
otherwise                        → ready
```

### 12.3 Required groups

다음 group이 report에 없으면 missing으로 간주한다.

- code
- dataset/data
- environment
- evaluation command/evaluation

---

## 13. Phase 2 — Paper-to-Code

구현 디렉터리: `src/modules/paperToCode/`

Report는 다음을 포함한다.

- algorithm overview
- pseudocode
- tensor/shape trace
- state transition
- memory and computation complexity
- invariants
- implementation ambiguities
- paper/code divergence candidates
- minimal reproduction steps
- verification checklist

Parser는 다음 원칙을 따른다.

- shape나 state를 근거 없이 확정하지 않는다.
- ambiguity를 누락 정보로 표현할 수 있어야 한다.
- implementation impact를 정규화한다.
- evidence locator를 가능한 경우 포함한다.

Markdown export를 지원한다.

---

## 14. Phase 3 — Evidence Matrix

구현 디렉터리: `src/modules/evidenceMatrix/`

### 14.1 Matrix model

```ts
interface EvidenceMatrix {
  schemaVersion: 2;
  id: string;
  title: string;
  name: string;
  columns: EvidenceMatrixColumn[];
  papers: EvidenceMatrixPaper[];
  cells: EvidenceMatrixCell[];
  rows: EvidenceMatrixRow[];
  createdAt: string;
  updatedAt: string;
}
```

Column value type:

```text
text
number
boolean
list
enum
```

Column ID는 `[a-zA-Z0-9._-]+`를 만족해야 한다. Enum column은 `enumValues`를 가져야 한다.

### 14.2 Default columns

Companion service는 다음 column을 기본으로 사용한다.

- Main contribution
- Method
- Datasets / workloads
- Hardware
- Primary metric
- Limitation
- Code available

### 14.3 Typed cell normalization

- number는 finite number로 변환할 수 있어야 한다.
- boolean은 `true/false`, `yes/no`, `1/0`을 허용한다.
- list는 array 또는 comma/semicolon-separated text를 허용한다.
- enum은 허용된 값에 속해야 한다.
- required-evidence column의 값에는 evidence가 SHOULD 포함되어야 한다.

### 14.4 Coverage

```text
ExtractionCoverage = filled extracted cells / all cells
EvidenceCoverage = evidenced filled cells / filled cells
RequiredEvidenceCoverage = evidenced required cells / required cells
```

### 14.5 Export

- CSV: quoting과 embedded quote escaping
- Markdown: cell value와 source locator

---

## 15. Phase 3 — Cross-paper Mastery

구현 디렉터리: `src/modules/crossPaperMastery/`

Question mode:

```text
compare
synthesis
conflict
transfer
timeline
```

Question은 최소 두 paper key를 참조해야 한다. Rubric criterion은 자신이 참조하는 paper key와 required claims를 가진다.

MUST:

- selected paper에 없는 paper key를 question/rubric이 참조하면 거부한다.
- hidden rubric은 grade 전 learner view에 노출하지 않는다.
- score는 blueprint max score를 source of truth로 사용한다.
- learner confidence와 actual score로 calibration을 추적한다.

---

## 16. Phase 3 — Literature Graph

구현 디렉터리: `src/modules/literatureGraph/`

### 16.1 Node kinds

```text
paper
concept
claim
method
dataset
```

### 16.2 Edge kinds

```text
introduces
uses
extends
improves
challenges
supports
contradicts
compares
evaluates_on
related
```

### 16.3 Integrity constraints

- node ID와 label은 비어 있으면 안 된다.
- edge source/target은 existing node여야 한다.
- self-edge를 허용하지 않는다.
- duplicate node/edge ID를 report한다.
- evidence 없는 edge와 `verified=false` edge는 warning을 생성한다.

### 16.4 Graph operations

- add/update node
- add/update edge
- merge
- integrity validation
- shortest undirected path
- connected components
- Mermaid export
- JSON export

Mermaid export는 ID와 label을 escape해야 한다.

---

## 17. Phase 3 — Citation Stance

구현 디렉터리: `src/modules/citationStance/`

Stance:

```text
supporting
contrasting
mentioning
methodological
unclear
```

Definition:

- **supporting:** cited claim과 일치하는 구체적 evidence를 제공한다.
- **contrasting:** cited claim을 반박하거나 conflicting result를 보고한다.
- **methodological:** method/data를 사용하지만 claim validity를 평가하지 않는다.
- **mentioning:** neutral background citation이다.
- **unclear:** context만으로 분류할 수 없다.

Classification은 citation count나 sentiment만으로 추론해서는 안 된다.

Summary는 stance별 count와 classified rate를 제공한다. 입력 context 순서를 보존하고 누락 classification은 `unclear`로 처리한다.

---

## 18. Phase 3 — Research Monitor

구현 디렉터리: `src/modules/researchMonitor/`

### 18.1 Monitor model

```ts
interface ResearchMonitor {
  id: string;
  name: string;
  query: string;
  collectionKey?: string;
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "custom";
  cadenceDays: number;
  nextRunAt: string;
  nextCheckAt: string;
  lastRunAt?: string;
  enabled: boolean;
  seenIdentifiers: string[];
}
```

Cadence day:

```text
daily       1
weekly      7
monthly    30
quarterly  91
custom    1–365
```

### 18.2 Candidate identity

우선순위:

```text
DOI
URL
<title>:<year>
```

Public candidate는 DOI 또는 direct publication/official URL을 가져야 한다. 식별자가 없는 candidate는 제거한다.

`seenIdentifiers`는 case-insensitive하며 최근 최대 5,000개를 유지한다.

### 18.3 Ranking

```text
Overall = 0.50 × relevance
        + 0.20 × novelty
        + 0.30 × evidenceValue
```

Action:

```text
overall >= 0.75 → add/save
overall >= 0.45 → review
otherwise       → ignore
```

Codex provider에서 monitor run은 web-search flag를 활성화한다. 실제 검색 결과의 품질과 provider capability는 CLI 설정에 의존한다.

---

## 19. AI execution contract

구현 파일:

- `src/companion/agent.ts`
- `src/companion/platform.ts`

### 19.1 Prompt transport

논문과 instruction 전체를 command-line argument에 직접 넣지 않는다.

1. run directory 생성
2. `prompt.txt`를 UTF-8로 저장
3. CLI에는 prompt file을 읽으라는 짧은 instruction만 전달
4. stdout을 final result로 수집

이 방식은 command-line length, shell quoting, process list leakage를 줄인다.

### 19.2 Provider argv

Codex:

```text
[--search]
exec
--cd <run-directory>
--sandbox read-only
--skip-git-repo-check
<read-prompt-file instruction>
```

Claude:

```text
-p <instruction>
--output-format text
--permission-mode plan
--add-dir <run-directory>
```

Gemini:

```text
-p <instruction>
```

### 19.3 Process execution

- Mozilla `Subprocess.sys.mjs`를 사용한다.
- executable과 argv를 분리한다.
- `/bin/zsh -lc`를 사용하지 않는다.
- stdout과 stderr를 동시에 drain하여 pipe deadlock을 방지한다.
- non-zero exit code는 error다.
- stdout이 비었고 stderr가 있으면 stderr를 error로 사용한다.

### 19.4 Executable discovery

이름만 입력된 경우 PATH search 후 다음을 검사한다.

```text
/opt/homebrew/bin/<name>
/usr/local/bin/<name>
/usr/bin/<name>
$HOME/.local/bin/<name>
$HOME/.npm-global/bin/<name>
```

절대/상대 path에 slash가 있으면 file existence를 확인한다.

---

## 20. Prompt and structured-output contract

모든 feature prompt는 다음 원칙을 SHOULD 따른다.

1. paper/context를 trust-labeled source-data block으로 감싼다.
2. prompt injection으로 해석하지 말고 분석 대상 data로 취급하도록 지시한다.
3. JSON-only output이 필요한 workflow에서는 명시적 schema를 제공한다.
4. evidence attachment key를 supplied set으로 제한한다.
5. parser가 model output을 정규화하고 unknown enum/ID를 거부한다.
6. parser가 markdown fence나 앞뒤 prose 속 마지막 balanced JSON object를 복구할 수 있다.

Mastery에서는 특히 model-generated rubric을 question/grade stage에서 다시 신뢰하지 않는다.

---

## 21. UI specification

구현 파일: `src/companion/view.ts`

Pane section:

### 21.1 Configuration

- provider
- executable
- response language
- max paper characters
- Save

### 21.2 Local hybrid search

- query input
- Search
- result score, section, page, component score, excerpt

### 21.3 Understand and challenge

- Extract claims
- Critical Read
- Reproducibility
- Paper-to-Code

### 21.4 Paper Mastery 2.0

- Start / Resume
- learner-safe question
- answer textarea
- confidence slider
- Submit answer
- feedback/dashboard

### 21.5 Selected-paper intelligence

Zotero에서 두 개 이상의 item을 선택한 뒤 사용한다.

- Evidence Matrix
- Literature Graph
- Cross-paper question
- Grade cross-paper answer

### 21.6 Citation stance

0.3.0 UI는 citation context JSON array를 직접 입력받는다.

### 21.7 Research monitor

- monitor name
- scholarly query
- Add
- existing monitor selector
- Run now

### 21.8 Export

- workspace JSON
- workspace Markdown summary

### 21.9 Error and busy state

- operation 동안 action button을 disable한다.
- status region은 `info`, `success`, `error`를 구분한다.
- error를 삼키지 않고 사용자에게 message를 표시한다.
- result object는 circular reference를 방어하며 readable JSON으로 표시한다.
- evidence reference에는 “Open evidence” action을 붙인다.

---

## 22. Security and privacy

### 22.1 Local versus remote

Add-on orchestration은 local이지만, 선택한 CLI/provider가 paper content를 remote inference service로 전송할 수 있다. UI/documentation은 이를 offline inference로 오해하게 해서는 안 된다.

### 22.2 Read-only execution

- Codex는 `--sandbox read-only`
- Claude는 `--permission-mode plan`
- run directory만 Claude `--add-dir`로 제공

### 22.3 Data minimization

- paper context는 configured max length로 자른다.
- prompt는 run directory의 file로 전달한다.
- monitor 외 workflow는 web search를 기본 활성화하지 않는다.

### 22.4 Untrusted output validation

다음은 parser에서 검증한다.

- evidence attachment key
- page and bounding box
- enum
- graph endpoint
- rubric criterion
- paper key
- typed matrix cell
- DOI/URL candidate identity

---

## 23. Error handling

MUST fail:

- PDF attachment 없음
- AI CLI executable 없음
- non-zero process exit
- empty model output
- invalid persisted JSON
- malformed structured JSON
- unknown mastery criterion
- duplicate rubric grade
- dangling graph edge
- invalid Evidence Matrix column/cell type
- research monitor candidate에 DOI/URL 없음

SHOULD degrade gracefully:

- attachment text가 없으면 abstract fallback
- evidence page는 있으나 bounding box가 invalid하면 page locator만 보존
- citation classification이 누락되면 `unclear`
- profile signal이 약하면 `general`

---

## 24. Build and reproducibility

### 24.1 Requirements

```text
Node.js >= 20
zip / unzip
```

### 24.2 Commands

```bash
npm test
npm run build
npm run package
npm run verify
```

### 24.3 Build algorithm

1. `build-support/module-order.json` 순서로 53개 module body를 읽는다.
2. `bundle-prefix.js`와 `bundle-suffix.js` 사이에 module factory를 삽입한다.
3. `addon/` static files를 `build/`로 복사한다.
4. runtime bundle을 `build/content/scripts/`에 기록한다.
5. `zip -X`로 XPI를 생성한다.

### 24.4 Reproducibility criterion

`npm run verify`는 rebuilt runtime bundle의 SHA-256이 `build-support/runtime.sha256`의 reviewed identity와 동일한지 검사한다.

Reviewed runtime SHA-256:

```text
294b9749f3bfe00a839d836a282d3d1dbe59df046db91c753bbf0a0763e88e0f
```

XPI 자체의 ZIP timestamp/order는 build마다 달라질 수 있으므로 byte-identical XPI는 요구하지 않는다. 대신 required entry와 runtime bundle identity를 검사한다.

---

## 25. Test and acceptance criteria

### 25.1 Source-release verification

`tests/run.mjs`는 다음 representative contract를 검사한다.

1. technical tokenizer 및 alias
2. hybrid retrieval ranking
3. evidence clamp/validation
4. criterion-level mastery grading
5. hidden rubric non-disclosure
6. ML Systems profile detection
7. blocker-aware reproducibility score
8. Evidence Matrix coverage
9. Literature Graph integrity/path
10. Research Monitor deduplication
11. schema v3 migration
12. provider-safe CLI argv
13. unmatched prose brace 뒤 balanced JSON recovery
14. BM25 term frequency와 same-length source index invalidation
15. serialized atomic repository update와 unsafe storage rejection
16. future schema rejection
17. storage read failure propagation과 corrupt JSON rejection
18. misconception repair/retest lifecycle
19. distinct cross-paper identity와 complete rubric grading
20. duplicate graph ID rejection과 collision-free Mermaid export
21. complete monitor ranking과 deterministic action threshold
22. citation evidence attachment allowlist
23. source-data delimiter escaping
24. complete Paper-to-Code report surface
25. Zotero 10 manifest compatibility range

`verify.mjs`는 추가로 다음을 검사한다.

- 53개 runtime module syntax/link
- test pass
- bundle build
- reviewed runtime SHA equality
- XPI package
- required XPI entries

### 25.2 Current verification source of truth

현재 repository에서는 `tests/run.mjs`, `scripts/verify.mjs`, `build-support/runtime.sha256`를 source of truth로 사용한다. 외부 source release의 historical log나 prebuilt XPI는 merge 완료의 증거로 사용하지 않는다.

### 25.3 Runtime acceptance

실제 release acceptance에는 다음 manual test가 추가로 필요하다.

- Zotero 7, 8, 9, 10에서 pane registration
- macOS/Linux/Windows executable discovery
- Codex/Claude/Gemini authenticated live run
- Korean and English response
- large indexed PDF
- missing full-text index fallback
- multiple attachment behavior
- state file corruption recovery procedure
- evidence page navigation
- restart 후 workspace persistence

---

## 26. Original PaperPilot integration specification

Companion architecture를 upstream에 직접 합칠 때 다음 순서를 따른다.

### 26.1 Feature engine reuse

다음 디렉터리는 UI와 독립적이므로 우선 재사용한다.

```text
modules/comprehensionCheck/v2
modules/context/hybrid
modules/criticalRead/profiled
modules/evidence
modules/reproducibility
modules/paperToCode
modules/evidenceMatrix
modules/crossPaperMastery
modules/literatureGraph
modules/citationStance
modules/researchMonitor
modules/researchWorkspace
```

### 26.2 Adapter replacement

Companion-specific adapter를 원본 PaperPilot service로 교체한다.

```text
companion/agent.ts
  → 기존 workspaceRun / provider runners

companion/platform.ts paper loading
  → paperWorkspaceContentCache / OpenDataLoader structured extraction

researchWorkspace/repository.ts
  → session snapshot 또는 별도 versioned repository

companion/view.ts
  → readerPane feature sections
```

### 26.3 Required upstream changes

1. `readerPane.ts`에 기능을 직접 더 넣지 말고 feature controller/view로 분리한다.
2. `EvidenceReference`를 chat, Critical Read, Mastery, artifact에 공통 적용한다.
3. original OpenDataLoader output에서 page/section/figure/table locator를 생성한다.
4. existing session snapshot에 schema migration을 추가한다.
5. provider runner의 structured output retry와 cancellation lifecycle을 재사용한다.
6. collection-level feature는 active item state와 별도로 저장한다.
7. legacy Paper Mastery state는 v2 migration 후 read-only legacy report로 보존한다.

### 26.4 Integration acceptance

- original PaperPilot test가 모두 유지되어야 한다.
- Phase 1–3 feature test가 통과해야 한다.
- reader pane rebuild/cancel/session switching regression이 없어야 한다.
- existing PaperPilot workspace cleanup 정책과 monitor persistence가 충돌하지 않아야 한다.
- OpenDataLoader structured evidence가 companion의 plain-text evidence보다 우선되어야 한다.

---

## 27. Known limitations of 0.3.0

1. **Runtime source representation:** Phase 2–3 source는 original authoring TypeScript가 아니라 검토된 unminified CommonJS module body다.
2. **PDF extraction:** companion loader는 Zotero indexed `attachmentText`를 사용하며 bundled OpenDataLoader를 직접 호출하지 않는다.
3. **Multiple PDF attachment:** 첫 PDF를 선택하며 main/supplement role UI가 없다.
4. **Evidence highlight:** page open은 되지만 bounding-box highlight는 없다.
5. **Citation input UX:** citation context를 JSON으로 직접 입력한다.
6. **Monitor scheduling:** due-time model은 있지만 background scheduler/notification daemon은 없다. UI에서 `Run now`를 실행한다.
7. **Cross-paper confidence:** UI grade path는 learner confidence를 0.7로 고정한다.
8. **Localization:** pane text 대부분은 English hard-coded이며 Fluent localization은 section title 수준이다.
9. **Original PaperPilot integration:** companion state와 original session state가 자동 통합되지 않는다.
10. **Live E2E:** 제공 환경에서는 사용자의 authenticated CLI와 GUI Zotero live run을 수행하지 않았다.

---

## 28. Implementation-to-code map

| Capability | Canonical implementation |
|---|---|
| Add-on startup/shutdown | `src/companion/entry.ts` |
| Zotero pane UI | `src/companion/view.ts` |
| Feature orchestration | `src/companion/service.ts` |
| CLI prompt/file transport | `src/companion/agent.ts` |
| Zotero IO/process/PDF open | `src/companion/platform.ts` |
| Workspace schema/migration | `src/modules/researchWorkspace/state.ts` |
| Atomic repository | `src/modules/researchWorkspace/repository.ts` |
| Evidence reference | `src/modules/evidence/types.ts` |
| Claim ledger | `src/modules/evidence/claimLedger.ts` |
| Claim extraction | `src/modules/evidence/claimExtraction.ts` |
| Mastery controller | `src/modules/comprehensionCheck/v2/controller.ts` |
| Mastery state engine | `src/modules/comprehensionCheck/v2/engine.ts` |
| Mastery prompts | `src/modules/comprehensionCheck/v2/prompt.ts` |
| Mastery validation | `src/modules/comprehensionCheck/v2/validation.ts` |
| Learner-safe views | `src/modules/comprehensionCheck/v2/viewModel.ts` |
| Review scheduler | `src/modules/comprehensionCheck/v2/reviewScheduler.ts` |
| Hybrid tokenizer | `src/modules/context/hybrid/tokenizer.ts` |
| Hash embedding | `src/modules/context/hybrid/hashEmbedding.ts` |
| Hybrid index | `src/modules/context/hybrid/index.ts` |
| Hybrid ranking/MMR | `src/modules/context/hybrid/search.ts` |
| Retrieval metrics | `src/modules/context/hybrid/evaluation.ts` |
| Critical Read profiles | `src/modules/criticalRead/profiled/profiles.ts` |
| Profile detector | `src/modules/criticalRead/profiled/detector.ts` |
| Critical Read parser | `src/modules/criticalRead/profiled/parser.ts` |
| Reproducibility | `src/modules/reproducibility/` |
| Paper-to-Code | `src/modules/paperToCode/` |
| Evidence Matrix | `src/modules/evidenceMatrix/` |
| Cross-paper Mastery | `src/modules/crossPaperMastery/` |
| Literature Graph | `src/modules/literatureGraph/` |
| Citation Stance | `src/modules/citationStance/` |
| Research Monitor | `src/modules/researchMonitor/` |
| Reproducible bundle build | `scripts/build.mjs` |
| XPI packaging | `scripts/package-xpi.mjs` |
| Verification | `scripts/verify.mjs`, `tests/run.mjs` |

---

## 29. Final acceptance definition

PaperPilot Research Workspace 0.3.0 구현은 다음 조건을 만족할 때 source-release 관점에서 complete로 간주한다.

```text
[Required] 53개 runtime module이 모두 load됨
[Required] representative tests가 모두 통과함
[Required] rebuilt runtime bundle SHA가 reviewed runtime identity와 동일함
[Required] installable XPI required entry가 모두 존재함
[Required] schema v3 persistence와 migration이 동작함
[Required] Phase 1–3 feature engine이 service/UI에서 호출 가능함
[Required] malformed structured output을 parser가 거부함
[Required] learner pre-answer view에 hidden rubric이 노출되지 않음
[Required] CLI가 executable/argv 분리와 read-only policy를 사용함
[Required] known limitations가 문서화됨
```

실제 upstream merge의 complete 정의에는 별도로 graphical Zotero E2E, original PaperPilot regression suite, OpenDataLoader structured evidence integration을 추가해야 한다.
