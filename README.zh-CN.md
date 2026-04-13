# Paper Pilot for Zotero 7

> Languages: [English](./README.md) | [한국어](./README.ko.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

**Paper Pilot 可将 Zotero 7 PDF 阅读器变成 AI 驱动的论文工作台。**

Paper Pilot 是一个面向 Zotero 7 PDF 阅读器的 AI 阅读工作台。它直接在 Zotero 中提供按论文作用域组织的聊天面板、结构化论文工具、相关文章发现，以及基于本地 CLI 的 AI 执行能力。

![Zotero 7](https://img.shields.io/badge/Zotero-7-cc2936) ![Node 20+](https://img.shields.io/badge/Node-20%2B-339933) ![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue) ![Engines](https://img.shields.io/badge/Engines-Codex%20CLI%20%7C%20Gemini%20CLI-6f42c1)

## 快速概览

- 直接在 Zotero Reader 中使用 AI 聊天
- 两种本地引擎模式：**Codex CLI** 与 **Gemini CLI**
- 面向 brief、compare、contributions、limitations、follow-ups 的结构化论文工作台
- 支持相关文章推荐、打开论文、加入 collection 的流程
- 支持 auto-highlight 与可持久化的论文级会话历史
- 已具备自动化本地验证，但真实 Zotero 运行时 QA 仍待完成

## 截图与演示

仓库中**尚未加入截图或演示短片**。

下一步建议补充的视觉内容：

- 显示 AI 侧边栏的 Zotero 阅读器界面
- 结构化的 **Research brief** 卡片
- 分组展示的 **Related papers** 推荐界面
- **Compare** 工作流与保存 artifact 的流程

如果后续要补充 UI 视觉资料，推荐采用 `docs/images/` 目录，并在本节使用简短说明链接。

## 当前状态

Paper Pilot 仍在积极开发中。

已经具备的部分：

- 核心逻辑已有自动化测试覆盖
- 可以生成 Zotero 插件的生产构建产物
- 阅读器面板中的聊天、论文工具、推荐与高亮工作流已经存在

在被视为完全可用于生产之前，仍需要：

- 在真实 Zotero 7 运行环境中完成端到端手动 QA
- 在更多真实用户环境中验证安装与运行情况

当前运行时检查清单见 [`docs/manual-qa.md`](./docs/manual-qa.md)。

## 插件可以做什么

### 1. 阅读器内 AI 聊天

- 在 Zotero 阅读器/条目面板中添加 AI 面板
- 将对话限定在当前论文范围内
- 支持按论文切换 Codex CLI 与 Gemini CLI
- 在同一论文/会话内保留追问上下文
- 支持通过 **Past sessions** 重新打开、重命名、删除，或清空当前论文的已保存会话
- **New session** 会保留当前会话，并为同一篇论文开启一个空白新草稿

### 2. 阅读器中的论文上下文操作

从 PDF 选中文本或批注可以触发以下 AI 工作流：

- **Ask AI**
- **Explain**
- **Summarize**
- **Translate**

### 3. 论文工作台工具

阅读器面板中包含针对当前论文的结构化工作流：

- **Research brief**
- **Compare**
- **Contributions**
- **Limitations**
- **Follow-ups**
- **Save latest to note**
- **Save for collection**
- **Clear cards**

这些工作流的目标是生成适合阅读器面板展示的紧凑结构化结果，而不是冗长的通用聊天回复。

### 4. 相关文章发现

Paper Pilot 可以生成分组的相关文章推荐，并帮助你：

- 按类别查看相近论文
- 打开推荐论文
- 将推荐论文加入 Zotero collection
- 将推荐论文作为有边界的比较输入集合

### 5. 自动高亮工作流

插件包含 auto-highlight 流程，用于从当前论文中提取高置信度关键段落，并将其返回到阅读器工作流中。

### 6. 面向 Codex 的本地工作区工件

当你在 **Codex CLI** 模式下提问时，Paper Pilot 会为当前论文创建一个工作区，让 CLI 在回答前先读取本地论文上下文。

典型工件包括：

- `CONTEXT_INDEX.md`
- `paper.txt`
- `selection.json`
- `recent-turns.json`
- `metadata.json`
- `annotations.json`
- `figures/`

这样 Codex 就能基于当前论文、选中文本和最近对话历史来回答问题。

## 功能总览

| 领域       | 当前支持                                                        |
| ---------- | --------------------------------------------------------------- |
| 阅读器聊天 | Zotero Reader 内按论文组织的 AI 聊天                            |
| 引擎       | Codex CLI、Gemini CLI                                           |
| 论文工作台 | Research brief、compare、contributions、limitations、follow-ups |
| 发现       | 分组相关文章推荐                                                |
| 保存       | 将最新结果保存到 note，将 workbench artifact 保存到 collection  |
| 上下文约束 | workspace artifact、retrieval context、最近对话连续性           |
| 高亮       | 面向关键段落的 auto-highlight 工作流                            |

## 引擎模式

| 模式         | 适用场景             | 当前优势                                                                     |
| ------------ | -------------------- | ---------------------------------------------------------------------------- |
| `Codex CLI`  | 面向工作区的论文分析 | 本地工作区工件、可恢复执行、模型/沙箱/批准控制、可选网页搜索                 |
| `Gemini CLI` | 轻量级本地论文问答   | 更简单的可执行文件/模型设置、论文级上下文连续性、本地 retrieval/context 组装 |

### Codex CLI 模式

Codex 模式更偏向工作区驱动。当前代码库已经包含：

- 可执行文件发现与校验
- 登录/状态检查
- 工作区可写性检查
- 模型选择与模型历史
- reasoning effort 支持
- sandbox 与 approval 设置
- 可选网页搜索开关
- 与当前论文关联的可恢复追问运行

### Gemini CLI 模式

Gemini 模式是更轻量的本地 CLI 路径。当前代码库已经包含：

- 可配置的可执行文件路径
- 可配置的默认模型
- 论文级追问上下文连续性
- 面向当前论文的 retrieval/context 组装

## Paper Pilot 如何约束 AI 输出

部分阅读器面板工作流期望的是结构化输出，而不是自由聊天文本。

当前的 prompt surface 包括：

- **Research brief**
- **Related paper recommendations**
- **Paper tools**
- **Paper compare**
- **Auto-highlight**
- **Workspace/chat prompt assembly**

精确的输出形状与约束可见 [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)。

## 环境要求

- **Zotero 7**
- 开发用 **Node.js 20+**
- 用于依赖与构建的 **npm**
- 至少安装一个本地 AI CLI：
  - **Codex CLI**
  - **Gemini CLI**

## 开发快速开始

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

构建插件：

```bash
npm run build
```

## 构建输出

构建成功后，会在 `build/` 中生成 Zotero 插件包。

常见输出包括：

- `build/paper-pilot.xpi`
- `build/update.json`
- `build/update-beta.json`

## 在 Zotero 中安装

1. 运行 `npm run build` 构建项目。
2. 打开 Zotero。
3. 按照 Zotero 的插件安装流程安装生成的 `.xpi`。
4. 如有需要，重启 Zotero。
5. 打开一个 PDF 附件，确认 **Paper Pilot** 阅读器面板已出现。

## 首次运行检查清单

安装 `.xpi` 后，可按以下最短路径验证插件是否正常工作：

1. 在 Zotero 设置中配置本地 **Codex CLI** 或 **Gemini CLI** 可执行文件路径。
2. 在 Zotero Reader 中打开一个 PDF 附件。
3. 打开 **Paper Pilot** 面板。
4. 选择 **Codex CLI** 或 **Gemini CLI**。
5. 针对当前论文提出一个问题。
6. 试用一个结构化工作台操作，例如 **Research brief** 或 **Compare**。

## 配置说明

当前设置界面包含以下分区：

- **General**
- **Gemini CLI**
- **Codex CLI**
- **Retrieval**
- **Privacy**

当前需要注意的点：

- 响应语言会被规范化为 **English**、**Korean** 或 **Chinese**
- 运行时代码已经读取了许多与引擎、retrieval、workspace、privacy 相关的设置
- 所有设置路径在真实运行环境中的 QA 仍是剩余工作的一部分

## 典型使用流程

1. 在 Zotero Reader 中打开 PDF。
2. 打开 **Paper Pilot** 面板。
3. 选择 **Codex CLI** 或 **Gemini CLI**。
4. 针对论文提问。
5. 如有需要，可通过选中文本或批注操作生成下一条 prompt。
6. 使用工作台按钮生成 brief、compare、contributions、follow-ups 等结构化结果。
7. 在需要时将有价值的结果保存到 note 或 collection-linked artifact 中。

## 项目结构

```text
addon/      Zotero 插件清单、语言资源、设置界面、静态资源
src/        阅读器 UI、引擎集成、上下文、工具与工作流的 TypeScript 源码
test/       针对 prompt 构造、解析、存储与工作流逻辑的 Node 回归测试
docs/       手动 QA 清单、prompt contract 与补充产品文档
scripts/    本地 Zotero 插件脚手架 CLI 入口
build/      生成的插件构建产物
```

关键源码区域：

- `src/modules/readerPane.ts` — 主阅读器面板 UI 与工作流连接
- `src/modules/codex/` — Codex CLI 执行、状态、解析与命令构建
- `src/modules/gemini/` — Gemini CLI 执行流程
- `src/modules/context/` — 论文上下文收集与工作区工件生成
- `src/modules/autoHighlight/` — 高亮提取工作流
- `src/modules/paperTools.ts` — 结构化 contribution/limitation/follow-up prompt
- `src/modules/researchBrief.ts` — 面向单篇论文的紧凑 brief 生成
- `src/modules/relatedRecommendations.ts` — 分组相关文章推荐
- `src/modules/paperCompare.ts` — 有边界的多论文比较流程

## 验证

当前仓库已经包含对以下核心逻辑的自动化验证：

- 引擎模式选择
- Codex 命令构建与 shell 行为
- 工作区工件生成
- research brief 解析
- paper tool 解析
- related-paper recommendation 解析
- compare 与 artifact 保存流程
- auto-highlight 解析/匹配

本地验证使用的核心命令：

```bash
npm test
npm run build
```

但在 Zotero 内部的真实运行时验证仍然必需。请使用 [`docs/manual-qa.md`](./docs/manual-qa.md)。

## 已知限制

- 项目目前尚未宣称完全达到生产可用状态。
- 真实 Zotero 运行时 QA 仍是明确待完成项。

## 路线图

基于当前仓库状态，近期优先事项包括：

- 按照 [`docs/manual-qa.md`](./docs/manual-qa.md) 完成真实 Zotero 运行时 QA
- 在 [`docs/images/`](./docs/images/README.md) 下补充截图与简短演示资产
- 在更多真实安装/运行环境中扩大验证范围
- 持续让文档与阅读器面板工作流保持一致

## 参与贡献

欢迎贡献。

关于环境准备、工作方式与文档约定，请参见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

本项目采用 **AGPL-3.0-or-later** 许可证。

## 其他文档

- [`docs/images/CAPTURE-CHECKLIST.md`](./docs/images/CAPTURE-CHECKLIST.md)
- [`docs/images/README.md`](./docs/images/README.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`docs/manual-qa.md`](./docs/manual-qa.md)
- [`docs/prompt-contracts.md`](./docs/prompt-contracts.md)
