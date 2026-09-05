function summarizeCitationStances(
  results: { stance: string; confidence?: number }[],
) {
  const count = (stance: string) =>
    results.filter((result) => result.stance === stance).length;
  const total = results.length;
  const supporting = count("supporting");
  const contrasting = count("contrasting");
  const mentioning = count("mentioning");
  const background = count("background");
  const methodological = count("methodological");
  const uncertain = count("uncertain") + count("unclear");
  const weighted = results.reduce(
    (sum, result) =>
      sum +
      (result.stance === "supporting"
        ? (result.confidence ?? 0)
        : result.stance === "contrasting"
          ? -(result.confidence ?? 0)
          : 0),
    0,
  );
  const weightedBalance = total ? weighted / total : 0;
  return {
    total,
    supporting,
    contrasting,
    background,
    mentioning,
    methodological,
    uncertain,
    unclear: uncertain,
    weightedSupport: weightedBalance,
    weightedBalance,
    conflictRate:
      supporting + contrasting ? contrasting / (supporting + contrasting) : 0,
    classifiedRate: total ? (total - uncertain) / total : 0,
  };
}

export { summarizeCitationStances };
