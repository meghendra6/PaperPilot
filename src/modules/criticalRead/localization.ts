import { normalizeResponseLanguage } from "../translation/responseLanguage";
import { CRITICAL_READ_STEP_DEFINITIONS } from "./workflow";
import type { CriticalReadStepID } from "./types";

// Presentation-only copy. Never apply this dictionary to paper text, reader
// input, or generated prose; stored workflow IDs and output enums stay stable.
const translations: Record<string, readonly [string, string]> = {
  "Understanding the research question": [
    "연구 질문 파악 중",
    "正在理解研究问题",
  ],
  "Selecting fields and leading venues": [
    "연구 분야와 주요 학술 행사 선정 중",
    "正在选择研究领域和主要发表场所",
  ],
  "Searching scholarly sources": ["학술 자료 검색 중", "正在搜索学术来源"],
  "Verifying publication status": ["출판 상태 검증 중", "正在验证出版状态"],
  "Analyzing relevance and novelty": [
    "관련성과 신규성 분석 중",
    "正在分析相关性和新颖性",
  ],
  "Preparing results": ["결과 준비 중", "正在整理结果"],
  "Research discovery cancelled.": [
    "선행 연구 검색을 취소했습니다.",
    "已取消先前研究搜索。",
  ],
  none: ["없음", "无"],
  verified_main: ["검증된 주요 학회 논문", "已验证的主会论文"],
  verified_workshop: ["검증된 워크숍 논문", "已验证的研讨会论文"],
  verified_findings: ["검증된 Findings 논문", "已验证的 Findings 论文"],
  verified_demo: ["검증된 시연 논문", "已验证的演示论文"],
  verified_industry: ["검증된 산업 트랙 논문", "已验证的工业界专题论文"],
  verified_shared_task: ["검증된 공동 과제 논문", "已验证的共享任务论文"],
  verified_tutorial_or_abstract: [
    "검증된 튜토리얼 또는 초록",
    "已验证的教程或摘要",
  ],
  verified_journal: ["검증된 학술지 논문", "已验证的期刊论文"],
  published_track_unknown: ["출판됨 (트랙 미확인)", "已出版（专题未确认）"],
  preprint_only: ["프리프린트만 확인", "仅有预印本"],
  under_review_or_submission: ["심사 중 또는 투고 상태", "审稿中或已投稿"],
  rejected_or_withdrawn: ["거절 또는 철회", "已拒稿或撤回"],
  unverified: ["미검증", "未验证"],
  identity: ["논문 식별", "论文身份"],
  published: ["출판됨", "已出版"],
  accepted: ["게재 승인", "已接收"],
  main_track: ["주요 트랙", "主会专题"],
  reviews_available: ["심사 의견 공개", "评审意见可获取"],
  "Critical Read": ["비판적 읽기", "批判性阅读"],
  "Critical Read · 7 steps": ["비판적 읽기 · 7단계", "批判性阅读 · 7 个步骤"],
  Complete: ["완료", "已完成"],
  "Start Critical Read": ["비판적 읽기 시작", "开始批判性阅读"],
  "Cancel Critical Read step": ["현재 단계 취소", "取消当前步骤"],
  "Your assessment": ["내 평가", "你的评估"],
  "Abstract signal": ["초록에서 파악한 내용", "摘要线索"],
  "Figure/table signal": ["그림·표에서 파악한 내용", "图表线索"],
  "Open question": ["남은 질문", "待解问题"],
  "Research question": ["연구 질문", "研究问题"],
  Problem: ["문제", "问题"],
  Setting: ["연구 조건", "研究情境"],
  Assumptions: ["가정", "假设"],
  "Claimed gap": ["저자가 주장하는 연구 공백", "作者声称的研究空白"],
  "Reader-agent comparison": ["내 평가와 AI 평가 비교", "读者与 AI 的评估比较"],
  "Evidence supports": ["근거가 뒷받침하는 내용", "证据支持的内容"],
  "Evidence does not support": [
    "근거가 뒷받침하지 않는 내용",
    "证据不支持的内容",
  ],
  "Strongest result": ["가장 설득력 있는 결과", "最有说服力的结果"],
  "Weakest result": ["가장 불확실한 결과", "最不确定的结果"],
  "Reader-agent confidence": ["AI가 평가한 확신 수준", "AI 评估的置信程度"],
  "Author conclusion": ["저자 결론", "作者结论"],
  Agreement: ["일치하는 점", "一致之处"],
  "Reader omission": ["내 평가에서 빠진 내용", "读者遗漏的内容"],
  "Stronger author claim": ["저자가 더 강하게 주장하는 내용", "作者更强的主张"],
  "Author caveat": ["저자가 밝힌 한계", "作者说明的局限"],
  "Interpretive difference": ["해석의 차이", "解释差异"],
  "Reader-agent agreement": [
    "내 평가와 AI 평가의 일치점",
    "读者与 AI 的一致之处",
  ],
  "Reader-agent difference": ["내 평가와 AI 평가의 차이", "读者与 AI 的差异"],
  "Reader-agent unresolved": [
    "내 평가와 AI 평가에서 미해결된 쟁점",
    "读者与 AI 尚未解决的问题",
  ],
  "Paper claim": ["논문의 주장", "论文主张"],
  "Agent inference": ["AI의 추론", "AI 推断"],
  "Strongest supported claim": [
    "근거가 가장 탄탄한 주장",
    "证据支持最充分的主张",
  ],
  "Key residual uncertainty": ["핵심 잔여 불확실성", "主要残余不确定性"],
  "Next reading or experiment": [
    "다음에 읽을 자료 또는 수행할 실험",
    "下一步阅读或实验",
  ],
  Alternative: ["대안 설명", "替代解释"],
  "could explain": ["설명 가능한 결과:", "可解释的结果："],
  test: ["검증 실험", "验证实验"],
  addressed: ["논문에서 다룬 정도", "论文涉及程度"],
  "Revise from here": ["이 단계부터 수정", "从此步骤修改"],
  "Critical Read report": ["비판적 읽기 보고서", "批判性阅读报告"],
  "Report is ready to save.": [
    "보고서를 저장할 수 있습니다.",
    "报告已可保存。",
  ],
  "Saved to Zotero note": ["Zotero 노트에 저장됨", "已保存到 Zotero 笔记"],
  "Save report to note": ["보고서를 노트로 저장", "将报告保存为笔记"],
  "Start Paper Mastery": ["논문 이해도 점검 시작", "开始论文掌握度检查"],
  "Your assessment should cover": [
    "다음 내용을 포함해 평가하세요",
    "你的评估应涵盖",
  ],
  Abstract: ["초록", "摘要"],
  "Relevant source locations": ["관련 본문 위치", "相关原文位置"],
  "Figure/table caption index": ["그림·표 캡션 목록", "图表说明索引"],
  "Write your independent assessment first…": [
    "먼저 자신의 독립적인 평가를 작성하세요…",
    "请先写下你的独立评估…",
  ],
  "Working…": ["진행 중…", "处理中…"],
  "Find and verify prior work": [
    "선행 연구 검색 및 검증",
    "查找并验证先前研究",
  ],
  "Apparent problem": ["파악한 문제", "初步识别的问题"],
  "Evidence shape": ["근거의 형태", "证据形式"],
  "Important figures or tables": ["중요한 그림 또는 표", "重要图表"],
  "Data provenance and splits": ["데이터 출처와 분할", "数据来源与划分"],
  "Baselines and comparison fairness": [
    "비교 기준과 비교의 공정성",
    "基线与比较公平性",
  ],
  "Metrics and research-question fit": [
    "평가 지표와 연구 질문의 적합성",
    "指标与研究问题的匹配度",
  ],
  "Controls, ablations, and sensitivity": [
    "통제 조건, 제거 실험, 민감도",
    "对照、消融与敏感性",
  ],
  "Assumptions and threats to validity": [
    "가정과 타당성 위협",
    "假设与有效性威胁",
  ],
  "Statistical or qualitative evidence": [
    "통계적 또는 정성적 근거",
    "统计或定性证据",
  ],
  "Resources, reproducibility, and evaluated scope": [
    "자원, 재현성, 평가 범위",
    "资源、可复现性与评估范围",
  ],
  "What the evidence supports": ["근거가 뒷받침하는 내용", "证据支持的内容"],
  "What it does not support": [
    "근거가 뒷받침하지 않는 내용",
    "证据不支持的内容",
  ],
  "Weakest or most ambiguous result": [
    "가장 취약하거나 모호한 결과",
    "最薄弱或最模糊的结果",
  ],
  "Your confidence": ["나의 확신 수준", "你的置信程度"],
  "At least one alternative explanation or confounder": [
    "하나 이상의 대안 설명 또는 교란 요인",
    "至少一种替代解释或混杂因素",
  ],
  "What result it could explain": ["설명할 수 있는 결과", "它能解释的结果"],
  "What evidence would distinguish it": [
    "설명들을 구별할 수 있는 근거",
    "能区分不同解释的证据",
  ],
  high: ["높음", "高"],
  medium: ["보통", "中"],
  low: ["낮음", "低"],
  unclear: ["불명확", "不明确"],
  supported: ["근거 있음", "有证据支持"],
  concern: ["우려 있음", "存在疑虑"],
  not_applicable: ["해당 없음", "不适用"],
  available: ["확인 가능", "可获取"],
  unavailable: ["확인 불가", "不可获取"],
  yes: ["예", "是"],
  partly: ["일부", "部分"],
  no: ["아니요", "否"],
  "Revise Critical Read step": ["비판적 읽기 단계 수정", "修改批判性阅读步骤"],
  "Current paper": ["현재 논문", "当前论文"],
  "Save failed": ["저장 실패", "保存失败"],
  "Not recorded": ["기록 없음", "未记录"],
  "Reader assessment": ["독자의 평가", "读者评估"],
  "Paper Pilot synthesis": ["Paper Pilot 종합 분석", "Paper Pilot 综合分析"],
  "Extraction orientation": ["본문 추출 안내", "原文提取说明"],
  Mode: ["추출 방식", "提取方式"],
  Notice: ["안내", "提示"],
  "Indexed source locations": ["색인된 본문 위치", "已索引的原文位置"],
  "Caption coverage": ["추출된 캡션", "已提取的图表说明"],
  "Scan observations": ["훑어보기 관찰", "浏览观察"],
  "Figure/table signals": ["그림·표에서 파악한 내용", "图表线索"],
  "Open questions": ["남은 질문", "待解问题"],
  Question: ["질문", "问题"],
  "Reader comparison": ["독자 평가와의 비교", "与读者评估的比较"],
  "Independent evidence conclusion": [
    "근거에 따른 독립적인 결론",
    "基于证据的独立结论",
  ],
  Supports: ["뒷받침하는 내용", "支持的内容"],
  "Does not support": ["뒷받침하지 않는 내용", "不支持的内容"],
  Confidence: ["확신 수준", "置信程度"],
  "Author comparison": ["저자 결론과의 비교", "与作者结论的比较"],
  Agreements: ["일치하는 점", "一致之处"],
  "Reader omissions": ["독자 평가에서 빠진 내용", "读者遗漏的内容"],
  "Stronger author claims": [
    "저자가 더 강하게 주장하는 내용",
    "作者更强的主张",
  ],
  "Author caveats": ["저자가 밝힌 한계", "作者说明的局限"],
  "Interpretive differences": ["해석의 차이", "解释差异"],
  "Reader vs Paper Pilot method comparison": [
    "독자와 Paper Pilot의 방법론 평가 비교",
    "读者与 Paper Pilot 的方法评估比较",
  ],
  Differences: ["차이점", "差异"],
  Unresolved: ["미해결 쟁점", "未解决的问题"],
  "Final synthesis": ["최종 종합 분석", "最终综合分析"],
  Findings: ["주요 발견", "主要发现"],
  "Source locations": ["본문 위치", "原文位置"],
  "Limits and uncertainty": ["한계와 불확실성", "局限与不确定性"],
  "Method checks": ["방법론 점검", "方法检查"],
  "Paper claims": ["논문의 주장", "论文主张"],
  "Alternative explanations and tests": [
    "대안 설명과 검증 실험",
    "替代解释与验证实验",
  ],
  "Could explain": ["설명 가능한 결과", "可解释的结果"],
  Challenges: ["의문을 제기하는 가정", "质疑的假设"],
  "Discriminating test": ["설명들을 구별할 검증 실험", "区分不同解释的实验"],
  "Addressed by paper": ["논문에서 다룬 정도", "论文涉及程度"],
  "Discovery map": ["선행 연구 지도", "先前研究图谱"],
  "Publication class": ["출판 유형", "出版类型"],
  confidence: ["확신 수준", "置信程度"],
  Evidence: ["근거", "证据"],
  "Verified main-conference papers": [
    "검증된 주요 학회 논문",
    "已验证的主会论文",
  ],
  "Other peer-reviewed work": ["기타 동료 심사 연구", "其他同行评审研究"],
  "Frontier / novelty radar": ["최신 연구·새로운 동향", "前沿研究与新颖性动态"],
  "Verified main": ["검증된 주요 학회 논문", "已验证的主会论文"],
  "Other peer-reviewed": ["기타 동료 심사 연구", "其他同行评审研究"],
  "Novelty radar": ["새로운 연구 동향", "新颖性动态"],
  Limitation: ["한계", "局限"],
  "Reviewer perspective (public sources)": [
    "심사자 관점 (공개 자료)",
    "审稿人视角（公开来源）",
  ],
  "Valued strengths": ["높이 평가된 강점", "获认可的优点"],
  Concerns: ["우려 사항", "疑虑"],
  "Reviewer priorities": ["심사자가 중요하게 본 점", "审稿人关注重点"],
  Disagreements: ["의견 차이", "分歧"],
  "Author response / revision": ["저자 답변·수정", "作者回应与修订"],
  "Decision context": ["심사 결정 맥락", "评审决定背景"],
  Limitations: ["한계", "局限"],
  "Public review source": ["공개 심사 출처", "公开评审来源"],
  "structured-captions": ["구조화된 캡션", "结构化图表说明"],
  "caption-text": ["본문에서 추출한 캡션", "从文本提取的图表说明"],
  "text-only": ["텍스트만 추출", "仅文本提取"],
  "Build your own judgment first, then use Paper Pilot to check it against the paper.":
    [
      "먼저 자신의 판단을 정리한 뒤, Paper Pilot으로 논문의 근거와 비교해 보세요.",
      "先形成自己的判断，再用 Paper Pilot 对照论文证据进行检查。",
    ],
  "Survey abstract, figures, and tables": [
    "초록·그림·표 훑어보기",
    "浏览摘要、图和表",
  ],
  "Skim first. Record what appears important before reading the authors' interpretation.":
    [
      "먼저 훑어보세요. 저자의 해석을 읽기 전에 중요해 보이는 내용을 기록하세요.",
      "先浏览一遍。在阅读作者的解释之前，记录你认为重要的内容。",
    ],
  "Identify the core research question": [
    "핵심 연구 질문 파악하기",
    "识别核心研究问题",
  ],
  "State the research question in your own words after reading the introduction.":
    [
      "서론을 읽은 뒤 연구 질문을 자신의 말로 정리하세요.",
      "阅读引言后，用自己的话表述研究问题。",
    ],
  "Map prior work": ["선행 연구 살펴보기", "梳理先前研究"],
  "Paper Pilot will search for verified main-conference work, other peer-reviewed work, and recent novelty signals.":
    [
      "Paper Pilot이 검증된 주요 학회 논문, 기타 동료 심사 연구, 최근의 새로운 연구 동향을 검색합니다.",
      "Paper Pilot 将搜索已验证的主会论文、其他同行评审研究和近期新颖性动态。",
    ],
  "Evaluate the methodology": ["연구 방법론 평가하기", "评估研究方法"],
  "Assess assumptions, design choices, baselines, data, metrics, and threats before asking the agent to critique them.":
    [
      "AI에게 비평을 요청하기 전에 가정, 설계 선택, 비교 기준, 데이터, 평가 지표, 타당성 위협을 평가하세요.",
      "请先评估假设、设计选择、基线、数据、指标和有效性威胁，再请 AI 进行评析。",
    ],
  "Draw your conclusion from results": [
    "결과를 바탕으로 나의 결론 내리기",
    "根据结果得出自己的结论",
  ],
  "Inspect results and graphs without the discussion. Write the conclusion the evidence supports.":
    [
      "논의 부분을 읽지 않고 결과와 그래프를 살펴보세요. 근거가 뒷받침하는 결론을 작성하세요.",
      "先不阅读讨论部分，检查结果和图表，写下证据支持的结论。",
    ],
  "Contrast your conclusion with the authors'": [
    "나의 결론과 저자의 결론 비교하기",
    "比较自己与作者的结论",
  ],
  "Paper Pilot will compare your conclusion with the paper's discussion and conclusion.":
    [
      "Paper Pilot이 나의 결론을 논문의 논의 및 결론과 비교합니다.",
      "Paper Pilot 将把你的结论与论文的讨论和结论进行比较。",
    ],
  "Generate alternative explanations": ["대안 설명 제시하기", "提出替代解释"],
  "Propose confounds, mechanisms, boundary conditions, and plausible rival explanations before asking for expansion.":
    [
      "AI에게 설명 확장을 요청하기 전에 교란 요인, 작동 원리, 적용 조건, 가능한 다른 설명을 제시하세요.",
      "在请 AI 扩展分析之前，提出混杂因素、机制、适用条件和合理的替代解释。",
    ],
  "Ready to start a seven-step critical read.": [
    "7단계 비판적 읽기를 시작할 준비가 되었습니다.",
    "已准备好开始七步批判性阅读。",
  ],
  "Step 1 is ready. Record your independent observations.": [
    "1단계가 준비되었습니다. 자신이 관찰한 내용을 기록하세요.",
    "第 1 步已就绪。请记录你的独立观察。",
  ],
  "Critical Read complete. Review or save the report.": [
    "비판적 읽기를 완료했습니다. 보고서를 검토하거나 저장하세요.",
    "批判性阅读已完成。请检查或保存报告。",
  ],
  "Cancelling Critical Read prior-work search…": [
    "비판적 읽기의 선행 연구 검색을 취소하는 중…",
    "正在取消批判性阅读的先前研究搜索…",
  ],
  "Critical Read report saved to a Zotero note.": [
    "비판적 읽기 보고서를 Zotero 노트에 저장했습니다.",
    "批判性阅读报告已保存到 Zotero 笔记。",
  ],
  "Critical Read report could not be saved.": [
    "비판적 읽기 보고서를 저장하지 못했습니다.",
    "无法保存批判性阅读报告。",
  ],
  "Write your own assessment before running this step.": [
    "이 단계를 실행하기 전에 자신의 평가를 작성하세요.",
    "请先写下自己的评估，再运行此步骤。",
  ],
  "Critical Read step is unavailable.": [
    "이 비판적 읽기 단계를 사용할 수 없습니다.",
    "此批判性阅读步骤不可用。",
  ],
  "Cancel the active Critical Read run before revising a step.": [
    "단계를 수정하기 전에 실행 중인 비판적 읽기를 취소하세요.",
    "修改步骤前，请先取消正在进行的批判性阅读。",
  ],
  "Prior-work discovery failed.": [
    "선행 연구 검색에 실패했습니다.",
    "先前研究搜索失败。",
  ],
  "Prior-work discovery could not start.": [
    "선행 연구 검색을 시작하지 못했습니다.",
    "无法启动先前研究搜索。",
  ],
  "Critical Read step failed.": [
    "비판적 읽기 단계 실행에 실패했습니다.",
    "批判性阅读步骤执行失败。",
  ],
  "Critical Read output could not be parsed.": [
    "비판적 읽기 결과를 해석하지 못했습니다.",
    "无法解析批判性阅读结果。",
  ],
  "The discovery run did not return verified publication evidence.": [
    "검색에서 검증된 출판 근거를 얻지 못했습니다.",
    "搜索未返回已验证的出版证据。",
  ],
  "Restored Critical Read state was validated before use.": [
    "복원된 비판적 읽기 진행 상태를 검증했습니다.",
    "已验证恢复的批判性阅读状态。",
  ],
  "The previous Critical Read run was interrupted. Resume the current step.": [
    "이전 비판적 읽기 실행이 중단되었습니다. 현재 단계를 이어서 진행하세요.",
    "上次批判性阅读运行已中断。请继续当前步骤。",
  ],
  "Caption index extracted from paper text. Paper Pilot has not visually inspected the figure pixels in this step.":
    [
      "논문 텍스트에서 추출한 캡션 목록입니다. 이 단계에서 Paper Pilot은 그림 이미지를 직접 확인하지 않았습니다.",
      "图表说明索引来自论文文本。在此步骤中，Paper Pilot 尚未直接查看图像内容。",
    ],
  "Degraded extraction: no structured figure/table captions were found. The figure pixels were not visually inspected; use the open PDF directly.":
    [
      "추출 제한: 구조화된 그림·표 캡션을 찾지 못했습니다. 그림 이미지는 직접 확인하지 않았으므로, 열려 있는 PDF에서 확인하세요.",
      "提取受限：未找到结构化的图表说明。尚未直接查看图像内容，请查阅已打开的 PDF。",
    ],
  "Replace Step 2 and invalidate its prior-work map? Your unrelated methodology and conclusion work will be preserved.":
    [
      "2단계를 수정하고 이에 연결된 선행 연구 지도를 초기화할까요? 관련 없는 방법론 평가와 결론은 유지됩니다.",
      "要修改第 2 步并重置关联的先前研究图谱吗？不相关的方法评估和结论将予以保留。",
    ],
  "Replace Step 5 and invalidate the author comparison? Your other completed work will be preserved.":
    [
      "5단계를 수정하고 저자 결론과의 비교를 초기화할까요? 다른 완료된 작업은 유지됩니다.",
      "要修改第 5 步并重置与作者结论的比较吗？其他已完成的工作将予以保留。",
    ],
  "This report preserves the reader's independent judgments separately from Paper Pilot synthesis. Public-review insights are not used inside the seven-step analysis; a permitted reviewer perspective may appear afterward as a distinct section.":
    [
      "이 보고서는 독자의 독립적인 판단과 Paper Pilot의 종합 분석을 구분해 보존합니다. 7단계 분석에는 공개 심사 의견을 사용하지 않으며, 허용된 심사자 관점은 이후 별도 섹션에 표시될 수 있습니다.",
      "本报告分别保留读者的独立判断和 Paper Pilot 的综合分析。七步分析不使用公开评审意见；允许展示的审稿人视角可在之后作为独立部分出现。",
    ],
  "This optional perspective was added only after the reader-first gate. It is separate from reader judgment, paper claims, and Paper Pilot inference.":
    [
      "이 선택적 관점은 독자의 독립적인 평가를 먼저 완료한 뒤에만 추가됩니다. 독자의 판단, 논문의 주장, Paper Pilot의 추론과 구분됩니다.",
      "此可选视角仅在完成读者独立评估要求后添加，与读者判断、论文主张及 Paper Pilot 推断分开呈现。",
    ],
  "Run step {step}": ["{step}단계 실행", "运行第 {step} 步"],
  "Running step {step}: {title}…": [
    "{step}단계 실행 중: {title}…",
    "正在运行第 {step} 步：{title}…",
  ],
  "Step {completed} complete. Step {next} is ready.": [
    "{completed}단계를 완료했습니다. {next}단계가 준비되었습니다.",
    "第 {completed} 步已完成。第 {next} 步已就绪。",
  ],
  "Step {step} reopened. Only dependent outputs were invalidated.": [
    "{step}단계를 다시 열었습니다. 이 단계에 의존하는 결과만 초기화했습니다.",
    "已重新打开第 {step} 步。仅重置了依赖此步骤的结果。",
  ],
  "Replace Step {step}? Unrelated completed steps will be preserved.": [
    "{step}단계를 수정할까요? 관련 없는 완료된 단계는 유지됩니다.",
    "要修改第 {step} 步吗？不相关的已完成步骤将予以保留。",
  ],
  "Discovery: {main} verified main · {other} other peer-reviewed · {novelty} novelty signals":
    [
      "선행 연구: 검증된 주요 학회 논문 {main}편 · 기타 동료 심사 연구 {other}편 · 새로운 연구 동향 {novelty}건",
      "先前研究：已验证的主会论文 {main} 篇 · 其他同行评审研究 {other} 篇 · 新颖性动态 {novelty} 条",
    ],
};

export function createCriticalReadLocalizer(responseLanguage?: unknown) {
  const language = normalizeResponseLanguage(responseLanguage);
  return (text: string, values: Record<string, string | number> = {}) => {
    const translated =
      language === "English"
        ? text
        : (translations[text]?.[language === "Korean" ? 0 : 1] ?? text);
    return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? String(values[key])
        : match,
    );
  };
}

export function getCriticalReadStepCopy(
  stepID: CriticalReadStepID,
  responseLanguage?: unknown,
) {
  const step = CRITICAL_READ_STEP_DEFINITIONS.find(
    (entry) => entry.id === stepID,
  )!;
  const t = createCriticalReadLocalizer(responseLanguage);
  return { title: t(step.title), instruction: t(step.instruction) };
}

// Recognize canonical statuses from current and restored sessions. Unknown
// provider diagnostics stay intact instead of being hidden by a generic status.
export function localizeCriticalReadStatus(
  status: string,
  responseLanguage?: unknown,
) {
  const t = createCriticalReadLocalizer(responseLanguage);
  const running = /^Running step ([1-7]): .*…$/.exec(status);
  if (running)
    return t("Running step {step}: {title}…", {
      step: running[1],
      title: getCriticalReadStepCopy(
        Number(running[1]) as CriticalReadStepID,
        responseLanguage,
      ).title,
    });
  const completed = /^Step ([1-7]) complete\. Step ([1-7]) is ready\.$/.exec(
    status,
  );
  if (completed)
    return t("Step {completed} complete. Step {next} is ready.", {
      completed: completed[1],
      next: completed[2],
    });
  const reopened =
    /^Step ([1-7]) reopened\. Only dependent outputs were invalidated\.$/.exec(
      status,
    );
  if (reopened)
    return t("Step {step} reopened. Only dependent outputs were invalidated.", {
      step: reopened[1],
    });
  if (status.startsWith("Save failed: "))
    return `${t("Save failed")}: ${status.slice("Save failed: ".length)}`;
  return t(status);
}
