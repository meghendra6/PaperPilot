# Paper Pilot for Zotero 7

> Languages: [English](./README.md) | [한국어](./README.ko.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

**Paper Pilot 可將 Zotero 7 PDF 閱讀器變成 AI 驅動的論文工作台。**

Paper Pilot 是一個面向 Zotero 7 PDF 閱讀器的 AI 閱讀工作台。它直接在 Zotero 中提供以論文為範圍的聊天面板、結構化論文工具、相關論文探索，以及基於本地 CLI 的 AI 執行能力。

![Zotero 7](https://img.shields.io/badge/Zotero-7-cc2936) ![Node 20+](https://img.shields.io/badge/Node-20%2B-339933) ![Java 11+](https://img.shields.io/badge/Java-11%2B-007396) ![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue) ![Engines](https://img.shields.io/badge/Engines-Codex%20CLI%20%7C%20Gemini%20CLI-6f42c1)

目前外掛支援兩種引擎模式：

- **Codex CLI**
- **Gemini CLI**

## 快速總覽

- 直接在 Zotero Reader 中使用 AI 聊天
- 兩種本地引擎模式：**Codex CLI** 與 **Gemini CLI**
- 面向 brief、compare、contributions、limitations、follow-ups 的結構化論文工作台
- 支援相關論文推薦、開啟論文、加入 collection 的流程
- 支援 auto-highlight 與可持久化的論文級會話歷史
- **Paper Mastery** — 多輪蘇格拉底式理解度檢查，並產出 Markdown 學習報告
- 已具備自動化本地驗證，但真實 Zotero 執行時 QA 仍待完成

## 截圖與示範

倉庫中**尚未加入截圖或示範短片**。

下一步建議補充的視覺內容：

- 顯示 AI 側邊欄的 Zotero 閱讀器畫面
- 結構化的 **Research brief** 卡片
- 分組呈現的 **Related papers** 推薦畫面
- **Compare** 工作流與儲存 artifact 的流程

如果之後要補充 UI 視覺資料，建議使用 `docs/images/` 目錄，並在本節加入簡短說明連結。

## 目前狀態

Paper Pilot 仍在積極開發中。

目前已具備：

- 核心邏輯已有自動化測試覆蓋
- 可以產生 Zotero 外掛的正式建置產物
- 閱讀器面板中的聊天、論文工具、推薦與高亮工作流已經存在

在可被視為完全可用於正式環境之前，仍需要：

- 在真實 Zotero 7 執行環境中完成端對端手動 QA
- 在更多真實使用者環境中驗證安裝與執行情況

目前的執行時檢查清單請見 [`docs/manual-qa.md`](./docs/manual-qa.md)。

## 外掛可以做什麼

### 1. 閱讀器內 AI 聊天

- 在 Zotero 閱讀器／條目面板中加入 AI 面板
- 將對話限制在目前論文範圍內
- 支援依論文切換 Codex CLI 與 Gemini CLI
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

### 4. 相關論文探索

Paper Pilot 可以產生分組的相關論文推薦，並協助你：

- 依類別查看相近論文
- 開啟推薦論文
- 將推薦論文加入 Zotero collection
- 將推薦論文作為有邊界的比較輸入集合

### 5. 自動高亮工作流

外掛包含 auto-highlight 流程，用於從目前論文中擷取高信心的關鍵段落，並將其回饋到閱讀器工作流中。

### 6. Paper Mastery（理解度檢查）

閱讀器面板中包含 **Paper Mastery** 工作流，用於對目前論文進行多輪蘇格拉底式理解度檢查：

- AI 每次產生一個聚焦論文核心貢獻、方法論或關鍵假設的開放式問題。
- 使用者以自由文字回答，AI 會對每個回答進行評估，並記錄對應主題是否已被理解。
- 會話結束時，系統會產生一份 Markdown 學習報告，包含強項、需加強之處、主要誤解以及建議重讀的內容。

Mastery prompt 會強制問題／評估回應為嚴格 JSON（禁止前置推理或開場白），將使用者回答包覆在 `<user_answer>` 標籤內，並容許 JSON 周圍出現 markdown fence 作為容錯。解析器能辨識字串與跳脫字元，因此引號內的 `}` 不會截斷有效回應。

### 7. 面向 Codex 的本地工作區產物

當你在 **Codex CLI** 模式下提問時，Paper Pilot 會為目前論文建立一個工作區，讓 CLI 在回答前先讀取本地論文脈絡。

典型產物包括：

- `CONTEXT_INDEX.md`
- `paper.md`
- `paper.json`
- `paper.txt`
- `selection.json`
- `recent-turns.json`
- `metadata.json`
- `annotations.json`
- `figures/`

`paper.md` 是結構化 Markdown 視圖，`paper.json` 記錄結構化 PDF 元素與擷取後設資料，`paper.txt` 作為相容／純文字退路保留。當 Java 可用時，`paper.md` 和 `paper.json` 由內建的 OpenDataLoader 執行時產生；若結構化擷取不可用，Paper Pilot 會退回到 Zotero `attachmentText`，並在 `metadata.json` 中記錄此情況。

這讓 Codex 可以根據目前論文、選取內容與最近對話歷史來回答問題。

## 功能總覽

| 領域       | 目前支援                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| 閱讀器聊天 | Zotero Reader 內以論文為範圍的 AI 聊天                                                       |
| 引擎       | Codex CLI、Gemini CLI                                                                        |
| 論文工作台 | Research brief、compare、contributions、limitations、follow-ups                              |
| 探索       | 分組相關論文推薦                                                                             |
| 儲存       | 將最新結果儲存到 note，將 workbench artifact 儲存到 collection                               |
| 脈絡約束   | workspace artifact、基於 OpenDataLoader 的結構化 PDF 脈絡、retrieval context、最近對話連續性 |
| 高亮       | 面向關鍵段落的 auto-highlight 工作流                                                         |
| 理解度檢查 | Paper Mastery 多輪理解度檢查與 Markdown 學習報告                                             |

## 引擎模式

| 模式         | 適用場景             | 目前優勢                                                                  |
| ------------ | -------------------- | ------------------------------------------------------------------------- |
| `Codex CLI`  | 面向工作區的論文分析 | 本地工作區產物、可恢復執行、模型／沙箱／批准控制、可選網頁搜尋            |
| `Gemini CLI` | 輕量級本地論文問答   | 更簡單的可執行檔／模型設定、論文級脈絡連續性、本地 retrieval/context 組裝 |

### Codex CLI 模式

Codex 模式更偏向工作區驅動。當前程式碼庫已包含：

- 可執行檔發現與驗證
- 登入／狀態檢查
- 工作區可寫性檢查
- `gpt-5.5` 模型選擇，以及 `low`、`medium`、`high`、`xhigh` reasoning effort 選項
- sandbox 與 approval 設定
- 可選網頁搜尋切換
- 與目前論文綁定的可恢復追問執行

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
- **Related paper recommendations**
- **Paper tools**
- **Paper compare**
- **Auto-highlight**
- **Paper Mastery（理解度檢查）**
- **Workspace/chat prompt assembly**

精確的輸出形狀與約束可見 [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)。

## 環境需求

- **Zotero 7**
- 開發用 **Node.js 20+**
- 用於依賴與建置的 **npm**
- 執行時 **Java 11+**（用於 OpenDataLoader 結構化 PDF 擷取）
- 至少安裝一個本地 AI CLI：
  - **Codex CLI**
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
3. 建立並推送相符的標籤，例如 `git tag v0.1.0 && git push origin v0.1.0`。
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

1. 在 Zotero 設定中配置本地 **Codex CLI** 或 **Gemini CLI** 可執行檔路徑。
2. 在 Zotero Reader 中開啟一個 PDF 附件。
3. 開啟 **Paper Pilot** 面板。
4. 選擇 **Codex CLI** 或 **Gemini CLI**。
5. 針對目前論文提出一個問題。
6. 試用一個結構化工作台操作，例如 **Research brief** 或 **Compare**。

## 設定說明

目前設定介面包含以下區塊：

- **General**
- **Gemini CLI**
- **Codex CLI**
- **Retrieval**
- **Privacy**

目前需要注意：

- 回應語言會被正規化為 **English**、**Korean** 或 **Chinese**
- 執行時程式碼已經讀取了許多與引擎、retrieval、workspace、privacy 相關的設定
- 結構化 PDF 擷取使用內建的 OpenDataLoader JAR；Java 或執行時擷取不可用時會退回到 Zotero `attachmentText`
- 所有設定路徑在真實執行環境中的 QA 仍是剩餘工作的一部分

## 典型使用流程

1. 在 Zotero Reader 中開啟 PDF。
2. 開啟 **Paper Pilot** 面板。
3. 選擇 **Codex CLI** 或 **Gemini CLI**。
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
scripts/    本地 Zotero 外掛腳手架 CLI 入口
build/      產生的外掛建置產物
```

關鍵原始碼區域：

- `src/modules/readerPane.ts` — 主閱讀器面板 UI 與工作流連接
- `src/modules/codex/` — Codex CLI 執行、狀態、解析與命令建構
- `src/modules/gemini/` — Gemini CLI 執行流程
- `src/modules/context/` — 論文脈絡收集與工作區產物生成
- `src/modules/autoHighlight/` — 高亮擷取工作流
- `src/modules/paperTools.ts` — 結構化 contribution/limitation/follow-up prompt
- `src/modules/researchBrief.ts` — 面向單篇論文的精簡 brief 生成
- `src/modules/relatedRecommendations.ts` — 分組相關論文推薦
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

本地驗證使用的核心命令：

```bash
npm test
npm run build
```

但 Zotero 內部的真實執行時驗證仍然必須完成。請使用 [`docs/manual-qa.md`](./docs/manual-qa.md)。

## 已知限制

- 專案目前尚未宣稱完全達到正式可用狀態。
- 真實 Zotero 執行時 QA 仍是明確待完成項。

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
- [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)
