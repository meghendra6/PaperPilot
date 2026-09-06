# Chat context evaluation — 2026-09-07

This evaluation implements R13 in the [product review specification](./paperpilot-product-review-and-chat-spec.md). It measures source containment and explores alternatives; it does not establish real-paper answer accuracy or a production speed guarantee.

## Reproduce

```sh
node scripts/evaluate-chat-context.mjs --out /tmp/chat-context-offline.json
PAPERPILOT_EVAL_MODEL=<supported-model> node scripts/evaluate-chat-context.mjs --live --out /tmp/chat-context-live.json
```

The second command makes nine real requests through the user's authenticated Codex CLI. It uses read-only, ephemeral executions with the supplied synthetic text and no external research. It does not read the user's Zotero library. Choose a model available to the account; the initial `gpt-5.4` probe was rejected by this account and was excluded from successful timings.

The [CC0 fixture corpus](../test/fixtures/chat-evaluation/corpus.json) contains 30 authored questions: eight selection, six follow-up, four annotation, four visual, four comparison, and four insufficient-evidence cases. Its papers and results are synthetic. Exact source IDs, expected quotes, page indices and limitations form an explicit oracle. They are not independent human adjudication of scientific claims. The fixture test checks source membership and that every expected quote exists verbatim in its source.

The keyword baseline calls the existing retriever on sentence units with top-K three. This isolates retrieval behavior; it is **not the complete production prompt**, which also makes full paper files available. Selection-nearby takes the matched sentence plus its neighbors. The evidence-packet variant reranks by distinct question-token coverage normalized by passage length, with a selection-match bonus. Whole-paper includes all admitted text. All variants use the same admitted sources. Nothing outside the fixture scope is admitted. No variant is enabled in the product by this experiment.

## Offline observations

[Full measurements](./evaluations/chat-context-offline.json), 20 repetitions per fixture/variant, Node 20.16.0 on the local macOS host:

| Variant                  | Expected quotes included | Wrong source IDs | Mean serialized characters | Build p50 / p95    |
| ------------------------ | ------------------------ | ---------------- | -------------------------- | ------------------ |
| Keyword subset           | 24 / 28                  | 0                | 214                        | 0.0175 / 0.0345 ms |
| Selection + nearby       | 24 / 28                  | 0                | 228                        | 0.0122 / 0.0306 ms |
| Reranked evidence packet | 25 / 28                  | 0                | 212                        | 0.0286 / 0.0484 ms |
| Whole admitted paper     | 28 / 28                  | 0                | 547                        | 0.0010 / 0.0020 ms |

Two questions deliberately have no expected quote. They are still included in source-isolation checks. Exact-quote containment measures whether evidence was supplied, not whether an answer used it correctly. These tiny construction times exclude PDF extraction, process startup, inference, polling and persistence.

## Real model sample

[Raw answers and timing](./evaluations/chat-context-live.json) record three fixed questions × three variants, one request each, Codex CLI and model version in every record. The successful run used `gpt-6-astra`, reasoning effort `low`, the same instructions and synthetic sources for all variants.

- Selection explanation: all three answers quoted the expected four-token proposal correctly.
- Unavailable figure error bars: all three acknowledged that exact values were absent from the text.
- Cross-paper timing comparison: all three declined a controlled ranking. Only whole-paper supplied the explicit different-machine caveat and both batch sizes. The two narrowed inputs omitted that evidence; their answers could only describe unavailable conditions.

Successful elapsed times ranged from 5.80 to 11.25 seconds. With only three observations per variant, percentile estimates would be unstable and are not used to claim a speed improvement. Nine exit-zero responses establish a real CLI round trip on these synthetic requests; they do not prove Zotero UI behavior or all provider support.

## Decisions

- **Selection-only fast path: reject as default.** It did not improve quote containment in this set. Keep selection/nearby context and full-paper fallback available.
- **Question-specific reranking/evidence packet: keep experimental.** One additional quote is insufficient evidence for adoption, and the cross-paper caveat still disappeared. Do not add a model summarization pass, server or embedding database on this result.
- **Figure enrichment: no automatic vision claim.** Caption-only context can describe a trend but cannot supply absent coordinates or error bars. The runtime distinguishes text-only input from an explicitly supplied image; an empty `figures/` directory does not establish image delivery. The [actual caption-versus-image probe](./evaluations/chat-context-figure.json) ran two Codex requests with the same synthetic question. Caption-only correctly abstained; an explicit `--image` attachment returned the labeled `0.70 ± 0.08` values (5.69 / 5.84 seconds). This supports the value of actual image input, but does not establish automatic Zotero figure extraction or cross-provider vision support.

The next adoption gate is a licensed real-paper set with independent quality labels, repeated provider/model runs, exact source navigation checks, and preparation/first-answer/total timings collected in Zotero. This remains an evaluation gate for a future algorithm change; the current release includes the reproducible experiment and retains the complete admitted paper context.

## Figure probe reproduction

```sh
PAPERPILOT_EVAL_MODEL=<supported-model> node scripts/evaluate-chat-context.mjs --figure --out /tmp/chat-context-figure.json
```

The checked-in [synthetic plot](../test/fixtures/chat-evaluation/figure-2.png) is CC0 like the text corpus. Its source is [render-chat-evaluation-figure.py](../scripts/render-chat-evaluation-figure.py); regeneration optionally needs Python with matplotlib. The probe attaches that actual PNG for one request and no image for the other. A text-only selection or annotation does not automatically execute this enrichment experiment in the product.
