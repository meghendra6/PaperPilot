# Paper Pilot for Zotero 7-10

> Languages: [English](./README.md) | [한국어](./README.ko.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

**Paper Pilot 可將 Zotero 7-10 PDF 閱讀器變成 AI 驅動的論文工作台。**

Paper Pilot 是一個面向 Zotero 7-10 PDF 閱讀器的 AI 閱讀工作台。它直接在 Zotero 中提供以論文為範圍的聊天面板、結構化論文工具、由代理主導並驗證出版狀態的先行研究探索，以及基於本地 CLI 的 AI 執行能力。

![Zotero 7-10](https://img.shields.io/badge/Zotero-7--10-cc2936) ![Node 20+](https://img.shields.io/badge/Node-20%2B-339933) ![Java 11+](https://img.shields.io/badge/Java-11%2B-007396) ![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue) ![Engines](https://img.shields.io/badge/Engines-Codex%20CLI%20%7C%20Claude%20Code%20%7C%20Gemini%20CLI-6f42c1)

## 快速總覽

- 直接在 Zotero Reader 中使用 AI 聊天
- 三種本地引擎模式：**Codex CLI**、**Claude Code** 與 **Gemini CLI**
- 面向 brief、compare、contributions、limitations、follow-ups 的結構化論文工作台
- 透過 **OpenDataLoader PDF** 擷取結構化 PDF 工作區
- 無需使用者設定會議清單，以官方出版證據和三個結果分區探索先行研究
- **Critical Read** — 讀者先判斷的七步批判性閱讀流程與最終報告
- 支援 auto-highlight 與可持久化的論文級會話歷史
- **Paper Mastery** — 多輪蘇格拉底式理解度檢查，並產出 Markdown 學習報告
- 已記錄自動化驗證及 Zotero 9、10 執行時冒煙測試；更廣泛的 Zotero 7-10 與跨引擎矩陣仍屬手動 QA

## 整合式 Research Workspace

Research Workspace 已內建於 Paper Pilot，並共用同一套本機引擎選擇、論文擷取與執行生命週期。無論選取零篇、一篇或多篇項目，持久的非模態專案視窗都可繼續使用，並提供篩選、claim–evidence ledger、比較、稽核、mastery、引用工作流程、引用/參考文獻健康檢查、矛盾/缺口審閱、專案級匯出、本機 Living Review 變更收件匣，以及五種可編輯的專案範本。專案範本 preset 只會強調建議的 capability，不會自動執行分析或隱藏其他 capability；匯出會保留不可變的範本快照與目前 assumptions。Citation & Reference Health 會根據目前儲存的引用、方法學與可重現性 artifact、本機 Zotero 更正/撤稿中繼資料訊號，以及可選的有界草稿摘錄建立本機檢查清單，且不會產生彙總 truth score。Living Review 僅檢查 Zotero 附件與註解中繼資料，不讀取正文，也不呼叫模型或網路服務。安全的 Zotero collection/tag 同步只會在完整 preview 與綁定該 preview 的 approval token 之後，向既有 collection 和既有 tag 執行單向新增；它會在 transaction 前寫入獨立的 revisioned receipt，並在 Zotero transaction 不可用時 fail closed。Undo 只移除 receipt 所擁有的新增，不會建立或刪除 Zotero item、collection 或 tag，也不會寫入 bibliographic field、PDF、note、attachment 或 annotation。只需安裝一個 Paper Pilot XPI；不再提供 companion 外掛或 Research Monitor。

## 截圖與示範

倉庫中**尚未加入截圖或示範短片**。

下一步建議補充的視覺內容：

- 顯示 AI 側邊欄的 Zotero 閱讀器畫面
- 結構化的 **Research brief** 卡片
- 三分區的**驗證型先行研究**結果
- 七步 **Critical Read** 工作流程
- **Compare** 工作流與儲存 artifact 的流程

如果之後要補充 UI 視覺資料，建議使用 `docs/images/` 目錄，並在本節加入簡短說明連結。

## 目前狀態

Paper Pilot 仍在積極開發中。

目前已具備：

- 核心邏輯已有自動化測試覆蓋
- 可以產生 Zotero 外掛的正式建置產物
- 閱讀器面板中的聊天、論文工具、推薦與高亮工作流已經存在

在可被視為完全可用於正式環境之前，仍需要：

- 在真實 Zotero 7-10 執行環境中完成端對端手動 QA
- 在更多真實使用者環境中驗證安裝與執行情況

目前的執行時檢查清單請見 [`docs/manual-qa.md`](./docs/manual-qa.md)。

## 外掛可以做什麼

### 1. 閱讀器內 AI 聊天

- 在 Zotero 閱讀器／條目面板中加入 AI 面板
- 將對話限制在目前論文範圍內
- 支援依論文切換 Codex CLI、Claude Code 與 Gemini CLI
- 在同一篇論文／會話內保留追問脈絡
- 支援透過 **Past sessions** 重新開啟、重新命名、刪除，或清空目前論文的已儲存會話
- **New session** 會保留目前會話，並為同一篇論文開啟一個空白新草稿

### 2. 閱讀器中的論文脈絡操作

從 PDF 選取文字或註解可以觸發以下 AI 工作流：

- **Ask AI**
- **Explain**
- **Summarize**
- **Translate**

### 3. 論文工作台工具

閱讀器面板中包含針對目前論文的結構化工作流：

- **Research brief**
- **Compare**
- **Contributions**
- **Limitations**
- **Follow-ups**
- **Save latest to note**
- **Save for collection**
- **Clear cards**

這些工作流的目標是產生適合閱讀器面板顯示的緊湊結構化結果，而不是冗長的一般聊天回覆。

### 4. 代理主導的驗證型先行研究探索

點選 **Find verified prior work**，只在需要時填寫研究問題。當前代理會自行推斷主要領域、相鄰領域、頂級會議和查詢組合，使用者無需選擇會議。結果分為三個分區：

- **Verified main-conference papers** — 以論文級官方來源高信心確認屬於領先會議 main track 的論文
- **Other peer-reviewed work** — 期刊、workshop、Findings、其他 track，或 main-track 狀態未確定的已發表工作
- **Frontier / novelty radar** — 用於快速檢查最新趨勢或想法重合的近期 preprint 與 submission

搜尋採用標準化學術來源和可重現的工作區產物，但會議判斷是開放式的，並非固定 allowlist。ACL、EMNLP、CVPR、NeurIPS、ICLR、ISCA、MICRO、HPCA、ASPLOS、USENIX 系列以及其他領域的適當會議，都可由代理依證據選擇。你可以開啟官方證據和公開評審、請求 review insight、連同證據後設資料加入 collection，或將完整三分區結果儲存為 Zotero note。

### Critical Read

**Critical Read** 依序引導七步閱讀：瀏覽摘要／圖／表、找出核心研究問題、調查先行研究、評估方法、僅根據結果形成獨立結論、與作者結論對照，以及考慮替代解釋。獨立判斷步驟要求讀者先輸入；修改早期步驟會使相依的後續步驟和報告失效。最終報告區分讀者觀察、論文主張、代理推斷和外部探索證據。

### 5. 自動高亮工作流

外掛包含 auto-highlight 流程，用於從目前論文中擷取高信心的關鍵段落，並將其回饋到閱讀器工作流中。

### 6. Paper Mastery（理解度檢查）

閱讀器面板中包含 **Paper Mastery** 工作流，用於對目前論文進行多輪蘇格拉底式理解度檢查：

- AI 每次產生一個聚焦論文核心貢獻、方法論或關鍵假設的開放式問題。
- 使用者以自由文字回答，AI 會對每個回答進行評估，並記錄對應主題是否已被理解。
- 會話結束時，系統會產生一份 Markdown 學習報告，包含強項、需加強之處、主要誤解以及建議重讀的內容。

Mastery prompt 會強制問題／評估回應為嚴格 JSON（禁止前置推理或開場白），將使用者回答包覆在 `<user_answer>` 標籤內，並容許 JSON 周圍出現 markdown fence 作為容錯。解析器能辨識字串與跳脫字元，因此引號內的 `}` 不會截斷有效回應。

### 7. 面向 CLI 引擎的本地工作區產物

當你在 **Codex CLI**、**Claude Code** 或 **Gemini CLI** 模式下提問時，Paper Pilot 會為目前論文建立一個工作區，讓 CLI 在回答前先讀取本地論文脈絡。

所有引擎都會寫入的產物：

- `paper.md`
- `paper.json`
- `paper.txt`
- `selection.json`
- `recent-turns.json`
- `metadata.json`
- `annotations.json`

所有引擎都會額外寫入 `CONTEXT_INDEX.md`（檔案閱讀順序索引）。探索任務還會準備 `discovery-request.json`、`discovery-plan.json`、`discovery-candidates.json` 與 `discovery-evidence.json`；Codex CLI 另建 `figures/` 目錄。

`paper.md` 是結構化 Markdown 視圖，`paper.json` 記錄結構化 PDF 元素與擷取後設資料，`paper.txt` 作為相容／純文字退路保留。當 Java 可用時，`paper.md` 和 `paper.json` 由內建的 OpenDataLoader 執行時產生；若結構化擷取不可用，Paper Pilot 會退回到 Zotero `attachmentText`，並在 `metadata.json` 中記錄此情況。

這讓所選 CLI 可以根據目前論文、選取內容與最近對話歷史來回答問題。

## 功能總覽

| 領域       | 目前支援                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| 閱讀器聊天 | Zotero Reader 內以論文為範圍的 AI 聊天                                                       |
| 引擎       | Codex CLI、Claude Code、Gemini CLI                                                           |
| 論文工作台 | Research brief、compare、contributions、limitations、follow-ups                              |
| 探索       | 代理推斷領域／會議，以官方證據驗證並分成三個結果分區                                         |
| 批判性閱讀 | 讀者優先的七個步驟、相依失效處理與區分來源的最終報告                                         |
| 儲存       | 將最新結果儲存到 note，將 workbench artifact 儲存到 collection                               |
| 脈絡約束   | workspace artifact、基於 OpenDataLoader 的結構化 PDF 脈絡、retrieval context、最近對話連續性 |
| 高亮       | 面向關鍵段落的 auto-highlight 工作流                                                         |
| 理解度檢查 | Paper Mastery 多輪理解度檢查與 Markdown 學習報告                                             |

## 引擎模式

| 模式          | 適用場景             | 目前優勢                                                                  |
| ------------- | -------------------- | ------------------------------------------------------------------------- |
| `Codex CLI`   | 面向工作區的論文分析 | 本地工作區產物、可恢復執行、模型／沙箱／批准控制、可選網頁搜尋            |
| `Claude Code` | 面向工作區的論文問答 | 本地工作區產物、模型／權限模式控制、論文級脈絡連續性                      |
| `Gemini CLI`  | 輕量級本地論文問答   | 更簡單的可執行檔／模型設定、論文級脈絡連續性、本地 retrieval/context 組裝 |

### Codex CLI 模式

Codex 模式更偏向工作區驅動。當前程式碼庫已包含：

- 可執行檔發現與驗證
- 登入／狀態檢查
- 工作區可寫性檢查
- 目前建議 Codex 模型選擇（預設 `gpt-6-astra`，另含 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`），reasoning effort 依模型提供（支援時可達 `max`/`ultra`）
- sandbox 與 approval 設定
- 可選網頁搜尋切換
- 與目前論文綁定的可恢復追問執行

### Claude Code 模式

Claude Code 模式使用本地 `claude` CLI 的 print 模式，並基於閱讀器聊天和工作台流程使用的同一論文工作區產物來回答。當前程式碼庫已包含：

- 可設定的可執行檔路徑
- 可設定的預設模型
- 可設定的 permission mode
- 論文級追問脈絡連續性
- 面向目前論文的 retrieval/context 組裝

### Gemini CLI 模式

Gemini 模式是較輕量的本地 CLI 路徑。當前程式碼庫已包含：

- 可設定的可執行檔路徑
- 可設定的預設模型
- 論文級追問脈絡連續性
- 面向目前論文的 retrieval/context 組裝

## Paper Pilot 如何約束 AI 輸出

部分閱讀器面板工作流需要的是結構化輸出，而不是自由聊天文字。

目前的 prompt surface 包括：

- **Research brief**
- **Agent-led verified research discovery**
- **Public review insight**
- **Critical Read**
- **Paper tools**
- **Paper compare**
- **Auto-highlight**
- **Paper Mastery（理解度檢查）**
- **Workspace/chat prompt assembly**

在這些 surface 中，Paper Pilot 會提示模型優先使用目前論文工作區中的全文內容。
中繼資料與摘要只作為定向或回退脈絡；若只能依摘要回答且影響信心，輸出應明確
說明此限制。Prompt 也要求區分論文直接主張、面向讀者的解讀，以及外部/網頁發
現；可用時標出章節、頁碼、圖或表。

精確的輸出形狀與約束可見 [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)。

## 環境需求

- **Zotero 7、8、9 或 10**
- 開發用 **Node.js 20+**
- 用於依賴與建置的 **npm**
- 執行時 **Java 11+**（用於 OpenDataLoader 結構化 PDF 擷取）
- 至少安裝一個本地 AI CLI：
  - **Codex CLI**
  - **Claude Code**
  - **Gemini CLI**

## 開發快速開始

安裝依賴：

```bash
npm install
```

執行測試：

```bash
npm test
```

建置外掛：

```bash
npm run build
```

OpenDataLoader 打包說明：

- `npm run build` 會在打包 xpi 之前，將 OpenDataLoader JAR 複製到 `addon/chrome/content/vendor/opendataloader/`
- 建置產物會包含該 JAR，但執行時仍需要本地 Java 執行環境

`npm start`、`npm run build` 與 `npm run release` 會透過 [`scripts/prepare-opendataloader.mjs`](./scripts/prepare-opendataloader.mjs) 自動將 OpenDataLoader 執行時 JAR 內建進外掛。

## 建立 GitHub 發布

發布流程以標籤為準。請務必讓套件版本與標籤保持一致：

1. 在 `main` 上把 `package.json` 和 `package-lock.json` 更新到目標發布版本。
2. 將這次版本更新合併到 `main`。
3. 建立並推送相符的標籤，例如 `git tag "v<version>" && git push origin "v<version>"`。
4. Release 工作流程現在會在發布前執行 `scripts/check-release-tag-version.mjs`。如果 ref 名稱與 `v${package.json.version}` 不完全一致，會立即失敗。

如果使用 `workflow_dispatch`，也必須從相符的發布標籤 ref 執行。分支 ref 會被同一個檢查拒絕。

## 建置輸出

建置成功後，會在 `build/` 中產生 Zotero 外掛套件。

常見輸出包括：

- `build/paper-pilot.xpi`
- `build/update.json`
- `build/update-beta.json`

## 在 Zotero 中安裝

1. 執行 `npm run build` 建置專案。
2. 開啟 Zotero。
3. 依照 Zotero 的外掛安裝流程安裝產生的 `.xpi`。
4. 如有需要，重新啟動 Zotero。
5. 開啟一個 PDF 附件，確認 **Paper Pilot** 閱讀器面板已出現。
6. 對目前論文提問一次，確認最新的 workspace 內同時產出了 `paper.md`、`paper.json` 與 `paper.txt`。
7. 檢查 `metadata.json`：Java 可用時 `extractionMethod` 應為 `opendataloader-pdf`，使用退路時應為 `zotero-attachment-text`。

## 首次執行檢查清單

安裝 `.xpi` 後，可以用以下最短路徑驗證外掛是否正常工作：

1. 在 Zotero 設定中配置本地 **Codex CLI**、**Claude Code** 或 **Gemini CLI** 可執行檔路徑。
2. 在 Zotero Reader 中開啟一個 PDF 附件。
3. 開啟 **Paper Pilot** 面板。
4. 選擇 **Codex CLI**、**Claude Code** 或 **Gemini CLI**。
5. 針對目前論文提出一個問題。
6. 試用一個結構化工作台操作，例如 **Research brief** 或 **Compare**。

## 設定說明

目前設定介面包含以下區塊：

- **General**
- **Claude Code**
- **Gemini CLI**
- **Codex CLI**
- **Retrieval**
- **Privacy**

目前需要注意：

- 外掛介面目前僅提供英文；翻譯版 README 描述的是同一套英文介面。
- 回應語言會被正規化為 **English**、**Korean** 或 **Chinese**
- 回應語言只會變更模型產生的回答與 artifact，不會變更介面標籤
- 執行時程式碼已經讀取了許多與引擎、retrieval、workspace、privacy 相關的設定
- 結構化 PDF 擷取使用內建的 OpenDataLoader JAR；Java 或執行時擷取不可用時會退回到 Zotero `attachmentText`
- 所有設定路徑在真實執行環境中的 QA 仍是剩餘工作的一部分

## 典型使用流程

1. 在 Zotero Reader 中開啟 PDF。
2. 開啟 **Paper Pilot** 面板。
3. 選擇 **Codex CLI**、**Claude Code** 或 **Gemini CLI**。
4. 針對論文提問。
5. 如有需要，可透過選取文字或註解操作產生下一條 prompt。
6. 使用工作台按鈕產生 brief、compare、contributions、follow-ups 等結構化結果。
7. 在需要時將有價值的結果儲存到 note 或 collection-linked artifact 中。

## 專案結構

```text
addon/      Zotero 外掛清單、語系資源、設定介面、靜態資源
src/        閱讀器 UI、引擎整合、脈絡、工具與工作流的 TypeScript 原始碼
test/       針對 prompt 建構、解析、儲存與工作流邏輯的 Node 回歸測試
docs/       手動 QA 清單、prompt contract 與補充產品文件
scripts/    建置/發布 CLI、OpenDataLoader 準備、發布標籤檢查與環境診斷
build/      產生的外掛建置產物
```

關鍵原始碼區域：

- `src/modules/readerPane.ts` — 主閱讀器面板 UI 與工作流連接
- `src/modules/codex/` — Codex CLI 執行、狀態、解析與命令建構
- `src/modules/claude/` — Claude Code 執行流程
- `src/modules/gemini/` — Gemini CLI 執行流程
- `src/modules/context/` — 論文脈絡收集與工作區產物生成
- `src/modules/autoHighlight/` — 高亮擷取工作流
- `src/modules/paperTools.ts` — 結構化 contribution/limitation/follow-up prompt
- `src/modules/researchBrief.ts` — 面向單篇論文的精簡 brief 生成
- `src/modules/discovery/` — 代理主導的搜尋規劃、provider 擷取、證據驗證、解析與排序
- `src/modules/relatedRecommendations.ts` — 驗證型探索工作流程與 Zotero collection 整合
- `src/modules/criticalRead/` — 讀者優先的七步分析與報告工作流程
- `src/modules/paperCompare.ts` — 有邊界的多論文比較流程

## 驗證

目前倉庫已包含對以下核心邏輯的自動化驗證：

- 引擎模式選擇
- Codex 命令建構與 shell 行為
- 工作區產物生成
- research brief 解析
- paper tool 解析
- related-paper recommendation 解析
- compare 與 artifact 儲存流程
- auto-highlight 解析／匹配
- discovery、Critical Read、會話持久化與 Research Workspace 合約

本地驗證使用的核心命令：

```bash
npm test
npm run build
```

但 Zotero 內部的真實執行時驗證仍然必須完成。請使用 [`docs/manual-qa.md`](./docs/manual-qa.md)。

## 已知限制

- 專案目前尚未宣稱完全達到正式可用狀態。
- 已在 `docs/manual-qa.md` 記錄聚焦的 Zotero 9、10 執行時 QA；更廣泛的相容性與跨引擎矩陣仍屬手動 QA。

## 路線圖

根據目前倉庫狀態，近期優先事項包括：

- 依照 [`docs/manual-qa.md`](./docs/manual-qa.md) 完成真實 Zotero 執行時 QA
- 在 [`docs/images/`](./docs/images/README.md) 下補充截圖與簡短示範資產
- 在更多真實安裝／執行環境中擴大驗證範圍
- 持續讓文件與閱讀器面板工作流保持一致

## 參與貢獻

歡迎貢獻。

關於環境準備、工作方式與文件約定，請參見 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 授權

本專案採用 **AGPL-3.0-or-later** 授權。

## 其他文件

- [`docs/images/CAPTURE-CHECKLIST.md`](./docs/images/CAPTURE-CHECKLIST.md)
- [`docs/images/README.md`](./docs/images/README.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`docs/manual-qa.md`](./docs/manual-qa.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)
