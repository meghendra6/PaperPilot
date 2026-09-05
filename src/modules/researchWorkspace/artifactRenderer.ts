import {
  ResearchWorkspaceArtifactRendererOptions,
  ResearchWorkspaceCitationHealthView,
  ResearchWorkspaceCitationView,
  ResearchWorkspaceClaimLedgerView,
  ResearchWorkspaceClaimReviewStatus,
  ResearchWorkspaceContradictionGapView,
  ResearchWorkspaceEvidenceView,
  ResearchWorkspaceGraphView,
  ResearchWorkspaceMasteryView,
  ResearchWorkspaceMatrixView,
  ResearchWorkspaceMethodologyView,
  ResearchWorkspacePaperToCodeView,
  ResearchWorkspaceReproducibilityView,
  ResearchWorkspaceReviewLogView,
  ResearchWorkspaceSynthesisView,
  UnknownRecord,
  createResearchWorkspaceArtifactView,
  evidenceViews,
  humanize,
  isEvidence,
  record,
  text,
} from "./artifactView";
import { metric as createMetric, element } from "./dom";
import type { ResearchWorkspaceArtifact } from "./persistence/contracts";
export * from "./artifactView";
function percentage(value: number | undefined) {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function badge(doc: Document, label: string, tone = "") {
  return element(
    doc,
    "span",
    `pprw-render-badge${tone ? ` pprw-render-badge--${tone}` : ""}`,
    label,
  );
}

function renderEvidence(
  doc: Document,
  evidence: ResearchWorkspaceEvidenceView[],
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const group = element(doc, "div", "pprw-render-evidence");
  for (const item of evidence) {
    const verified = item.status === "verified";
    if (verified && options.onOpenEvidence) {
      const control = element(
        doc,
        "button",
        "pprw-render-evidence-link",
        `Verified · ${item.locator}`,
      );
      control.type = "button";
      control.addEventListener("click", () => {
        void options.onOpenEvidence?.(item.reference);
      });
      group.append(control);
    } else {
      group.append(
        element(
          doc,
          "span",
          `pprw-render-evidence-link pprw-render-evidence-link--${
            verified ? "verified" : "unverified"
          }`,
          `${humanize(item.status)} · ${item.locator}`,
        ),
      );
    }
  }
  return group;
}

function metric(doc: Document, label: string, value: string) {
  return createMetric(doc, { className: "pprw-render-metric", label, value });
}

function statusTone(status: string) {
  if (
    ["verified", "supported", "available", "none", "not_applicable"].includes(
      status,
    )
  ) {
    return "success";
  }
  if (
    [
      "conflicting",
      "unverified",
      "unsupported",
      "missing",
      "major",
      "critical",
      "high",
    ].includes(status)
  ) {
    return "warning";
  }
  return "accent";
}

type ClaimLedgerLanguage = "en" | "ko" | "zh";

interface ClaimLedgerLabels {
  language: ClaimLedgerLanguage;
  guidance: string;
  claims: string;
  readyToCite: string;
  needsReview: string;
  conflicting: string;
  checkedEvidence: string;
  copyMarkdown: string;
  copied: string;
  copyFailed: string;
  filters: string;
  all: string;
  ready: string;
  review: string;
  conflicts: string;
  claimType: string;
  allTypes: string;
  showing: (visible: number, total: number) => string;
  noMatches: string;
  evidence: string;
  supportingEvidence: string;
  contradictingEvidence: string;
  noEvidence: string;
  noQuote: string;
  openPDF: string;
  status: Record<string, string>;
  details: Record<string, string>;
  kinds: Record<string, string>;
  markdownTitle: string;
  evidenceSummary: (verified: number, total: number) => string;
}

const CLAIM_LEDGER_LABELS: Record<ClaimLedgerLanguage, ClaimLedgerLabels> = {
  en: {
    language: "en",
    guidance:
      "Review claims first, then open the evidence only where it affects your reading or writing. Only locally checked evidence is ready to cite.",
    claims: "Claims",
    readyToCite: "Ready to cite",
    needsReview: "Needs review",
    conflicting: "Conflicting",
    checkedEvidence: "Checked evidence",
    copyMarkdown: "Copy readable Markdown",
    copied: "Copied",
    copyFailed: "Copy failed",
    filters: "Evidence review filter",
    all: "All",
    ready: "Ready",
    review: "Review needed",
    conflicts: "Conflicts",
    claimType: "Claim type",
    allTypes: "All claim types",
    showing: (visible, total) => `Showing ${visible} of ${total} claims`,
    noMatches: "No claims match the current filters.",
    evidence: "View evidence",
    supportingEvidence: "Supporting evidence",
    contradictingEvidence: "Contradicting evidence",
    noEvidence: "No supporting evidence was returned for this claim.",
    noQuote: "No quote was returned for this locator.",
    openPDF: "Open in PDF",
    status: {
      ready: "Local evidence checked",
      "needs-review": "Source review needed",
      conflicting: "Conflicting evidence",
      verified: "Locally checked",
      unverified: "Not locally checked",
      "not-found": "Quote not found",
      "source-unavailable": "Source unavailable",
    },
    details: {},
    kinds: {
      author_claim: "Author claim",
      empirical_result: "Empirical result",
      assumption: "Assumption",
      reader_inference: "Reader inference",
      external_evidence: "External evidence",
      claim: "Claim",
    },
    markdownTitle: "Claim–Evidence Review",
    evidenceSummary: (verified, total) =>
      `${verified} of ${total} evidence references locally checked`,
  },
  ko: {
    language: "ko",
    guidance:
      "먼저 주장을 훑고, 읽기나 글쓰기에 필요한 근거만 펼쳐 확인하세요. 로컬 원문 확인이 끝난 근거만 인용에 사용할 수 있습니다.",
    claims: "전체 주장",
    readyToCite: "인용 준비",
    needsReview: "확인 필요",
    conflicting: "상충",
    checkedEvidence: "확인된 근거",
    copyMarkdown: "읽기 좋은 Markdown 복사",
    copied: "복사됨",
    copyFailed: "복사 실패",
    filters: "근거 검토 필터",
    all: "전체",
    ready: "인용 준비",
    review: "확인 필요",
    conflicts: "상충",
    claimType: "주장 유형",
    allTypes: "모든 주장 유형",
    showing: (visible, total) => `주장 ${total}개 중 ${visible}개 표시`,
    noMatches: "현재 조건에 맞는 주장이 없습니다.",
    evidence: "근거 보기",
    supportingEvidence: "지지 근거",
    contradictingEvidence: "상충 근거",
    noEvidence: "이 주장에 제시된 지지 근거가 없습니다.",
    noQuote: "이 위치에 대한 인용문이 제공되지 않았습니다.",
    openPDF: "PDF에서 열기",
    status: {
      ready: "로컬 원문 확인됨",
      "needs-review": "원문 확인 필요",
      conflicting: "상충 근거 있음",
      verified: "로컬 원문 확인됨",
      unverified: "원문 확인 안 됨",
      "not-found": "인용문을 찾지 못함",
      "source-unavailable": "원본 접근 불가",
    },
    details: {
      "No exact quote or trusted structured element was supplied.":
        "직접 인용문이나 신뢰할 수 있는 구조화 요소가 제공되지 않았습니다.",
      "The exact local PDF source could not be loaded.":
        "정확한 로컬 PDF 원본을 불러오지 못했습니다.",
      "The claimed page is outside the local PDF page range.":
        "표시된 페이지가 로컬 PDF의 페이지 범위를 벗어납니다.",
      "The exact quote was not found at the claimed local PDF location.":
        "표시된 로컬 PDF 위치에서 해당 인용문을 찾지 못했습니다.",
    },
    kinds: {
      author_claim: "저자 주장",
      empirical_result: "실험 결과",
      assumption: "가정",
      reader_inference: "독자 추론",
      external_evidence: "외부 근거",
      claim: "주장",
    },
    markdownTitle: "주장–근거 검토표",
    evidenceSummary: (verified, total) =>
      `근거 ${total}개 중 ${verified}개 로컬 원문 확인됨`,
  },
  zh: {
    language: "zh",
    guidance:
      "先浏览主张，再只展开影响阅读或写作的证据。只有经过本地原文核验的证据才适合引用。",
    claims: "全部主张",
    readyToCite: "可供引用",
    needsReview: "需要核验",
    conflicting: "存在冲突",
    checkedEvidence: "已核验证据",
    copyMarkdown: "复制易读 Markdown",
    copied: "已复制",
    copyFailed: "复制失败",
    filters: "证据核验筛选",
    all: "全部",
    ready: "可供引用",
    review: "需要核验",
    conflicts: "冲突",
    claimType: "主张类型",
    allTypes: "全部主张类型",
    showing: (visible, total) => `显示 ${visible}/${total} 条主张`,
    noMatches: "没有符合当前筛选条件的主张。",
    evidence: "查看证据",
    supportingEvidence: "支持证据",
    contradictingEvidence: "冲突证据",
    noEvidence: "该主张没有返回支持证据。",
    noQuote: "该位置没有返回引文。",
    openPDF: "在 PDF 中打开",
    status: {
      ready: "本地原文已核验",
      "needs-review": "需要原文核验",
      conflicting: "存在冲突证据",
      verified: "本地原文已核验",
      unverified: "本地原文未核验",
      "not-found": "未找到引文",
      "source-unavailable": "原文不可用",
    },
    details: {
      "No exact quote or trusted structured element was supplied.":
        "未提供直接引文或可信的结构化元素。",
      "The exact local PDF source could not be loaded.":
        "无法加载对应的本地 PDF 原文。",
      "The claimed page is outside the local PDF page range.":
        "所标页码超出本地 PDF 的页数范围。",
      "The exact quote was not found at the claimed local PDF location.":
        "在所标的本地 PDF 位置未找到该引文。",
    },
    kinds: {
      author_claim: "作者主张",
      empirical_result: "实证结果",
      assumption: "假设",
      reader_inference: "读者推断",
      external_evidence: "外部证据",
      claim: "主张",
    },
    markdownTitle: "主张–证据核验表",
    evidenceSummary: (verified, total) =>
      `${total} 条证据中 ${verified} 条已完成本地原文核验`,
  },
};

function claimLedgerLabels(responseLanguage?: string) {
  const normalized = String(responseLanguage || "English").toLowerCase();
  if (normalized === "korean" || normalized.startsWith("ko")) {
    return CLAIM_LEDGER_LABELS.ko;
  }
  if (normalized === "chinese" || normalized.startsWith("zh")) {
    return CLAIM_LEDGER_LABELS.zh;
  }
  return CLAIM_LEDGER_LABELS.en;
}

function localizedClaimKind(kind: string, labels: ClaimLedgerLabels) {
  return labels.kinds[kind] ?? humanize(kind);
}

function localizedClaimStatus(status: string, labels: ClaimLedgerLabels) {
  return labels.status[status] ?? humanize(status);
}

function localizedEvidenceDetail(detail: string, labels: ClaimLedgerLabels) {
  return labels.details[detail] ?? detail;
}

function claimLedgerMarkdown(
  view: ResearchWorkspaceClaimLedgerView,
  labels: ClaimLedgerLabels,
) {
  const lines = [
    `# ${labels.markdownTitle}`,
    "",
    `- ${labels.claims}: ${view.summary.total}`,
    `- ${labels.readyToCite}: ${view.summary.readyToCite}`,
    `- ${labels.needsReview}: ${view.summary.needsReview}`,
    `- ${labels.conflicting}: ${view.summary.conflicting}`,
    `- ${labels.checkedEvidence}: ${view.summary.evidenceVerified}/${view.summary.evidenceTotal}`,
  ];
  const appendEvidence = (
    title: string,
    evidence: ResearchWorkspaceEvidenceView[],
  ) => {
    lines.push("", `### ${title}`);
    if (!evidence.length) {
      lines.push("", `- ${labels.noEvidence}`);
      return;
    }
    for (const [index, item] of evidence.entries()) {
      lines.push(
        "",
        `${index + 1}. **${localizedClaimStatus(item.status, labels)}** — ${item.locator}`,
      );
      if (item.quote) lines.push("", `   > ${item.quote.replace(/\n+/g, " ")}`);
      if (item.detail) {
        lines.push("", `   ${localizedEvidenceDetail(item.detail, labels)}`);
      }
    }
  };
  for (const [index, claim] of view.claims.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${claim.text}`,
      "",
      `- ${localizedClaimKind(claim.claimKind, labels)}`,
      `- ${localizedClaimStatus(claim.reviewStatus, labels)}`,
      `- ${labels.evidenceSummary(claim.verifiedSupport, claim.evidenceTotal)}`,
    );
    appendEvidence(labels.supportingEvidence, claim.support);
    if (claim.contradictions.length) {
      appendEvidence(labels.contradictingEvidence, claim.contradictions);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function createResearchWorkspaceClaimLedgerMarkdown(
  value: unknown,
  responseLanguage = "English",
) {
  const view = createResearchWorkspaceArtifactView(value, "claim-ledger");
  if (view.kind !== "claim-ledger") {
    throw new Error("The value is not a Claim Ledger artifact.");
  }
  return claimLedgerMarkdown(view, claimLedgerLabels(responseLanguage));
}

function renderClaimEvidenceGroup(
  doc: Document,
  title: string,
  evidence: ResearchWorkspaceEvidenceView[],
  labels: ClaimLedgerLabels,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const section = element(doc, "section", "pprw-claim-evidence-group");
  section.append(element(doc, "h4", "", `${title} · ${evidence.length}`));
  if (!evidence.length) {
    section.append(element(doc, "p", "pprw-render-empty", labels.noEvidence));
    return section;
  }
  const list = element(doc, "div", "pprw-claim-evidence-list");
  for (const item of evidence) {
    const row = element(doc, "article", "pprw-claim-evidence-item");
    row.dataset.status = item.status;
    const header = element(doc, "div", "pprw-claim-evidence-header");
    header.append(
      element(
        doc,
        "strong",
        "pprw-claim-evidence-status",
        localizedClaimStatus(item.status, labels),
      ),
      element(doc, "span", "pprw-claim-evidence-locator", item.locator),
    );
    row.append(header);
    if (item.quote) {
      row.append(element(doc, "blockquote", "pprw-claim-quote", item.quote));
    } else if (!item.detail) {
      row.append(element(doc, "p", "pprw-claim-no-quote", labels.noQuote));
    }
    if (item.detail) {
      row.append(
        element(
          doc,
          "p",
          "pprw-claim-evidence-detail",
          localizedEvidenceDetail(item.detail, labels),
        ),
      );
    }
    if (item.status === "verified" && options.onOpenEvidence) {
      const open = element(
        doc,
        "button",
        "pprw-button pp-btn pp-btn--ghost pprw-claim-open",
        labels.openPDF,
      );
      open.type = "button";
      open.addEventListener("click", () => {
        void options.onOpenEvidence?.(item.reference);
      });
      row.append(open);
    }
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderClaimLedger(
  doc: Document,
  view: ResearchWorkspaceClaimLedgerView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--claim-ledger");
  const labels = claimLedgerLabels(options.responseLanguage);
  root.lang = labels.language;
  const overview = element(doc, "section", "pprw-claim-overview");
  const metrics = element(doc, "div", "pprw-claim-metrics");
  for (const [value, label, status] of [
    [view.summary.total, labels.claims, "total"],
    [view.summary.readyToCite, labels.readyToCite, "ready"],
    [view.summary.needsReview, labels.needsReview, "needs-review"],
    [view.summary.conflicting, labels.conflicting, "conflicting"],
  ] as const) {
    const item = element(doc, "div", "pprw-claim-metric");
    item.dataset.status = status;
    item.append(
      element(doc, "strong", "", String(value)),
      element(doc, "span", "", label),
    );
    metrics.append(item);
  }
  const guidance = element(doc, "div", "pprw-claim-guidance");
  guidance.append(
    element(doc, "p", "", labels.guidance),
    element(
      doc,
      "p",
      "pprw-claim-coverage",
      labels.evidenceSummary(
        view.summary.evidenceVerified,
        view.summary.evidenceTotal,
      ),
    ),
  );
  if (options.onCopyText) {
    const copy = element(
      doc,
      "button",
      "pprw-button pp-btn pp-btn--ghost pprw-claim-copy",
      labels.copyMarkdown,
    );
    copy.type = "button";
    copy.addEventListener("click", () => {
      copy.disabled = true;
      void Promise.resolve(
        options.onCopyText?.(claimLedgerMarkdown(view, labels)),
      )
        .then(() => {
          copy.textContent = labels.copied;
        })
        .catch(() => {
          copy.textContent = labels.copyFailed;
        })
        .finally(() => {
          copy.disabled = false;
        });
    });
    guidance.append(copy);
  }
  overview.append(metrics, guidance);
  root.append(overview);

  const controls = element(doc, "div", "pprw-claim-controls");
  const filterGroup = element(doc, "div", "pprw-claim-filters");
  filterGroup.setAttribute("role", "group");
  filterGroup.setAttribute("aria-label", labels.filters);
  const filterDefinitions: Array<{
    value: "all" | ResearchWorkspaceClaimReviewStatus;
    label: string;
  }> = [
    { value: "all", label: labels.all },
    { value: "ready", label: labels.ready },
    { value: "needs-review", label: labels.review },
    { value: "conflicting", label: labels.conflicts },
  ];
  const filterButtons = filterDefinitions.map((filter, index) => {
    const control = element(doc, "button", "pprw-claim-filter", filter.label);
    control.type = "button";
    control.dataset.filter = filter.value;
    control.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    filterGroup.append(control);
    return control;
  });
  const typeLabel = element(doc, "label", "pprw-claim-type-control");
  typeLabel.append(
    element(doc, "span", "pp-visually-hidden", labels.claimType),
  );
  const typeSelect = element(doc, "select", "pprw-select pprw-claim-type");
  const claimKinds = [...new Set(view.claims.map((claim) => claim.claimKind))];
  for (const [value, label] of [
    ["all", labels.allTypes],
    ...claimKinds.map((kind) => [kind, localizedClaimKind(kind, labels)]),
  ]) {
    const option = element(doc, "option", "", label);
    option.value = value;
    typeSelect.append(option);
  }
  typeSelect.value = "all";
  typeLabel.append(typeSelect);
  controls.append(filterGroup, typeLabel);
  root.append(controls);

  const count = element(doc, "p", "pprw-claim-count");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  root.append(count);
  const list = element(doc, "div", "pprw-claim-list");
  const rows: Array<{
    node: HTMLDetailsElement;
    status: ResearchWorkspaceClaimReviewStatus;
    kind: string;
  }> = [];
  for (const [index, claim] of view.claims.entries()) {
    const item = element(doc, "details", "pprw-claim");
    item.dataset.status = claim.reviewStatus;
    item.dataset.claimKind = claim.claimKind;
    const summary = element(doc, "summary", "pprw-claim-summary");
    const number = element(
      doc,
      "span",
      "pprw-claim-number",
      String(index + 1).padStart(2, "0"),
    );
    const main = element(doc, "div", "pprw-claim-main");
    main.append(
      element(doc, "p", "pprw-claim-statement", claim.text),
      element(
        doc,
        "p",
        `pprw-claim-meta pprw-claim-meta--${claim.reviewStatus}`,
        `${localizedClaimKind(claim.claimKind, labels)} · ${localizedClaimStatus(claim.reviewStatus, labels)} · ${labels.evidenceSummary(claim.verifiedSupport, claim.evidenceTotal)}`,
      ),
    );
    summary.append(
      number,
      main,
      element(doc, "span", "pprw-claim-disclosure", labels.evidence),
    );
    const body = element(doc, "div", "pprw-claim-body");
    body.append(
      renderClaimEvidenceGroup(
        doc,
        labels.supportingEvidence,
        claim.support,
        labels,
        options,
      ),
    );
    if (claim.contradictions.length) {
      body.append(
        renderClaimEvidenceGroup(
          doc,
          labels.contradictingEvidence,
          claim.contradictions,
          labels,
          options,
        ),
      );
    }
    item.append(summary, body);
    list.append(item);
    rows.push({
      node: item,
      status: claim.reviewStatus,
      kind: claim.claimKind,
    });
  }
  const noMatches = element(
    doc,
    "p",
    "pprw-claim-no-matches",
    labels.noMatches,
  );
  noMatches.hidden = true;
  list.append(noMatches);
  if (!view.claims.length) {
    noMatches.hidden = false;
  }
  root.append(list);

  let activeFilter: "all" | ResearchWorkspaceClaimReviewStatus = "all";
  const updateFilters = () => {
    let visible = 0;
    for (const row of rows) {
      const matchesStatus =
        activeFilter === "all" || row.status === activeFilter;
      const matchesKind =
        typeSelect.value === "all" || row.kind === typeSelect.value;
      row.node.hidden = !(matchesStatus && matchesKind);
      if (!row.node.hidden) visible += 1;
    }
    for (const button of filterButtons) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.filter === activeFilter ? "true" : "false",
      );
    }
    count.textContent = labels.showing(visible, view.summary.total);
    noMatches.hidden = visible > 0;
  };
  for (const button of filterButtons) {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter as
        | "all"
        | ResearchWorkspaceClaimReviewStatus;
      updateFilters();
    });
  }
  typeSelect.addEventListener("change", updateFilters);
  updateFilters();
  return root;
}

function renderMethodology(
  doc: Document,
  view: ResearchWorkspaceMethodologyView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--methodology");
  const concerning = view.checks.filter((check) =>
    ["major", "critical"].includes(check.severity),
  ).length;
  const unclear = view.checks.filter((check) =>
    ["unsupported", "unclear"].includes(check.status),
  ).length;
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Profile", humanize(view.profile)),
    metric(doc, "Checks", String(view.checks.length)),
    metric(doc, "Major or critical", String(concerning)),
    metric(doc, "Unsupported or unclear", String(unclear)),
  );
  root.append(
    metrics,
    element(doc, "p", "pprw-synthesis-answer", view.executiveSummary),
  );
  if (view.strengths.length) {
    root.append(renderStringList(doc, "Strengths", view.strengths));
  }
  const checks = element(doc, "section", "pprw-render-section");
  checks.append(element(doc, "h4", "", "Methodology checks"));
  const checkList = element(doc, "div", "pprw-render-card-list");
  for (const check of view.checks) {
    const card = element(doc, "article", "pprw-render-card");
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(doc, humanize(check.status), statusTone(check.status)),
      badge(doc, humanize(check.severity), statusTone(check.severity)),
    );
    if (check.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(check.confidence)}`));
    }
    card.append(
      element(doc, "h5", "", humanize(check.checkID)),
      metadata,
      element(doc, "p", "pprw-render-statement", check.finding),
      element(
        doc,
        "p",
        "pprw-render-note",
        `Why it matters: ${check.implication}`,
      ),
    );
    if (check.evidence.length) {
      card.append(renderEvidence(doc, check.evidence, options));
    }
    checkList.append(card);
  }
  checks.append(checkList);
  root.append(checks);
  if (view.experiments.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Discriminating experiments"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const experiment of view.experiments) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", experiment.hypothesis),
        element(doc, "p", "pprw-render-statement", experiment.experiment),
      );
      if (experiment.expectedOutcomes.length) {
        card.append(
          renderStringList(
            doc,
            "Expected outcomes",
            experiment.expectedOutcomes,
          ),
        );
      }
      if (experiment.evidence.length) {
        card.append(renderEvidence(doc, experiment.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.residualUncertainty.length) {
    const uncertainty = renderStringList(
      doc,
      "Residual uncertainty",
      view.residualUncertainty,
    );
    uncertainty.classList.add("pprw-render-section--warning");
    root.append(uncertainty);
  }
  return root;
}

function renderReproducibility(
  doc: Document,
  view: ResearchWorkspaceReproducibilityView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--reproducibility");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Available", String(view.availability.available)),
    metric(doc, "Partial", String(view.availability.partial)),
    metric(doc, "Missing", String(view.availability.missing)),
    metric(doc, "Blockers", String(view.blockers.length)),
    metric(doc, "Estimated effort", humanize(view.estimatedEffort)),
  );
  root.append(
    metrics,
    element(doc, "p", "pprw-synthesis-answer", view.summary),
  );
  const artifactSection = element(doc, "section", "pprw-render-section");
  artifactSection.append(element(doc, "h4", "", "Required artifacts"));
  const artifactList = element(doc, "div", "pprw-render-card-list");
  for (const artifact of view.artifacts) {
    const card = element(doc, "article", "pprw-render-card");
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(artifact.availability),
        statusTone(artifact.availability),
      ),
      badge(doc, humanize(artifact.artifactKind), "accent"),
    );
    if (artifact.confidence !== undefined) {
      metadata.append(
        badge(doc, `Confidence ${percentage(artifact.confidence)}`),
      );
    }
    card.append(element(doc, "h5", "", artifact.label), metadata);
    for (const [label, value] of [
      ["Value", artifact.value],
      ["Version", artifact.version],
      ["Location", artifact.url],
      ["Notes", artifact.notes],
    ] as const) {
      if (value) {
        card.append(
          element(doc, "p", "pprw-render-note", `${label}: ${value}`),
        );
      }
    }
    if (artifact.evidence.length) {
      card.append(renderEvidence(doc, artifact.evidence, options));
    }
    artifactList.append(card);
  }
  artifactSection.append(artifactList);
  root.append(artifactSection);
  if (view.blockers.length) {
    const section = element(
      doc,
      "section",
      "pprw-render-section pprw-render-section--warning",
    );
    section.append(element(doc, "h4", "", "Reproduction blockers"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const blocker of view.blockers) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        badge(doc, humanize(blocker.severity), statusTone(blocker.severity)),
        element(doc, "p", "pprw-render-statement", blocker.description),
        element(
          doc,
          "p",
          "pprw-render-note",
          `Mitigation: ${blocker.mitigation}`,
        ),
      );
      if (blocker.evidence.length) {
        card.append(renderEvidence(doc, blocker.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.steps.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Reproduction workflow"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const step of view.steps) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "h5", "", `${step.order}. ${step.title}`));
      if (step.inputs.length)
        card.append(renderStringList(doc, "Inputs", step.inputs));
      if (step.outputs.length)
        card.append(renderStringList(doc, "Outputs", step.outputs));
      if (step.assumptions.length)
        card.append(renderStringList(doc, "Assumptions", step.assumptions));
      if (step.unresolved.length)
        card.append(renderStringList(doc, "Unresolved", step.unresolved));
      if (step.evidence.length) {
        card.append(renderEvidence(doc, step.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.minimalReproductionSteps.length) {
    root.append(
      renderStringList(
        doc,
        "Minimum viable reproduction",
        view.minimalReproductionSteps,
      ),
    );
  }
  if (view.verificationCommands.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(
      element(doc, "h4", "", "Verification commands"),
      element(
        doc,
        "pre",
        "pprw-render-code",
        view.verificationCommands.join("\n"),
      ),
    );
    root.append(section);
  }
  return root;
}

function renderPaperToCode(
  doc: Document,
  view: ResearchWorkspacePaperToCodeView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--paper-to-code");
  root.append(
    element(doc, "p", "pprw-synthesis-answer", view.summary),
    element(doc, "p", "pprw-render-note", `Objective: ${view.objective}`),
  );
  if (view.inputs.length)
    root.append(renderStringList(doc, "Inputs", view.inputs));
  if (view.outputs.length)
    root.append(renderStringList(doc, "Outputs", view.outputs));
  const pseudocode = element(doc, "section", "pprw-render-section");
  pseudocode.append(
    element(doc, "h4", "", "Pseudocode"),
    element(doc, "pre", "pprw-render-code", view.pseudocode),
  );
  root.append(pseudocode);
  if (view.trace.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Execution trace"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const step of view.trace) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", `${step.order}. ${step.name}`),
        element(doc, "p", "pprw-render-statement", step.operation),
      );
      if (step.inputShapes.length || step.outputShapes.length) {
        const metadata = element(doc, "div", "pprw-render-inline");
        if (step.inputShapes.length) {
          metadata.append(badge(doc, `Input ${step.inputShapes.join(", ")}`));
        }
        if (step.outputShapes.length) {
          metadata.append(badge(doc, `Output ${step.outputShapes.join(", ")}`));
        }
        card.append(metadata);
      }
      if (step.stateChanges.length)
        card.append(renderStringList(doc, "State changes", step.stateChanges));
      if (step.memoryOrCommunication.length) {
        card.append(
          renderStringList(
            doc,
            "Memory and communication",
            step.memoryOrCommunication,
          ),
        );
      }
      if (step.invariants.length)
        card.append(renderStringList(doc, "Invariants", step.invariants));
      if (step.ambiguity.length)
        card.append(renderStringList(doc, "Ambiguity", step.ambiguity));
      if (step.evidence.length) {
        card.append(renderEvidence(doc, step.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  const complexity = element(doc, "section", "pprw-render-section");
  complexity.append(element(doc, "h4", "", "Complexity"));
  const complexityMetrics = element(doc, "div", "pprw-render-metrics");
  complexityMetrics.append(
    metric(doc, "Compute", view.complexity.compute),
    metric(doc, "Memory", view.complexity.memory),
  );
  if (view.complexity.communication) {
    complexityMetrics.append(
      metric(doc, "Communication", view.complexity.communication),
    );
  }
  complexity.append(complexityMetrics);
  if (view.complexity.bottleneck) {
    complexity.append(
      element(
        doc,
        "p",
        "pprw-render-note",
        `Bottleneck: ${view.complexity.bottleneck}`,
      ),
    );
  }
  if (view.complexity.assumptions.length) {
    complexity.append(
      renderStringList(doc, "Assumptions", view.complexity.assumptions),
    );
  }
  if (view.complexity.evidence.length) {
    complexity.append(renderEvidence(doc, view.complexity.evidence, options));
  }
  root.append(complexity);
  if (view.invariants.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Implementation invariants"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const invariant of view.invariants) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "p", "pprw-render-statement", invariant.statement),
      );
      if (invariant.consequence) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Consequence: ${invariant.consequence}`,
          ),
        );
      }
      if (invariant.evidence.length) {
        card.append(renderEvidence(doc, invariant.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.ambiguities.length) {
    const section = element(
      doc,
      "section",
      "pprw-render-section pprw-render-section--warning",
    );
    section.append(element(doc, "h4", "", "Implementation ambiguities"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const ambiguity of view.ambiguities) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        badge(
          doc,
          `${humanize(ambiguity.impact)} impact`,
          statusTone(ambiguity.impact),
        ),
        element(doc, "p", "pprw-render-statement", ambiguity.question),
        element(
          doc,
          "p",
          "pprw-render-note",
          `How to resolve: ${ambiguity.proposedExperiment}`,
        ),
      );
      if (ambiguity.likelyChoices.length) {
        card.append(
          renderStringList(doc, "Likely choices", ambiguity.likelyChoices),
        );
      }
      if (ambiguity.evidence.length) {
        card.append(renderEvidence(doc, ambiguity.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.divergences.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Paper–code divergences"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const divergence of view.divergences) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", divergence.area),
        element(
          doc,
          "p",
          "pprw-render-note",
          `Paper: ${divergence.paperStatement}`,
        ),
        element(
          doc,
          "p",
          "pprw-render-note",
          `Code: ${divergence.codeBehavior}`,
        ),
        element(
          doc,
          "p",
          "pprw-render-statement",
          `Impact: ${divergence.impact}`,
        ),
      );
      if (divergence.evidence.length) {
        card.append(renderEvidence(doc, divergence.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.checklist.length) {
    root.append(
      renderStringList(doc, "Implementation checklist", view.checklist),
    );
  }
  if (view.tests.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Validation tests"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const test of view.tests) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", test.name),
        element(doc, "p", "pprw-render-statement", test.purpose),
      );
      if (test.setup)
        card.append(
          element(doc, "p", "pprw-render-note", `Setup: ${test.setup}`),
        );
      if (test.expected) {
        card.append(
          element(doc, "p", "pprw-render-note", `Expected: ${test.expected}`),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  return root;
}

function renderMatrix(
  doc: Document,
  view: ResearchWorkspaceMatrixView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--matrix");
  if (view.coverage) {
    const metrics = element(doc, "div", "pprw-render-metrics");
    metrics.append(
      metric(doc, "Extraction", percentage(view.coverage.extraction)),
      metric(doc, "Evidence", percentage(view.coverage.evidence)),
      metric(
        doc,
        "Required evidence",
        percentage(view.coverage.requiredEvidence),
      ),
      metric(doc, "Papers", String(view.rows.length)),
    );
    root.append(metrics);
  }
  const scroller = element(doc, "div", "pprw-matrix-scroll");
  const table = element(doc, "table", "pprw-matrix-table");
  table.append(element(doc, "caption", "", "Evidence Matrix"));
  const head = element(doc, "thead");
  const headRow = element(doc, "tr");
  headRow.append(element(doc, "th", "", "Paper"));
  for (const column of view.columns) {
    headRow.append(element(doc, "th", "", column.label));
  }
  head.append(headRow);
  table.append(head);
  const body = element(doc, "tbody");
  for (const row of view.rows) {
    const tableRow = element(doc, "tr");
    const paperCell = element(doc, "th", "pprw-matrix-paper", row.title);
    paperCell.scope = "row";
    tableRow.append(paperCell);
    const cells = new Map(row.cells.map((cell) => [cell.columnID, cell]));
    for (const column of view.columns) {
      const cell = cells.get(column.id);
      const tableCell = element(doc, "td");
      if (!cell) {
        tableCell.append(badge(doc, "Pending", "warning"));
      } else {
        const value = element(doc, "div", "pprw-matrix-value", cell.value);
        const meta = element(doc, "div", "pprw-render-inline");
        meta.append(
          badge(
            doc,
            humanize(cell.status),
            cell.status === "extracted" ? "success" : "warning",
          ),
        );
        if (cell.confidence !== undefined) {
          meta.append(badge(doc, `Confidence ${percentage(cell.confidence)}`));
        }
        tableCell.append(value, meta);
        if (cell.evidence.length) {
          tableCell.append(renderEvidence(doc, cell.evidence, options));
        }
      }
      tableRow.append(tableCell);
    }
    body.append(tableRow);
  }
  table.append(body);
  scroller.append(table);
  root.append(scroller);
  return root;
}

function renderGraph(
  doc: Document,
  view: ResearchWorkspaceGraphView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--graph");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Nodes", String(view.nodeCount)),
    metric(doc, "Relationships", String(view.edgeCount)),
    metric(doc, "Verified", String(view.verifiedEdgeCount)),
    metric(doc, "Inferred", String(view.inferredEdgeCount)),
  );
  root.append(metrics);
  const list = element(doc, "div", "pprw-graph-list");
  for (const edge of view.edges) {
    const card = element(doc, "article", "pprw-render-card");
    const relationship = element(doc, "div", "pprw-graph-relationship");
    relationship.append(
      element(doc, "strong", "", edge.source),
      badge(doc, humanize(edge.relationship), "accent"),
      element(doc, "strong", "", edge.target),
    );
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(edge.provenance),
        edge.provenance === "inferred" ? "warning" : "success",
      ),
    );
    if (edge.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(edge.confidence)}`));
    }
    card.append(relationship, metadata);
    if (edge.evidence.length) {
      card.append(renderEvidence(doc, edge.evidence, options));
    }
    list.append(card);
  }
  if (!view.edges.length) {
    list.append(
      element(doc, "p", "pprw-muted", "No relationships were produced."),
    );
  }
  root.append(list);
  return root;
}

function renderStringList(doc: Document, title: string, entries: string[]) {
  const section = element(doc, "section", "pprw-render-section");
  section.append(element(doc, "h4", "", title));
  const list = element(doc, "ul", "pprw-render-list");
  for (const entry of entries) list.append(element(doc, "li", "", entry));
  section.append(list);
  return section;
}

function renderSynthesis(
  doc: Document,
  view: ResearchWorkspaceSynthesisView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--synthesis");
  root.append(element(doc, "p", "pprw-synthesis-answer", view.answer));
  if (view.coverage) {
    const metrics = element(doc, "div", "pprw-render-metrics");
    metrics.append(
      metric(doc, "Analyzed", String(view.coverage.analyzedSources ?? "—")),
      metric(
        doc,
        "Project sources",
        String(view.coverage.totalProjectSources ?? "—"),
      ),
      metric(doc, "Excluded", String(view.coverage.excludedSources ?? "—")),
      metric(
        doc,
        "Coverage",
        view.coverage.insufficient ? "Limited" : "Sufficient",
      ),
    );
    root.append(metrics);
  }
  for (const group of view.groups) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", group.title));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const entry of group.entries) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "p", "pprw-render-statement", entry.statement));
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(
          doc,
          humanize(entry.support),
          entry.support === "verified" ? "success" : "warning",
        ),
        badge(
          doc,
          `${entry.sourceIDs.length} source${
            entry.sourceIDs.length === 1 ? "" : "s"
          }`,
        ),
      );
      card.append(metadata);
      if (entry.uncertainty) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Uncertainty: ${entry.uncertainty}`,
          ),
        );
      }
      if (entry.evidence.length) {
        card.append(renderEvidence(doc, entry.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.unresolvedUncertainty.length) {
    root.append(
      renderStringList(
        doc,
        "Unresolved uncertainty",
        view.unresolvedUncertainty,
      ),
    );
  }
  if (view.freshnessWarnings.length) {
    const warnings = renderStringList(
      doc,
      "Freshness and coverage warnings",
      view.freshnessWarnings,
    );
    warnings.classList.add("pprw-render-section--warning");
    root.append(warnings);
  }
  return root;
}

function renderContradictionGap(
  doc: Document,
  view: ResearchWorkspaceContradictionGapView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(
    doc,
    "div",
    "pprw-render pprw-render--contradiction-gap",
  );
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Project sources", String(view.coverage.includedSources)),
    metric(doc, "Current inputs", String(view.coverage.admittedArtifacts)),
    metric(
      doc,
      "Verified evidence-linked assertions",
      String(view.coverage.verifiedFactAtoms),
    ),
    metric(
      doc,
      "Multi-source support",
      String(view.coverage.multiSourceSupport),
    ),
    metric(
      doc,
      "Rule-detected contradiction candidates",
      String(view.coverage.directContradictions),
    ),
    metric(doc, "Evidence gaps", String(view.coverage.gaps)),
  );
  root.append(metrics);

  if (view.supportGroups.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Supported by multiple sources"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const group of view.supportGroups) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(element(doc, "p", "pprw-render-statement", group.statement));
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(doc, `${group.sourceIDs.length} verified sources`, "success"),
      );
      card.append(metadata);
      if (group.evidence.length) {
        card.append(renderEvidence(doc, group.evidence, options));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }

  const relationshipGroups = [
    ["direct-contradiction", "Contradiction candidates"],
    ["non-comparable", "Non-comparable designs"],
    ["uncertain", "Uncertain comparisons"],
  ] as const;
  for (const [classification, title] of relationshipGroups) {
    const entries = view.relationships.filter(
      (relationship) => relationship.effectiveClassification === classification,
    );
    if (!entries.length) continue;
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", title));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const relationship of entries) {
      const card = element(doc, "article", "pprw-render-card");
      card.dataset.relationshipId = relationship.relationshipID;
      card.append(
        element(doc, "p", "pprw-render-statement", relationship.topic),
      );
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(doc, humanize(relationship.effectiveClassification), "accent"),
        badge(doc, `Comparability: ${humanize(relationship.comparability)}`),
        badge(doc, humanize(relationship.reviewState)),
      );
      if (
        relationship.effectiveClassification !==
        relationship.deterministicClassification
      ) {
        metadata.append(
          badge(
            doc,
            `Rule result: ${humanize(
              relationship.deterministicClassification,
            )}`,
            "warning",
          ),
        );
      }
      card.append(metadata);
      if (relationship.sides.length) {
        const sides = element(doc, "ul", "pprw-render-list");
        for (const side of relationship.sides) {
          sides.append(element(doc, "li", "", side));
        }
        card.append(sides);
      }
      if (relationship.evidence.length) {
        card.append(renderEvidence(doc, relationship.evidence, options));
      }
      if (relationship.limitations.length) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            relationship.limitations.join(" "),
          ),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }

  if (view.gaps.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Evidence gaps"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const gap of view.gaps) {
      const card = element(doc, "article", "pprw-render-card");
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(badge(doc, humanize(gap.kind), "warning"));
      card.append(
        metadata,
        element(doc, "p", "pprw-render-statement", gap.statement),
      );
      if (gap.nextSearchQuestion) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Next search: ${gap.nextSearchQuestion}`,
          ),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (view.nextSearchQuestions.length) {
    root.append(
      renderStringList(doc, "Next search questions", view.nextSearchQuestions),
    );
  }
  if (view.limitations.length) {
    const limitations = renderStringList(
      doc,
      "Coverage and limits",
      view.limitations,
    );
    limitations.classList.add("pprw-render-section--warning");
    root.append(limitations);
  }
  return root;
}

function renderMastery(
  doc: Document,
  view: ResearchWorkspaceMasteryView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--mastery");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Answer quality", percentage(view.summary.answerQuality)),
    metric(doc, "Calibration", percentage(view.summary.calibration)),
    metric(doc, "Concept coverage", percentage(view.summary.conceptCoverage)),
    metric(doc, "Sources", String(view.sourceCount)),
  );
  root.append(metrics);

  if (view.currentQuestion) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Current question"));
    const card = element(doc, "article", "pprw-render-card");
    card.append(
      element(doc, "p", "pprw-render-statement", view.currentQuestion.prompt),
    );
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(doc, humanize(view.currentQuestion.mode), "accent"),
      badge(doc, humanize(view.currentQuestion.difficulty)),
      badge(
        doc,
        `${view.currentQuestion.sourceCount} source${
          view.currentQuestion.sourceCount === 1 ? "" : "s"
        }`,
      ),
    );
    card.append(metadata);
    section.append(card);
    root.append(section);
  }

  if (view.attempts.length) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", "Attempt history"));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const attempt of view.attempts) {
      const card = element(doc, "article", "pprw-render-card");
      card.append(
        element(doc, "h5", "", attempt.question),
        element(doc, "p", "pprw-render-statement", attempt.answer),
      );
      const metadata = element(doc, "div", "pprw-render-inline");
      if (attempt.score !== undefined && attempt.maxScore !== undefined) {
        metadata.append(
          badge(doc, `Score ${attempt.score}/${attempt.maxScore}`),
        );
      }
      if (attempt.learnerConfidence !== undefined) {
        metadata.append(
          badge(
            doc,
            `Learner confidence ${percentage(attempt.learnerConfidence)}`,
          ),
        );
      }
      if (attempt.graderConfidence !== undefined) {
        metadata.append(
          badge(
            doc,
            `Grader confidence ${percentage(attempt.graderConfidence)}`,
          ),
        );
      }
      card.append(metadata);
      for (const grade of attempt.grades) {
        const gradeCard = element(doc, "div", "pprw-render-note");
        gradeCard.append(
          element(
            doc,
            "strong",
            "",
            `${grade.criterion} · ${text(grade.score)}/${text(grade.maxScore)}`,
          ),
          element(doc, "span", "", ` ${grade.feedback}`),
        );
        card.append(gradeCard);
        if (grade.evidence.length) {
          card.append(renderEvidence(doc, grade.evidence, options));
        }
      }
      if (attempt.misconceptions.length) {
        card.append(
          renderStringList(doc, "Misconceptions", attempt.misconceptions),
        );
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }

  if (view.summary.openMisconceptions.length) {
    root.append(
      renderStringList(
        doc,
        "Open misconceptions",
        view.summary.openMisconceptions,
      ),
    );
  }
  if (view.summary.nextReviewAt) {
    root.append(
      element(
        doc,
        "p",
        "pprw-render-note",
        `Next review: ${view.summary.nextReviewAt}`,
      ),
    );
  }
  return root;
}

function renderCitation(
  doc: Document,
  view: ResearchWorkspaceCitationView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--citation");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Sources", text(view.coverage.sources)),
    metric(doc, "Detected contexts", text(view.coverage.detected)),
    metric(
      doc,
      "Resolved",
      view.coverage.detected
        ? `${view.coverage.resolved ?? 0}/${view.coverage.detected}`
        : "Not applicable",
    ),
    metric(
      doc,
      "Analyzed",
      view.coverage.analyzed !== undefined
        ? `${view.coverage.analyzed}/${view.coverage.submitted ?? 0}`
        : "Not sent",
    ),
  );
  root.append(metrics);
  root.append(
    element(
      doc,
      "p",
      "pprw-render-note",
      "Citation stance is a review signal, not a verdict about whether the cited claim is true.",
    ),
  );
  if (view.coverage.limitations.length) {
    const warnings = renderStringList(
      doc,
      "Coverage limitations",
      view.coverage.limitations,
    );
    warnings.classList.add("pprw-render-section--warning");
    root.append(warnings);
  }
  const list = element(doc, "div", "pprw-render-card-list");
  for (const row of view.rows) {
    const card = element(doc, "article", "pprw-render-card");
    const metadata = element(doc, "div", "pprw-render-inline");
    metadata.append(
      badge(
        doc,
        humanize(row.stance),
        row.stance === "contrasting" ? "warning" : "accent",
      ),
      badge(
        doc,
        humanize(row.resolutionStatus),
        row.resolutionStatus === "resolved" ? "success" : "warning",
      ),
      badge(
        doc,
        row.pageIndex === undefined
          ? "Page unavailable"
          : `Page ${row.pageIndex + 1}`,
      ),
    );
    if (row.confidence !== undefined) {
      metadata.append(badge(doc, `Confidence ${percentage(row.confidence)}`));
    }
    if (row.corrected) metadata.append(badge(doc, "User corrected", "success"));
    card.append(
      metadata,
      element(doc, "p", "pprw-render-statement", row.exactSentence),
      element(
        doc,
        "p",
        "pprw-render-note",
        `Reference ${row.marker}: ${row.resolvedTitle ?? row.reference}`,
      ),
    );
    if (row.rationale) {
      card.append(
        element(doc, "p", "pprw-render-note", `Rationale: ${row.rationale}`),
      );
    }
    if (row.modelStance && row.modelStance !== row.stance) {
      card.append(
        element(
          doc,
          "p",
          "pprw-render-note",
          `Original model signal: ${humanize(row.modelStance)}`,
        ),
      );
    }
    if (row.limitations.length) {
      card.append(renderStringList(doc, "Limitations", row.limitations));
    }
    if (row.evidence.length) {
      card.append(renderEvidence(doc, row.evidence, options));
    }
    list.append(card);
  }
  if (!view.rows.length) {
    list.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No supported citation marker was automatically detected. This does not prove that the paper has no citations.",
      ),
    );
  }
  root.append(list);
  return root;
}

function renderCitationHealth(
  doc: Document,
  view: ResearchWorkspaceCitationHealthView,
  options: ResearchWorkspaceArtifactRendererOptions,
) {
  const root = element(doc, "div", "pprw-render pprw-render--citation-health");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Current inputs", String(view.coverage.admittedArtifacts)),
    metric(doc, "Citation contexts", String(view.coverage.citationContexts)),
    metric(doc, "Stance results", String(view.coverage.citationStances)),
    metric(doc, "Local library items", String(view.coverage.localLibraryItems)),
    metric(doc, "Metadata signals", String(view.coverage.localMetadataSignals)),
    metric(
      doc,
      "Draft coverage candidates",
      `${view.coverage.unsupportedDraftCandidates}/${view.coverage.draftStatements}`,
    ),
  );
  root.append(
    metrics,
    element(
      doc,
      "p",
      "pprw-render-note",
      "This is a review checklist, not an aggregate truth or scientific-quality score. Local and optional external signals require inspection of the cited work and primary metadata.",
    ),
    element(
      doc,
      "p",
      "pprw-render-note",
      `Local metadata ${view.provenance.localMetadataVersion} observed ${view.provenance.localMetadataObservedAt} · fingerprint ${view.provenance.localMetadataFingerprint}${view.provenance.localMetadataTruncated ? " · bounded item scan" : ""}`,
    ),
  );
  if (view.provenance.externalProvider) {
    const provider = view.provenance.externalProvider;
    root.append(
      element(
        doc,
        "p",
        "pprw-render-note",
        `${provider.provider} observed ${provider.observedAt} · ${provider.identifiersCovered}/${provider.identifiersChecked} identifiers covered · ${provider.signalCount} signals · fingerprint ${provider.fingerprint}`,
      ),
    );
  }

  if (view.draft) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(
      element(
        doc,
        "h4",
        "",
        view.draft.name
          ? `Imported draft · ${view.draft.name}`
          : "Imported draft",
      ),
      element(
        doc,
        "p",
        "pprw-render-note",
        `${view.draft.analyzedCharacters.toLocaleString()} of ${view.draft.sourceCharacters.toLocaleString()} characters analyzed · fingerprint ${view.draft.fingerprint}${view.draft.truncated ? " · bounded" : ""}`,
      ),
    );
    if (view.draft.excerpt) {
      section.append(
        element(doc, "p", "pprw-render-statement", view.draft.excerpt),
      );
    }
    root.append(section);
  }

  const groups = new Map<string, typeof view.findings>();
  for (const item of view.findings) {
    const entries = groups.get(item.kind) ?? [];
    entries.push(item);
    groups.set(item.kind, entries);
  }
  for (const kind of [...groups.keys()].sort()) {
    const section = element(doc, "section", "pprw-render-section");
    section.append(element(doc, "h4", "", humanize(kind)));
    const list = element(doc, "div", "pprw-render-card-list");
    for (const item of groups.get(kind) ?? []) {
      const card = element(doc, "article", "pprw-render-card");
      card.dataset.findingId = item.findingID;
      const metadata = element(doc, "div", "pprw-render-inline");
      metadata.append(
        badge(
          doc,
          humanize(item.severity),
          item.severity === "high"
            ? "warning"
            : item.severity === "info"
              ? "success"
              : "accent",
        ),
        badge(
          doc,
          `${item.sourceCount} source${item.sourceCount === 1 ? "" : "s"}`,
        ),
        badge(
          doc,
          `${item.contextCount} context${item.contextCount === 1 ? "" : "s"}`,
        ),
      );
      card.append(
        metadata,
        element(doc, "h5", "", item.title),
        element(doc, "p", "pprw-render-statement", item.summary),
      );
      if (item.referenceIdentity) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Reference identity: ${item.referenceIdentity}`,
          ),
        );
      }
      if (item.localItem) {
        card.append(element(doc, "p", "pprw-render-note", item.localItem));
      }
      if (item.draftExcerpt && item.draftExcerpt !== item.summary) {
        card.append(
          element(
            doc,
            "p",
            "pprw-render-note",
            `Draft excerpt: ${item.draftExcerpt}`,
          ),
        );
      }
      if (item.evidence.length) {
        card.append(renderEvidence(doc, item.evidence, options));
      }
      if (item.limitations.length) {
        card.append(renderStringList(doc, "Review boundary", item.limitations));
      }
      list.append(card);
    }
    section.append(list);
    root.append(section);
  }
  if (!view.findings.length) {
    root.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No checklist finding was produced from the admitted saved artifacts and local metadata. This does not prove that no citation or reference issue exists.",
      ),
    );
  }
  if (view.limitations.length) {
    const limitations = renderStringList(
      doc,
      "Coverage and interpretation limits",
      view.limitations,
    );
    limitations.classList.add("pprw-render-section--warning");
    root.append(limitations);
  }
  return root;
}

function renderReviewLog(doc: Document, view: ResearchWorkspaceReviewLogView) {
  const root = element(doc, "div", "pprw-render pprw-render--review-log");
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Papers", text(view.summary.total)),
    metric(doc, "Included", text(view.summary.include)),
    metric(doc, "Excluded", text(view.summary.exclude)),
    metric(doc, "Maybe", text(view.summary.maybe)),
    metric(doc, "Unreviewed", text(view.summary.unreviewed)),
    metric(doc, "Decision events", text(view.summary.decisions)),
  );
  root.append(metrics);
  const issueCount =
    (view.summary.duplicateSignals ?? 0) +
    (view.summary.missingPDFSignals ?? 0);
  if (issueCount) {
    root.append(
      element(
        doc,
        "p",
        "pprw-render-note pprw-render-note--warning",
        `${issueCount} local duplicate or missing-PDF signal${issueCount === 1 ? "" : "s"} require review. Signals never change decisions automatically.`,
      ),
    );
  }
  const scroll = element(doc, "div", "pprw-matrix-scroll");
  const table = element(doc, "table", "pprw-matrix-table");
  const head = element(doc, "thead");
  const heading = element(doc, "tr");
  for (const label of ["Paper", "Stage", "Decision", "Reason", "History"]) {
    heading.append(element(doc, "th", "", label));
  }
  head.append(heading);
  table.append(head);
  const body = element(doc, "tbody");
  for (const row of view.rows) {
    const line = element(doc, "tr");
    const paper = element(doc, "td");
    paper.append(element(doc, "strong", "", row.title));
    if (row.issues.length) {
      const flags = element(doc, "div", "pprw-render-inline");
      for (const issue of row.issues) {
        flags.append(badge(doc, humanize(issue), "warning"));
      }
      paper.append(flags);
    }
    line.append(
      paper,
      element(doc, "td", "", humanize(row.stage)),
      element(doc, "td", "", humanize(row.decision)),
      element(doc, "td", "", row.reason),
      element(
        doc,
        "td",
        "",
        row.legacy
          ? "Legacy current state · no event history"
          : `${row.historyCount} event${row.historyCount === 1 ? "" : "s"}`,
      ),
    );
    body.append(line);
  }
  table.append(body);
  scroll.append(table);
  root.append(scroll);
  if (view.limitations.length) {
    root.append(renderStringList(doc, "Audit boundary", view.limitations));
  }
  return root;
}

const HIDDEN_TECHNICAL_FIELDS = new Set([
  "id",
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "contentFingerprint",
  "projectionFingerprint",
]);

function renderContextPlan(doc: Document, value: UnknownRecord) {
  const section = element(doc, "section", "pprw-render-section");
  section.append(element(doc, "h4", "", "Context coverage"));
  const metrics = element(doc, "div", "pprw-render-metrics");
  metrics.append(
    metric(doc, "Budget", text(value.requestedBudget)),
    metric(doc, "Used", text(value.usedCharacters)),
    metric(doc, "Omitted", text(value.omittedCharacters)),
    metric(
      doc,
      "Sources",
      String(Array.isArray(value.projections) ? value.projections.length : "—"),
    ),
  );
  section.append(metrics);
  if (value.insufficientCoverage === true) {
    section.append(
      element(
        doc,
        "p",
        "pprw-render-note pprw-render-note--warning",
        "One or more sources had limited bounded coverage.",
      ),
    );
  }
  return section;
}

function renderGenericValue(
  doc: Document,
  value: unknown,
  options: ResearchWorkspaceArtifactRendererOptions,
  depth = 0,
  label?: string,
): HTMLElement {
  if (isEvidence(value)) {
    return renderEvidence(doc, evidenceViews([value]), options);
  }
  if (value === null || value === undefined) {
    return element(doc, "span", "pprw-render-empty", "Not reported");
  }
  if (typeof value !== "object") {
    return element(doc, "span", "pprw-render-scalar", text(value));
  }
  if (depth >= 5) {
    return element(
      doc,
      "span",
      "pprw-render-empty",
      "Additional detail hidden",
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return element(doc, "span", "pprw-render-empty", "None");
    const list = element(doc, "div", "pprw-render-card-list");
    for (const entry of value.slice(0, 80)) {
      const item = element(doc, "article", "pprw-render-card");
      item.append(renderGenericValue(doc, entry, options, depth + 1));
      list.append(item);
    }
    return list;
  }
  const candidate = value as UnknownRecord;
  if (label === "contextPlan") return renderContextPlan(doc, candidate);
  const container = element(doc, "div", "pprw-render-fields");
  for (const [key, entry] of Object.entries(candidate)) {
    if (HIDDEN_TECHNICAL_FIELDS.has(key)) continue;
    if (key === "evidence") {
      const evidence = evidenceViews(entry);
      if (evidence.length)
        container.append(renderEvidence(doc, evidence, options));
      continue;
    }
    if (key === "contextPlan" && record(entry)) {
      container.append(renderContextPlan(doc, record(entry)!));
      continue;
    }
    const field = element(doc, "section", "pprw-render-field");
    field.append(element(doc, "h5", "", humanize(key)));
    field.append(renderGenericValue(doc, entry, options, depth + 1, key));
    container.append(field);
  }
  if (!container.childElementCount) {
    container.append(element(doc, "span", "pprw-render-empty", "No details"));
  }
  return container;
}

export function renderResearchWorkspaceArtifactValue(
  doc: Document,
  value: unknown,
  options: ResearchWorkspaceArtifactRendererOptions = {},
) {
  const view = createResearchWorkspaceArtifactView(value, options.artifactType);
  if (view.kind === "claim-ledger") {
    return renderClaimLedger(doc, view, options);
  }
  if (view.kind === "methodology") {
    return renderMethodology(doc, view, options);
  }
  if (view.kind === "reproducibility") {
    return renderReproducibility(doc, view, options);
  }
  if (view.kind === "paper-to-code") {
    return renderPaperToCode(doc, view, options);
  }
  if (view.kind === "matrix") return renderMatrix(doc, view, options);
  if (view.kind === "graph") return renderGraph(doc, view, options);
  if (view.kind === "synthesis") return renderSynthesis(doc, view, options);
  if (view.kind === "mastery") return renderMastery(doc, view, options);
  if (view.kind === "citation") return renderCitation(doc, view, options);
  if (view.kind === "citation-health") {
    return renderCitationHealth(doc, view, options);
  }
  if (view.kind === "review-log") return renderReviewLog(doc, view);
  if (view.kind === "contradiction-gap") {
    return renderContradictionGap(doc, view, options);
  }
  const root = element(doc, "div", "pprw-render pprw-render--generic");
  root.append(renderGenericValue(doc, view.value, options));
  return root;
}

export function renderResearchWorkspaceArtifactEnvelope(
  doc: Document,
  artifact: ResearchWorkspaceArtifact,
  options: Omit<ResearchWorkspaceArtifactRendererOptions, "artifactType"> = {},
) {
  const root = element(doc, "div", "pprw-render-envelope");
  const lineage = element(doc, "div", "pprw-render-inline");
  lineage.append(
    badge(doc, humanize(artifact.lineage.operation), "accent"),
    badge(doc, artifact.lineage.operationVersion),
    badge(doc, humanize(artifact.lineage.providerMode)),
    badge(
      doc,
      `${artifact.sourceIDs.length} source${
        artifact.sourceIDs.length === 1 ? "" : "s"
      }`,
    ),
  );
  if (artifact.lineage.model) {
    lineage.append(
      badge(
        doc,
        [
          artifact.lineage.model,
          artifact.lineage.reasoningEffort,
          artifact.lineage.responseLanguage,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
  }
  root.append(lineage);
  if (artifact.checkpoint) {
    const progress = element(doc, "div", "pprw-render-metrics");
    progress.append(
      metric(
        doc,
        "Completed",
        String(artifact.checkpoint.completedUnits.length),
      ),
      metric(doc, "Failed", String(artifact.checkpoint.failedUnits.length)),
      metric(doc, "Pending", String(artifact.checkpoint.pendingUnits.length)),
    );
    root.append(progress);
  }
  root.append(
    renderResearchWorkspaceArtifactValue(doc, artifact.payload, {
      ...options,
      artifactType: artifact.type,
    }),
  );
  return root;
}
