"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateReproducibilityReadiness = calculateReproducibilityReadiness;
const WEIGHTS = {
    code: 3, commit: 2, dataset: 3, data: 3, model: 2, environment: 2,
    hardware: 1.5, training_config: 2, training: 2, inference_config: 2,
    inference: 2, evaluation_command: 2.5, evaluation: 2.5,
    random_seeds: 1, license: 0.5, results: 1.5, other: 0.5,
};
const VALUE = { available: 1, partial: 0.5, missing: 0, not_applicable: 0, unclear: 0.2 };
const REQUIRED_GROUPS = [
    ["code"], ["dataset", "data"], ["environment"], ["evaluation_command", "evaluation"],
];
function calculateReproducibilityReadiness(report) {
    let totalWeight = 0;
    let availableWeight = 0;
    const availability = new Map();
    const declaredKinds = new Set();
    for (const artifact of report.artifacts) {
        declaredKinds.add(artifact.kind);
        if (artifact.availability === "not_applicable")
            continue;
        const weight = WEIGHTS[artifact.kind] ?? 0.5;
        totalWeight += weight;
        const value = VALUE[artifact.availability];
        availableWeight += weight * value;
        availability.set(artifact.kind, Math.max(availability.get(artifact.kind) ?? 0, value));
    }
    for (const group of REQUIRED_GROUPS) {
        if (group.some((kind) => declaredKinds.has(kind)))
            continue;
        const representative = group[0];
        totalWeight += WEIGHTS[representative] ?? 1;
        availability.set(representative, 0);
    }
    const criticalBlockers = report.blockers.filter((entry) => entry.severity === "critical").length;
    const majorBlockers = report.blockers.filter((entry) => entry.severity === "major").length;
    const blockerPenalty = criticalBlockers * 0.18 + majorBlockers * 0.08 + report.blockers.filter((entry) => entry.severity === "minor").length * 0.025;
    const score = Math.max(0, Math.min(1, (totalWeight ? availableWeight / totalWeight : 0) - blockerPenalty));
    const missingKinds = [...availability.entries()].filter(([, value]) => value < 0.5).map(([kind]) => kind);
    const label = criticalBlockers || score < 0.35 ? "not_ready" : score < 0.6 ? "partial" : score < 0.82 ? "mostly_ready" : "ready";
    return {
        score,
        ready: label === "ready" && report.blockers.length === 0,
        availableWeight,
        totalWeight,
        blockerCount: report.blockers.length,
        criticalBlockers,
        majorBlockers,
        missingKinds,
        label,
    };
}
