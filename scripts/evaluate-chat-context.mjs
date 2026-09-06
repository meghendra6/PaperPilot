/* Offline context evaluation; optional live runs use the user's authenticated CLI. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
require("ts-node/register/transpile-only");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");
const {
  selectRelevantChunksFromChunks,
  tokenizeRetrievalText,
} = require("../src/modules/context/retriever");
const corpus = require("../test/fixtures/chat-evaluation/corpus.json");
const variants = [
  "current-keyword",
  "selection-nearby",
  "evidence-packet",
  "whole-paper",
];
function paragraphs(source) {
  return source.text.split(/(?<=[.!?])\s+/u).map((s) => s.trim());
}
function packet(fixture, variant) {
  return corpus.sources
    .filter((source) => fixture.sourceIDs.includes(source.sourceID))
    .map((source) => {
      const chunks = paragraphs(source);
      const query = [
        fixture.question,
        fixture.selectedText,
        ...fixture.priorTurns.map((turn) => turn.text),
      ]
        .filter(Boolean)
        .join(" ");
      let selected;
      if (variant === "whole-paper") selected = chunks;
      else if (variant === "current-keyword")
        selected = selectRelevantChunksFromChunks(chunks, query, 3);
      else if (variant === "selection-nearby" && fixture.selectedText) {
        const index = chunks.findIndex((chunk) =>
          chunk.includes(fixture.selectedText),
        );
        selected =
          index < 0
            ? selectRelevantChunksFromChunks(chunks, query, 3)
            : chunks.slice(Math.max(0, index - 1), index + 2);
      } else if (variant === "selection-nearby")
        selected = selectRelevantChunksFromChunks(chunks, query, 3);
      else {
        const tokens = new Set(tokenizeRetrievalText(query));
        selected = chunks
          .map((text, index) => ({
            text,
            index,
            score:
              new Set(
                tokenizeRetrievalText(text).filter((token) =>
                  tokens.has(token),
                ),
              ).size /
                Math.sqrt(Math.max(1, tokenizeRetrievalText(text).length)) +
              (fixture.selectedText && text.includes(fixture.selectedText)
                ? 2
                : 0),
          }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, 3)
          .map((entry) => entry.text);
      }
      return {
        sourceID: source.sourceID,
        text: selected.join("\n"),
        imageInput: "text-only",
      };
    });
}
function percentile(values, ratio) {
  return (
    [...values].sort((a, b) => a - b)[
      Math.max(0, Math.ceil(values.length * ratio) - 1)
    ] ?? 0
  );
}
function evaluate() {
  const rows = corpus.fixtures.flatMap((fixture) =>
    variants.map((variant) => {
      const times = [];
      let input;
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        input = packet(fixture, variant);
        times.push(performance.now() - start);
      }
      const matches = fixture.expectedQuotes.filter((expected) =>
        input.some(
          (source) =>
            source.sourceID === expected.sourceID &&
            source.text.includes(expected.quote),
        ),
      ).length;
      return {
        fixtureID: fixture.id,
        scenario: fixture.scenario,
        variant,
        quoteCount: fixture.expectedQuotes.length,
        quotesIncluded: matches,
        sourceMismatch: input.filter(
          (source) => !fixture.sourceIDs.includes(source.sourceID),
        ).length,
        chars: JSON.stringify(input).length,
        buildMs: percentile(times, 0.5),
        imageInput: "text-only",
      };
    }),
  );
  return {
    schemaVersion: 1,
    corpusLicense: corpus.license,
    corpusKind: "authored synthetic; not real paper accuracy",
    measurement:
      "Offline context construction and exact expected-quote containment; not model answer quality or full CLI latency",
    fixtureCount: corpus.fixtures.length,
    variants: variants.map((variant) => {
      const r = rows.filter((row) => row.variant === variant);
      return {
        variant,
        sourceMismatches: r.reduce((n, row) => n + row.sourceMismatch, 0),
        expectedQuotes: r.reduce((n, row) => n + row.quoteCount, 0),
        includedQuotes: r.reduce((n, row) => n + row.quotesIncluded, 0),
        meanChars: Math.round(
          r.reduce((n, row) => n + row.chars, 0) / r.length,
        ),
        buildP50Ms: percentile(
          r.map((row) => row.buildMs),
          0.5,
        ),
        buildP95Ms: percentile(
          r.map((row) => row.buildMs),
          0.95,
        ),
      };
    }),
    rows,
  };
}
function live(output) {
  const records = [];
  const cliVersion = spawnSync("codex", ["--version"], {
    encoding: "utf8",
  }).stdout.trim();
  const model = process.env.PAPERPILOT_EVAL_MODEL;
  if (!model)
    throw new Error(
      "Set PAPERPILOT_EVAL_MODEL to a model supported by your local account.",
    );
  // Fixed representative questions; equal source fixture/model/instructions across variants.
  for (const id of ["chat-eval-01", "chat-eval-22", "chat-eval-24"])
    for (const variant of [
      "current-keyword",
      "evidence-packet",
      "whole-paper",
    ]) {
      const fixture = corpus.fixtures.find((entry) => entry.id === id);
      const prompt = `Answer only from the supplied synthetic research text. Do not use tools or external sources. If requested evidence is unavailable, explicitly say so. Return plain text under 150 words, quote exact support and name its source ID.\nQuestion: ${fixture.question}\nInputs: ${JSON.stringify(packet(fixture, variant))}`;
      const start = performance.now();
      const result = spawnSync(
        "codex",
        [
          "exec",
          "--ignore-user-config",
          "--ephemeral",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--model",
          model,
          "-c",
          'model_reasoning_effort="low"',
          "-",
        ],
        {
          input: prompt,
          cwd: process.env.TMPDIR || "/tmp",
          encoding: "utf8",
          timeout: 180000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      const events = result.stdout.split("\n").flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      const answer = events
        .filter(
          (event) =>
            event.type === "item.completed" &&
            event.item?.type === "agent_message",
        )
        .map((event) => event.item.text)
        .join("\n");
      records.push({
        fixtureID: id,
        variant,
        model,
        cliVersion,
        exitCode: result.status,
        elapsedMs: performance.now() - start,
        answer,
        usage: events.findLast((event) => event.type === "turn.completed")
          ?.usage,
        error:
          result.error?.code ||
          (result.status ? "CLI failed; inspect local diagnostics" : undefined),
      });
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            kind: "live synthetic sample; no automatic correctness scoring",
            records,
          },
          null,
          2,
        ) + "\n",
      );
      process.stderr.write(
        `${id} ${variant}: exit ${result.status}, ${Math.round((performance.now() - start) / 1000)}s\n`,
      );
    }
}
function evaluateFigure(output) {
  const model = process.env.PAPERPILOT_EVAL_MODEL;
  if (!model)
    throw new Error(
      "Set PAPERPILOT_EVAL_MODEL before a live figure evaluation.",
    );
  const imagePath = fileURLToPath(
    new URL("../test/fixtures/chat-evaluation/figure-2.png", import.meta.url),
  );
  const records = [];
  for (const imageSupplied of [false, true]) {
    const start = performance.now();
    const args = [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      model,
      "-c",
      'model_reasoning_effort="low"',
      ...(imageSupplied ? ["--image", imagePath] : []),
      "-",
    ];
    const prompt =
      "Use only the supplied synthetic CC0 figure/caption. Do not use tools. Caption: acceptance decreases as temperature increases; the text export has no point coordinates or error bars. Question: At temperature 0.5, what are the acceptance rate and error bar? If no image is supplied, state that the exact values cannot be recovered. Return under 80 words.";
    const result = spawnSync("codex", args, {
      input: prompt,
      cwd: process.env.TMPDIR || "/tmp",
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const events = result.stdout.split("\n").flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    records.push({
      model,
      imageSupplied,
      expected: imageSupplied ? "0.70 +/- 0.08" : "unavailable from caption",
      exitCode: result.status,
      elapsedMs: performance.now() - start,
      answer: events
        .filter(
          (event) =>
            event.type === "item.completed" &&
            event.item?.type === "agent_message",
        )
        .map((event) => event.item.text)
        .join("\n"),
    });
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          kind: "Actual Codex --image versus caption-only synthetic figure probe; not automated Zotero figure extraction",
          records,
        },
        null,
        2,
      ) + "\n",
    );
    process.stderr.write(
      `figure image=${imageSupplied}: exit ${result.status}\n`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arg = process.argv.indexOf("--out");
  const output = arg >= 0 ? path.resolve(process.argv[arg + 1]) : undefined;
  if (process.argv.includes("--figure")) {
    if (!output) throw new Error("--figure requires --out");
    evaluateFigure(output);
  } else if (process.argv.includes("--live")) {
    if (!output) throw new Error("--live requires --out");
    live(output);
  } else {
    const result = evaluate();
    if (output)
      fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    else process.stdout.write(JSON.stringify(result.variants, null, 2) + "\n");
  }
}
export { packet, evaluate, corpus };
