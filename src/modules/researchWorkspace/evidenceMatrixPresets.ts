export const EVIDENCE_MATRIX_PRESETS = {
  full: {
    id: "full",
    version: "evidence-matrix-v1",
    label: "Evidence Matrix",
    columns: [
      {
        id: "contribution",
        label: "Main contribution",
        extractionQuestion:
          "What is the paper's main contribution relative to prior work?",
        question:
          "What is the paper's main contribution relative to prior work?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "method",
        label: "Method",
        extractionQuestion: "What method or mechanism is proposed?",
        question: "What method or mechanism is proposed?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "dataset",
        label: "Datasets / workloads",
        extractionQuestion:
          "Which datasets, benchmarks, or workloads are used?",
        question: "Which datasets, benchmarks, or workloads are used?",
        valueType: "list",
        requiredEvidence: true,
      },
      {
        id: "hardware",
        label: "Hardware",
        extractionQuestion:
          "What hardware and system configuration is reported?",
        question: "What hardware and system configuration is reported?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "primary_metric",
        label: "Primary metric",
        extractionQuestion:
          "What is the primary reported evaluation metric or result?",
        question: "What is the primary reported evaluation metric or result?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "limitation",
        label: "Limitation",
        extractionQuestion:
          "What limitation, threat to validity, or unsupported scope is stated or directly evidenced?",
        question:
          "What limitation, threat to validity, or unsupported scope is stated or directly evidenced?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "code",
        label: "Code available",
        extractionQuestion:
          "Does the paper provide an official code or artifact URL?",
        question: "Does the paper provide an official code or artifact URL?",
        valueType: "boolean",
        requiredEvidence: true,
      },
    ],
  },
  "quick-compare-v1": {
    id: "quick-compare-v1",
    version: "quick-compare-v1",
    label: "Quick Compare",
    columns: [
      {
        id: "contribution",
        label: "Contribution",
        extractionQuestion: "What is the paper's main contribution?",
        question: "What is the paper's main contribution?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "method",
        label: "Method",
        extractionQuestion: "What method or mechanism is proposed?",
        question: "What method or mechanism is proposed?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "evaluation",
        label: "Evaluation",
        extractionQuestion:
          "Which dataset, benchmark, or workload is the primary evaluation based on?",
        question:
          "Which dataset, benchmark, or workload is the primary evaluation based on?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "primary_result",
        label: "Primary result",
        extractionQuestion: "What is the main reported empirical result?",
        question: "What is the main reported empirical result?",
        valueType: "text",
        requiredEvidence: true,
      },
      {
        id: "limitation",
        label: "Limitation",
        extractionQuestion:
          "What is the most decision-relevant limitation or threat to validity?",
        question:
          "What is the most decision-relevant limitation or threat to validity?",
        valueType: "text",
        requiredEvidence: true,
      },
    ],
  },
} as const;

export type EvidenceMatrixPresetID = keyof typeof EVIDENCE_MATRIX_PRESETS;

export function getEvidenceMatrixPreset(id: EvidenceMatrixPresetID) {
  return EVIDENCE_MATRIX_PRESETS[id];
}
