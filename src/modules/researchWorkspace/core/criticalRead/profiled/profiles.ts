const check = (
  id: string,
  label: string,
  question: string,
  guidance: string[],
  required = true,
) => ({
  id,
  label,
  question,
  guidance,
  required,
});
const COMMON = [
  check(
    "claim_scope",
    "Claim–scope alignment",
    "Do the conclusions remain within the evaluated population, workload, and conditions?",
    [
      "Separate demonstrated results from extrapolation.",
      "Check abstract and conclusion wording against the experiments.",
    ],
  ),
  check(
    "evidence_trace",
    "Claim–evidence traceability",
    "Can each central claim be traced to a table, figure, theorem, or cited source?",
    [
      "Record exact page/section locators.",
      "Flag narrative claims without direct support.",
    ],
  ),
  check(
    "alternatives",
    "Alternative explanations",
    "What plausible alternative explanations remain, and are they ruled out?",
    ["Look for confounding factors.", "Propose a discriminating experiment."],
  ),
  check(
    "reproducibility",
    "Reproducibility",
    "Are the artifacts and operational details sufficient to reproduce the result?",
    ["Check code, data, versions, hardware, seeds, and commands."],
  ),
];
const PROFILES = {
  empirical_ml: {
    id: "empirical_ml",
    label: "Empirical ML",
    description:
      "Training or evaluating learning systems on datasets and benchmarks.",
    signals: [
      "dataset",
      "benchmark",
      "accuracy",
      "f1",
      "training",
      "ablation",
      "seed",
      "baseline",
    ],
    checks: [
      check(
        "data_provenance",
        "Data provenance",
        "Are train/validation/test sources and licenses clear?",
        [
          "Check contamination and overlap.",
          "Check preprocessing and exclusions.",
        ],
      ),
      check(
        "split_integrity",
        "Split integrity",
        "Are the data splits independent and free from leakage?",
        ["Check near-duplicates and temporal leakage."],
      ),
      check(
        "baseline_parity",
        "Baseline parity",
        "Were baselines tuned and evaluated with comparable budgets?",
        ["Compare data, compute, search budget, and checkpoint selection."],
      ),
      check(
        "statistics",
        "Statistical reliability",
        "Are variance, seeds, confidence intervals, and significance handled adequately?",
        ["Single-run improvements require caution."],
      ),
      check(
        "ablation",
        "Ablation completeness",
        "Do ablations isolate the contribution of each component?",
        ["Check interaction effects and removed controls."],
      ),
      ...COMMON,
    ],
  },
  ml_systems: {
    id: "ml_systems",
    label: "ML Systems",
    description:
      "Serving, training infrastructure, compilers, or accelerator-aware ML systems.",
    signals: [
      "ttft",
      "tpot",
      "itl",
      "throughput",
      "latency",
      "kv cache",
      "serving",
      "gpu",
      "npu",
      "compiler",
      "batch",
      "concurrency",
    ],
    checks: [
      check(
        "workload",
        "Workload representativeness",
        "Do sequence lengths, batch/concurrency, model sizes, and request distributions represent the target deployment?",
        [
          "Check ISL/OSL distributions.",
          "Check closed-loop versus open-loop load.",
        ],
      ),
      check(
        "hardware_config",
        "Hardware and software configuration",
        "Are SKU, clock, memory, interconnect, framework, compiler, kernels, and flags fully specified?",
        [
          "Check simulator versus silicon.",
          "Check software versions and power modes.",
        ],
      ),
      check(
        "metric_integrity",
        "Metric integrity",
        "Are TTFT, TPOT, ITL, throughput, and tail latency defined and measured consistently?",
        [
          "Separate warm-up and steady-state.",
          "Check percentiles and averaging.",
        ],
      ),
      check(
        "baseline_parity",
        "Baseline parity",
        "Do baselines use equally mature implementations and equivalent tuning, precision, batching, and cache settings?",
        ["Check hidden implementation advantages."],
      ),
      check(
        "end_to_end",
        "End-to-end accounting",
        "Are host overhead, data movement, scheduling, synchronization, draft cost, and verification cost included?",
        ["Distinguish kernel-only from end-to-end results."],
      ),
      check(
        "resource_tradeoff",
        "Resource trade-offs",
        "Are memory, power, cost, and accuracy trade-offs reported alongside speed?",
        ["Check peak versus sustained resources."],
      ),
      ...COMMON,
    ],
  },
  systems: {
    id: "systems",
    label: "Systems",
    description:
      "Operating systems, networking, databases, architecture, and distributed systems.",
    signals: [
      "system",
      "distributed",
      "database",
      "network",
      "scheduler",
      "storage",
      "throughput",
      "tail latency",
    ],
    checks: [
      check(
        "threat_model",
        "Threat/failure model",
        "Are failure, adversary, and consistency assumptions explicit?",
        ["Inspect omitted failure modes."],
      ),
      check(
        "workload",
        "Workload representativeness",
        "Are workloads and scale representative?",
        ["Check synthetic versus production traces."],
      ),
      check(
        "baseline_parity",
        "Baseline parity",
        "Are baselines comparably optimized and configured?",
        ["Check tuning and implementation maturity."],
      ),
      check(
        "tail_behavior",
        "Tail and failure behavior",
        "Are tail latency, overload, recovery, and degraded modes measured?",
        ["Mean values can hide instability."],
      ),
      check(
        "resource_cost",
        "Resource cost",
        "Are compute, memory, network, storage, and operational costs included?",
        ["Check hidden replication or caching costs."],
      ),
      ...COMMON,
    ],
  },
  theory: {
    id: "theory",
    label: "Theory",
    description: "Theorem-, proof-, or formal-analysis-centered work.",
    signals: [
      "theorem",
      "lemma",
      "proof",
      "bound",
      "convergence",
      "complexity",
      "assumption",
    ],
    checks: [
      check(
        "definitions",
        "Definitions and notation",
        "Are all objects, domains, and overloaded symbols defined consistently?",
        ["Trace notation across statements and proofs."],
      ),
      check(
        "assumption_necessity",
        "Assumption necessity",
        "Which assumptions are essential, and are stronger assumptions used silently?",
        ["Look for counterexamples when an assumption is removed."],
      ),
      check(
        "proof_dependencies",
        "Proof dependency graph",
        "Do lemmas establish every step needed by the main theorem?",
        ["Identify circular or missing dependencies."],
      ),
      check(
        "boundary_cases",
        "Boundary cases",
        "Are zero, equality, singular, finite-size, and asymptotic boundary cases covered?",
        ["Test the smallest and degenerate instances."],
      ),
      check(
        "practical_regime",
        "Practical regime",
        "Does the asymptotic statement illuminate the parameter regime used in practice?",
        ["Compare constants and lower-order terms."],
      ),
      ...COMMON,
    ],
  },
  clinical: {
    id: "clinical",
    label: "Clinical",
    description:
      "Clinical trials, diagnostic studies, epidemiology, or patient outcomes.",
    signals: [
      "patient",
      "clinical",
      "trial",
      "cohort",
      "hazard ratio",
      "diagnosis",
      "outcome",
    ],
    checks: [
      check(
        "population",
        "Population and eligibility",
        "Are inclusion, exclusion, recruitment, and representativeness clear?",
        ["Check selection bias and subgroup coverage."],
      ),
      check(
        "allocation",
        "Allocation and blinding",
        "Are randomization, allocation concealment, and blinding adequate?",
        ["Check protocol deviations."],
      ),
      check(
        "outcomes",
        "Outcome integrity",
        "Were outcomes pre-specified, clinically meaningful, and completely reported?",
        ["Check surrogate outcomes and selective reporting."],
      ),
      check(
        "confounding",
        "Confounding and adjustment",
        "Are important confounders measured and handled?",
        ["Check post-treatment adjustment."],
      ),
      check(
        "harms",
        "Harms and missingness",
        "Are adverse events, attrition, and missing data analyzed appropriately?",
        ["Check differential dropout."],
      ),
      ...COMMON,
    ],
  },
  qualitative: {
    id: "qualitative",
    label: "Qualitative",
    description: "Interview, ethnography, thematic, or interpretive studies.",
    signals: [
      "interview",
      "thematic",
      "qualitative",
      "ethnography",
      "coding",
      "participant",
    ],
    checks: [
      check(
        "sampling",
        "Sampling rationale",
        "Is participant or case selection justified and sufficiently varied?",
        ["Check saturation claims."],
      ),
      check(
        "reflexivity",
        "Researcher reflexivity",
        "Are researcher position and influence discussed?",
        ["Check interaction with data collection and coding."],
      ),
      check(
        "analysis_audit",
        "Analysis audit trail",
        "Can codes, themes, and interpretations be traced to data excerpts?",
        ["Check double coding and disagreement handling."],
      ),
      check(
        "negative_cases",
        "Negative cases",
        "Are disconfirming or deviant cases considered?",
        ["Check whether themes were over-generalized."],
      ),
      check(
        "transferability",
        "Transferability",
        "Are context and limits detailed enough for readers to judge transferability?",
        ["Avoid statistical-generalization language."],
      ),
      ...COMMON,
    ],
  },
  general: {
    id: "general",
    label: "General research",
    description: "A cross-disciplinary default profile.",
    signals: [],
    checks: [
      check(
        "question",
        "Research question",
        "Is the research question specific and answerable?",
        ["Separate motivation from testable question."],
      ),
      check(
        "method_fit",
        "Method fit",
        "Does the method answer the stated question?",
        ["Check design–claim alignment."],
      ),
      check(
        "measurement",
        "Measurement validity",
        "Do measurements capture the intended constructs?",
        ["Check proxies and operational definitions."],
      ),
      check(
        "uncertainty",
        "Uncertainty",
        "Is uncertainty represented and propagated appropriately?",
        ["Check robustness and sensitivity."],
      ),
      ...COMMON,
    ],
  },
};
function getCriticalReadProfile(id: string) {
  return (
    Object.values(PROFILES).find((profile) => profile.id === id) ??
    PROFILES.general
  );
}
function listCriticalReadProfiles() {
  return Object.values(PROFILES);
}

export { getCriticalReadProfile, listCriticalReadProfiles };
