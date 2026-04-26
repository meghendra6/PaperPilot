# Paper Pilot for Zotero 7

> Languages: [English](./README.md) | [한국어](./README.ko.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

**Paper Pilot는 Zotero 7 PDF 리더를 AI 기반 논문 워크벤치로 바꿔줍니다.**

Paper Pilot는 Zotero 7 PDF 리더를 위한 AI 읽기 워크벤치입니다. Zotero 안에서 논문별 채팅 패널, 구조화된 논문 도구, 관련 논문 탐색, 로컬 CLI 기반 AI 실행 기능을 제공합니다.

![Zotero 7](https://img.shields.io/badge/Zotero-7-cc2936) ![Node 20+](https://img.shields.io/badge/Node-20%2B-339933) ![Java 11+](https://img.shields.io/badge/Java-11%2B-007396) ![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue) ![Engines](https://img.shields.io/badge/Engines-Codex%20CLI%20%7C%20Gemini%20CLI-6f42c1)

## 한눈에 보기

- Zotero Reader 안에서 바로 사용하는 AI 채팅
- 두 가지 로컬 엔진 모드: **Codex CLI**, **Gemini CLI**
- brief, compare, contributions, limitations, follow-ups를 위한 구조화된 논문 워크벤치
- 관련 논문 추천, 열기, 컬렉션 추가 흐름 지원
- auto-highlight 및 저장되는 논문 단위 세션 기록 지원
- **Paper Mastery** — 다회차 소크라테스식 이해도 점검 후 Markdown 학습 리포트 생성
- 자동화된 로컬 검증은 갖춰져 있지만, 실제 Zotero 런타임 QA는 아직 남아 있음

## 스크린샷과 데모

현재 저장소에는 **스크린샷이나 데모 클립이 아직 포함되어 있지 않습니다**.

다음과 같은 시각 자료를 추가하면 좋습니다.

- AI 사이드바가 보이는 Zotero 리더 패널 화면
- 구조화된 **Research brief** 카드
- 그룹형 **Related papers** 추천 화면
- **Compare** 워크플로우와 저장 아티팩트 흐름

향후 UI 시각 자료를 문서화할 때는 `docs/images/` 경로와 짧은 캡션 링크를 사용하는 방식을 권장합니다.

## 상태

Paper Pilot는 현재 활발히 개발 중입니다.

이미 갖춰진 부분:

- 핵심 로직에 대한 자동화 테스트
- Zotero 애드온 프로덕션 빌드 생성
- 채팅, 논문 도구, 추천, 하이라이트용 리더 패널 워크플로우

아직 완전한 프로덕션 준비 상태라고 보기 전에 필요한 부분:

- 실제 Zotero 7 런타임에서의 엔드투엔드 수동 QA
- 실제 사용자 환경 전반에 대한 설치/환경 검증 확대

현재 런타임 체크리스트는 [`docs/manual-qa.md`](./docs/manual-qa.md)를 참고하세요.

## 플러그인이 하는 일

### 1. 리더 내 AI 채팅

- Zotero 리더/아이템 패널에 AI 패널 추가
- 대화를 현재 논문 단위로 유지
- 논문별로 Codex CLI와 Gemini CLI 전환 지원
- 같은 논문/세션 안에서 후속 질문 맥락 유지
- 현재 논문의 저장된 세션을 다시 열고, 이름 변경하고, 삭제하고, 한 번에 모두 지울 수 있는 **Past sessions** 지원
- **New session**은 현재 세션을 보존한 채 같은 논문에서 비어 있는 새 초안을 시작

### 2. 리더 내 논문 맥락 액션

PDF 선택 영역이나 주석에서 다음과 같은 AI 워크플로우를 시작할 수 있습니다.

- **Ask AI**
- **Explain**
- **Summarize**
- **Translate**

### 3. 논문 워크벤치 도구

리더 패널에는 현재 논문을 위한 구조화된 워크플로우가 포함됩니다.

- **Research brief**
- **Compare**
- **Contributions**
- **Limitations**
- **Follow-ups**
- **Save latest to note**
- **Save for collection**
- **Clear cards**

이 워크플로우는 긴 일반형 채팅 응답보다, 리더 패널에 맞는 짧고 구조화된 결과를 만들도록 설계되어 있습니다.

### 4. 관련 논문 탐색

Paper Pilot는 그룹화된 관련 논문 추천을 생성하고 다음 작업을 도와줍니다.

- 카테고리별 인접 논문 확인
- 추천 논문 열기
- 추천 논문을 Zotero 컬렉션에 추가
- 비교 워크플로우에 사용할 제한된 입력 집합 구성

### 5. 자동 하이라이트 워크플로우

현재 논문에서 신뢰도 높은 핵심 구절을 추출해 리더 워크플로우에 다시 반영하는 auto-highlight 경로를 포함합니다.

### 6. Paper Mastery (이해도 점검)

리더 패널에는 현재 논문에 대한 다회차 소크라테스식 이해도 점검을 진행하는 **Paper Mastery** 워크플로우가 포함됩니다.

- AI가 논문의 핵심 기여, 방법론, 가정 등에 초점을 맞춘 개방형 질문을 한 번에 하나씩 생성합니다.
- 사용자는 자유 서술로 답변하고, AI는 각 답변을 평가하여 해당 주제를 이해했는지 기록합니다.
- 세션을 종료하면 강점, 개선이 필요한 부분, 주요 오개념, 재독 추천을 담은 Markdown 학습 리포트가 생성됩니다.

Mastery 프롬프트는 질문/평가 응답을 엄격한 JSON으로 강제하며(추론/서문 금지), 사용자 답변을 `<user_answer>` 태그로 감싸고, JSON 응답에 markdown 펜스가 오더라도 복구할 수 있도록 파서가 문자열/이스케이프를 인식합니다. 따옴표 안의 `}`가 유효한 JSON을 잘라내지 않도록 처리됩니다.

### 7. Codex용 로컬 워크스페이스 아티팩트

**Codex CLI** 모드에서 질문하면, Paper Pilot는 CLI가 답변 전에 로컬 논문 맥락을 확인할 수 있도록 논문별 워크스페이스를 생성합니다.

대표적인 아티팩트:

- `CONTEXT_INDEX.md`
- `paper.md`
- `paper.json`
- `paper.txt`
- `selection.json`
- `recent-turns.json`
- `metadata.json`
- `annotations.json`
- `figures/`

`paper.md`는 구조화 Markdown 추출 결과이고, `paper.json`은 구조화 PDF 요소와 추출 메타데이터를 담습니다. `paper.txt`는 하위 호환성과 평문 폴백 경로로 유지됩니다.

Java를 사용할 수 없으면 Paper Pilot는 폴백 사실을 `metadata.json`에 기록합니다.

이를 통해 Codex는 현재 논문, 선택 영역, 최근 대화 맥락에 근거해 답변할 수 있습니다.

## 기능 개요

| 영역           | 현재 지원                                                       |
| -------------- | --------------------------------------------------------------- |
| 리더 채팅      | Zotero Reader 내부의 논문 단위 AI 채팅                          |
| 엔진           | Codex CLI, Gemini CLI                                           |
| 논문 워크벤치  | Research brief, compare, contributions, limitations, follow-ups |
| 탐색           | 그룹형 관련 논문 추천                                           |
| 저장           | 최신 결과 note 저장, 컬렉션용 workbench artifact 저장           |
| 맥락 기반 응답 | workspace artifact, retrieval context, 최근 대화 연속성         |
| 하이라이트     | 핵심 구절용 auto-highlight 워크플로우                           |
| 이해도 점검    | Paper Mastery 다회차 이해도 점검 및 Markdown 학습 리포트        |

## 엔진 모드

| 모드         | 적합한 용도                 | 현재 강점                                                                             |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------- |
| `Codex CLI`  | 워크스페이스 기반 논문 분석 | 로컬 워크스페이스 아티팩트, 재개 가능한 실행, 모델/샌드박스/승인 제어, 선택적 웹 검색 |
| `Gemini CLI` | 가벼운 로컬 논문 Q&A        | 단순한 실행 파일/모델 설정, 논문 단위 맥락 유지, 로컬 retrieval/context 구성          |

### Codex CLI 모드

Codex 모드는 더 워크스페이스 지향적인 경로입니다. 현재 코드베이스에는 다음이 포함되어 있습니다.

- 실행 파일 탐색 및 검증
- 로그인/상태 확인
- 워크스페이스 쓰기 가능 여부 확인
- `gpt-5.5` 모델 선택 및 `low`, `medium`, `high`, `xhigh` reasoning effort 옵션
- sandbox 및 approval 설정
- 선택적 웹 검색 토글
- 현재 논문에 연결된 후속 실행 재개

### Gemini CLI 모드

Gemini 모드는 더 가벼운 로컬 CLI 경로입니다. 현재 코드베이스에는 다음이 포함되어 있습니다.

- 설정 가능한 실행 파일 경로
- 설정 가능한 기본 모델
- 논문 단위 후속 대화 맥락 유지
- 현재 논문용 retrieval/context 조합

## Paper Pilot의 출력 형식 설계

몇몇 리더 패널 워크플로우는 자유형 채팅이 아니라 구조화된 출력을 기대합니다.

현재 프롬프트 표면:

- **Research brief**
- **Related paper recommendations**
- **Paper tools**
- **Paper compare**
- **Auto-highlight**
- **Paper Mastery (이해도 점검)**
- **Workspace/chat prompt assembly**

정확한 출력 형태와 가드레일은 [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)에서 확인할 수 있습니다.

## 요구 사항

- **Zotero 7**
- 개발용 **Node.js 20+**
- 의존성/빌드용 **npm**
- OpenDataLoader PDF 추출을 위한 런타임 **Java 11+**
- 다음 중 하나 이상의 로컬 AI CLI:
  - **Codex CLI**
  - **Gemini CLI**

## 개발 빠른 시작

의존성 설치:

```bash
npm install
```

테스트 실행:

```bash
npm test
```

애드온 빌드:

```bash
npm run build
```

OpenDataLoader 패키징 메모:

- `npm run build`는 xpi 패킹 전에 OpenDataLoader JAR를 `addon/chrome/content/vendor/opendataloader/`로 복사합니다
- 빌드된 add-on은 그 JAR를 포함하지만, 실제 실행에는 로컬 Java 런타임이 필요합니다

`npm start`, `npm run build`, `npm run release`는 [`scripts/prepare-opendataloader.mjs`](./scripts/prepare-opendataloader.mjs)를 통해 OpenDataLoader 런타임 JAR를 애드온에 자동 포함합니다.

## GitHub 릴리즈 만들기

릴리즈 배포는 태그 기준으로 동작합니다. 패키지 버전과 태그를 항상 일치시켜야 합니다.

1. `main`에서 `package.json`과 `package-lock.json`을 릴리즈 버전으로 올립니다.
2. 그 버전 변경 커밋을 `main`에 머지합니다.
3. 일치하는 태그를 만들고 푸시합니다. 예: `git tag v0.0.3 && git push origin v0.0.3`
4. Release 워크플로우는 배포 전에 `scripts/check-release-tag-version.mjs`를 실행합니다. ref 이름이 `v${package.json.version}`과 정확히 일치하지 않으면 즉시 실패합니다.

`workflow_dispatch`를 사용할 때도 같은 릴리즈 태그 ref에서 실행해야 합니다. 브랜치 ref에서는 같은 가드에 의해 실패합니다.

## 빌드 결과물

빌드가 성공하면 `build/` 아래에 Zotero 애드온 패키지가 생성됩니다.

대표 결과물:

- `build/paper-pilot.xpi`
- `build/update.json`
- `build/update-beta.json`

## Zotero에 설치하기

1. `npm run build`로 프로젝트를 빌드합니다.
2. Zotero를 엽니다.
3. 생성된 `.xpi`를 Zotero의 애드온 설치 흐름으로 설치합니다.
4. 필요하면 Zotero를 다시 시작합니다.
5. PDF 첨부파일을 열고 **Paper Pilot** 리더 패널이 나타나는지 확인합니다.
6. 논문 질문을 한 번 실행한 뒤 최신 workspace에 `paper.md`, `paper.json`, `paper.txt`가 함께 생성되는지 확인합니다.
7. `metadata.json`에서 `extractionMethod`가 Java 사용 가능 시 `opendataloader-pdf`, 폴백 시 `zotero-attachment-text`인지 확인합니다.

## 첫 실행 체크리스트

`.xpi` 설치 후 가장 빠르게 플러그인을 확인하는 방법은 다음과 같습니다.

1. Zotero 설정에서 로컬 **Codex CLI** 또는 **Gemini CLI** 실행 파일 경로를 설정합니다.
2. Zotero Reader에서 PDF 첨부파일을 엽니다.
3. **Paper Pilot** 패널을 엽니다.
4. **Codex CLI** 또는 **Gemini CLI**를 선택합니다.
5. 현재 논문에 대해 질문합니다.
6. **Research brief** 또는 **Compare** 같은 구조화된 workbench 액션을 실행해 봅니다.

## 설정 관련 메모

현재 설정 UI는 다음 영역으로 나뉩니다.

- **General**
- **Gemini CLI**
- **Codex CLI**
- **Retrieval**
- **Privacy**

중요한 현재 사항:

- 응답 언어는 **English**, **Korean**, **Chinese**로 정규화됩니다.
- 런타임 코드는 엔진, retrieval, workspace, privacy 관련 여러 설정을 이미 읽습니다.
- 구조화 PDF 추출은 번들된 OpenDataLoader JAR를 사용하며, Java 또는 런타임 추출이 불가능하면 Zotero `attachmentText`로 폴백합니다.
- 모든 설정 경로에 대한 실제 런타임 QA는 아직 남아 있습니다.

## 일반적인 사용 흐름

1. Zotero Reader에서 PDF를 엽니다.
2. **Paper Pilot** 패널을 엽니다.
3. **Codex CLI** 또는 **Gemini CLI**를 선택합니다.
4. 논문에 대해 질문합니다.
5. 필요하면 선택 영역 또는 주석 액션으로 다음 프롬프트를 시작합니다.
6. brief, compare, contributions, follow-ups 같은 구조화된 결과를 위해 workbench 버튼을 사용합니다.
7. 필요하면 유용한 결과를 note 또는 collection-linked artifact로 저장합니다.

## 프로젝트 구조

```text
addon/      Zotero 애드온 매니페스트, 로케일, 설정 UI, 정적 자산
src/        리더 UI, 엔진 연동, 컨텍스트, 도구, 워크플로우용 TypeScript 소스
test/       프롬프트 빌더, 파싱, 저장, 워크플로우 로직에 대한 Node 기반 회귀 테스트
docs/       수동 QA 체크리스트, 프롬프트 계약, 보조 제품 문서
scripts/    로컬 Zotero 플러그인 스캐폴드 CLI 엔트리포인트
build/      생성된 애드온 아티팩트
```

주요 소스 영역:

- `src/modules/readerPane.ts` — 메인 리더 패널 UI 및 워크플로우 연결
- `src/modules/codex/` — Codex CLI 실행, 상태, 파싱, 명령 빌드
- `src/modules/gemini/` — Gemini CLI 실행 흐름
- `src/modules/context/` — 논문 컨텍스트 수집 및 워크스페이스 아티팩트 생성
- `src/modules/autoHighlight/` — 하이라이트 추출 워크플로우
- `src/modules/paperTools.ts` — 구조화된 contribution/limitation/follow-up 프롬프트
- `src/modules/researchBrief.ts` — 논문별 compact brief 생성
- `src/modules/relatedRecommendations.ts` — 그룹형 관련 논문 추천
- `src/modules/paperCompare.ts` — 제한된 다중 논문 비교 흐름

## 검증

현재 저장소에는 다음과 같은 핵심 로직에 대한 자동 검증이 포함되어 있습니다.

- 엔진 모드 선택
- Codex 명령 빌드와 셸 동작
- 워크스페이스 아티팩트 생성
- research brief 파싱
- paper tool 파싱
- related-paper recommendation 파싱
- compare 및 artifact 저장 흐름
- auto-highlight 파싱/매칭

로컬 검증에 사용한 핵심 명령:

```bash
npm test
npm run build
```

다만 실제 Zotero 내부 런타임 검증은 여전히 필요합니다. [`docs/manual-qa.md`](./docs/manual-qa.md)를 사용하세요.

## 알려진 제한 사항

- 아직 완전한 프로덕션 준비 상태를 주장하지 않습니다.
- 실제 Zotero 런타임 QA는 명시적으로 남아 있는 작업입니다.

## 로드맵

현재 저장소 상태를 기준으로 한 가까운 우선순위는 다음과 같습니다.

- [`docs/manual-qa.md`](./docs/manual-qa.md)를 기준으로 실제 Zotero 런타임 QA 완료
- [`docs/images/`](./docs/images/README.md) 아래에 스크린샷과 짧은 데모 자산 추가
- 더 다양한 실제 설치/실행 환경에서 검증 확대
- 리더 패널 워크플로우 변화에 맞춰 문서 지속 정리

## 기여하기

기여는 언제든 환영합니다.

설정 방법, 작업 방식, 문서 작성 기준은 [`CONTRIBUTING.md`](./CONTRIBUTING.md)를 참고하세요.

## 라이선스

이 프로젝트는 **AGPL-3.0-or-later** 라이선스를 따릅니다.

## 추가 문서

- [`docs/images/CAPTURE-CHECKLIST.md`](./docs/images/CAPTURE-CHECKLIST.md)
- [`docs/images/README.md`](./docs/images/README.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`docs/manual-qa.md`](./docs/manual-qa.md)
- [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)
