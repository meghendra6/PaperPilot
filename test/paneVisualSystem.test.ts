import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

const css = readFileSync(
  join(process.cwd(), "addon", "chrome", "content", "zoteroPane.css"),
  "utf8",
);

type Theme = "light" | "dark";
type RGB = [number, number, number];

// Zotero 10 theme values the pane inherits at runtime.
const ZOTERO_THEME: Record<Theme, Record<string, string>> = {
  light: {
    "--material-sidepane": "#f2f2f2",
    "--material-background": "#ffffff",
    "--color-invalid": "#b81d29",
    "--color-invalid-background": "#fce8ea",
    "--accent-blue": "#4072e5",
  },
  dark: {
    "--material-sidepane": "#303030",
    "--material-background": "#1e1e1e",
    "--color-invalid": "#ff7078",
    "--color-invalid-background": "#40191c",
    "--accent-blue": "#4072e5",
  },
};

function blockBody(source: string, openBrace: number) {
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0)
      return source.slice(openBrace + 1, index);
  }
  throw new Error("Unbalanced CSS block");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bodies of every rule whose selector list ends with `selector`. */
function ruleBodies(selector: string, source = css) {
  const pattern = new RegExp(
    `(?:^|\\n)[ \\t]*${escapeRegExp(selector)}\\s*\\{`,
    "g",
  );
  return Array.from(source.matchAll(pattern), (match) =>
    blockBody(source, (match.index ?? 0) + match[0].length - 1),
  );
}

function rule(selector: string) {
  const bodies = ruleBodies(selector);
  assert.ok(bodies.length, `missing CSS rule for ${selector}`);
  return bodies.join("\n");
}

function mediaBodies(query: string) {
  return ruleBodies(`@media ${query}`);
}

function declarations(body: string) {
  return new Map(
    Array.from(
      body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
      (match) => [match[1], match[2].trim()] as const,
    ),
  );
}

const lightTokens = declarations(ruleBodies(":root")[0]);
const darkTokens = new Map([
  ...lightTokens,
  ...declarations(
    ruleBodies(":root", mediaBodies("(prefers-color-scheme: dark)")[0])[0],
  ),
]);

function hex(value: string): RGB {
  const digits = value.replace("#", "");
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return [0, 2, 4].map((offset) =>
    Number.parseInt(full.slice(offset, offset + 2), 16),
  ) as RGB;
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    if (value[index] === ")") depth--;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

/**
 * Resolves a token to a color. `useZotero` picks Zotero's runtime values;
 * otherwise only the stylesheet fallbacks apply.
 */
function resolveColor(value: string, theme: Theme, useZotero = true): RGB {
  const tokens = theme === "light" ? lightTokens : darkTokens;
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return hex(trimmed);
  const variable = trimmed.match(/^var\((--[\w-]+)(?:,\s*([\s\S]+))?\)$/);
  if (variable) {
    const [, name, fallback] = variable;
    const token = tokens.get(name);
    if (token !== undefined) return resolveColor(token, theme, useZotero);
    if (useZotero && ZOTERO_THEME[theme][name])
      return hex(ZOTERO_THEME[theme][name]);
    assert.ok(fallback, `${name} has no fallback`);
    return resolveColor(fallback, theme, useZotero);
  }
  const mix = trimmed.match(/^color-mix\(in srgb,\s*([\s\S]+)\)$/);
  if (mix) {
    const [first, second] = splitTopLevel(mix[1]);
    const weighted = first.match(/^([\s\S]+?)\s+(\d+(?:\.\d+)?)%$/);
    assert.ok(weighted, `unsupported color-mix: ${trimmed}`);
    const ratio = Number(weighted[2]) / 100;
    const a = resolveColor(weighted[1], theme, useZotero);
    const b = resolveColor(second, theme, useZotero);
    return a.map((channel, index) =>
      Math.round(channel * ratio + b[index] * (1 - ratio)),
    ) as RGB;
  }
  throw new Error(`Cannot resolve color ${trimmed}`);
}

function luminance([r, g, b]: RGB) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: RGB, b: RGB) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function assertContrast(
  foreground: string,
  background: string,
  minimum: number,
) {
  for (const theme of ["light", "dark"] as const) {
    for (const useZotero of [true, false]) {
      const ratio = contrast(
        resolveColor(foreground, theme, useZotero),
        resolveColor(background, theme, useZotero),
      );
      assert.ok(
        ratio >= minimum,
        `${foreground} on ${background} is ${ratio.toFixed(2)}:1 in ${theme} (${useZotero ? "Zotero" : "fallback"})`,
      );
    }
  }
}

test("status tokens are defined for both light and dark themes", () => {
  const darkOnly = declarations(
    ruleBodies(":root", mediaBodies("(prefers-color-scheme: dark)")[0])[0],
  );
  for (const token of ["--pp-error", "--pp-warning", "--pp-success"]) {
    assert.ok(lightTokens.has(token), `light theme lacks ${token}`);
    assert.ok(darkOnly.has(token), `dark theme lacks ${token}`);
  }
  assert.doesNotMatch(css, /var\(--pp-(error|warning|success),/);
});

test("status colors stay readable on the pane in both themes", () => {
  for (const token of ["--pp-error", "--pp-warning", "--pp-success"]) {
    assertContrast(`var(${token})`, "var(--pp-bg-primary)", 4.5);
    assertContrast(`var(${token})`, "var(--pp-bg-secondary)", 4.5);
  }
  assertContrast("var(--pp-error)", "var(--pp-bg-status-error)", 4.5);
  assert.match(
    rule('.pprw-status[data-kind="error"]'),
    /background: var\(--pp-bg-status-error\);/,
  );
  assert.doesNotMatch(css, /#4caf50|#ff9800|#e53935|#c62828/i);
});

test("muted metadata text reaches 4.5:1 on the light pane", () => {
  for (const token of [
    "--pp-text-artifact-time",
    "--pp-text-recommendation-meta",
  ]) {
    assertContrast(`var(${token})`, "var(--pp-bg-primary)", 4.5);
  }
  assert.match(
    rule(".pp-artifact-card__evidence"),
    /font-size: var\(--pp-font-size-xs\);/,
  );
});

test("focus ring is a fixed 2px offset outline that contrasts with the pane", () => {
  assert.equal(lightTokens.get("--pp-focus-width"), "2px");
  assert.equal(lightTokens.get("--pp-focus-offset"), "2px");
  assertContrast("var(--pp-focus-color)", "var(--pp-bg-primary)", 3);
  const focus = rule(
    "#paper-pilot-container\n  :is(button, input, select, textarea, summary):focus-visible",
  );
  assert.match(
    focus,
    /outline: var\(--pp-focus-width\) solid var\(--pp-focus-color\);/,
  );
  assert.match(focus, /outline-offset: var\(--pp-focus-offset\);/);
  assert.doesNotMatch(css, /-moz-platform: windows/);
});

test("primary buttons follow the accent token and keep readable text", () => {
  const primary = rule(".pp-btn--primary");
  assert.match(primary, /background: var\(--pp-accent-fill\);/);
  assert.match(primary, /color: var\(--pp-on-accent\);/);
  assert.match(lightTokens.get("--pp-accent-fill") ?? "", /var\(--pp-accent\)/);
  assert.doesNotMatch(primary, /#2563eb/i);
  for (const fill of [
    "--pp-accent-fill",
    "--pp-accent-fill-hover",
    "--pp-accent-fill-active",
  ])
    assertContrast("var(--pp-on-accent)", `var(${fill})`, 4.5);
});

test("reduced motion disables animations and transitions on every surface", () => {
  const reduced = mediaBodies("(prefers-reduced-motion: reduce)").join("\n");
  for (const root of [
    "#paper-pilot-container",
    ".paperpilot-research-workspace",
    ".paperpilot-research-workspace-document",
  ]) {
    assert.match(reduced, new RegExp(`${escapeRegExp(root)} \\*,`));
    assert.match(reduced, new RegExp(`${escapeRegExp(root)} \\*::before,`));
  }
  assert.match(reduced, /animation: none !important;/);
  assert.match(reduced, /transition: none !important;/);
  assert.match(
    reduced,
    /\.pp-btn:active:not\(:disabled\) \{\s*transform: none;/,
  );
  assert.doesNotMatch(
    rule(".pp-resize-handle::before"),
    /transition:[^;]*width/,
  );
});

test("run state keeps Retry visible and the transcript keeps its minimum", () => {
  const runState = rule(".pp-run-state");
  assert.match(runState, /flex: 0 0 auto;/);
  assert.match(runState, /max-height: 132px;/);
  assert.match(runState, /overflow-y: auto;/);
  assert.match(rule("#chat-messages"), /min-height: 96px;/);
});

test("a fully collapsed section stack shrinks to its triggers", () => {
  const collapsed = rule(
    "#paper-pilot-section-stack.pp-section-stack--all-collapsed",
  );
  assert.match(collapsed, /flex: 0 0 auto !important;/);
  assert.match(collapsed, /height: auto !important;/);
  assert.match(collapsed, /min-height: 0;/);
  assert.match(
    rule(
      "#paper-pilot-section-stack.pp-section-stack--all-collapsed\n  + .pp-resize-handle--workspace",
    ),
    /display: none;/,
  );
});

test("citation chips are compact inline controls with a 24px target", () => {
  const chip = rule(".pp-btn.pp-citation");
  assert.match(chip, /min-height: 0;/);
  assert.match(chip, /min-width: 0;/);
  assert.match(chip, /display: inline-block;/);
  assert.match(chip, /line-height: 18px;/);
  assert.match(rule(".pp-btn.pp-citation::after"), /inset: -2px 0;/);
  assert.match(
    rule(".pp-btn.pp-citation.pp-citation--unavailable"),
    /cursor: help;/,
  );
});

test("wide math and tables scroll inside the answer", () => {
  const table = rule(".pp-table");
  assert.match(table, /table-layout: auto;/);
  assert.match(table, /overflow-wrap: normal;/);
  assert.match(table, /overflow-x: auto;/);
  const math = rule(".pp-message--ai :not(.pp-math-block) > .katex");
  assert.match(math, /max-width: 100%;/);
  assert.match(math, /overflow-x: auto;/);
});

test("mastery dots keep a 10px mark inside a 24px target", () => {
  const dot = rule(".pp-mastery-progress-dot");
  assert.match(dot, /width: 24px;/);
  assert.match(dot, /height: 24px;/);
  const mark = rule(".pp-mastery-progress-dot::before");
  assert.match(mark, /width: 10px;/);
  assert.match(mark, /height: 10px;/);
});

test("composer extras share one capped scrolling area", () => {
  const tools = rule(".pp-chat-tools");
  assert.match(tools, /max-height: min\(260px, 36vh\);/);
  assert.match(tools, /overflow-y: auto;/);
  const extras = rule(".pp-chat-tools > .pp-chat-review");
  assert.match(extras, /flex: 0 1 auto;/);
  assert.match(extras, /min-height: 0;/);
  assert.match(extras, /overflow-y: auto;/);
});

test("context status keeps warnings visible and diagnostics on one line", () => {
  const details = rule(".pp-chat-context-status__details");
  assert.match(details, /white-space: nowrap;/);
  assert.match(details, /text-overflow: ellipsis;/);
  assert.match(details, /overflow: hidden;/);
  const warning = rule(".pp-chat-context-status__warning");
  assert.match(warning, /color: var\(--pp-warning\);/);
  assert.doesNotMatch(warning, /nowrap/);
});

test("ghost hover tints the button instead of matching the pane", () => {
  assert.match(
    lightTokens.get("--pp-fill-hover") ?? "",
    /^color-mix\(in srgb, var\(--pp-text-primary\) \d+%, transparent\)$/,
  );
  const hover = rule(".pp-btn--ghost:hover:not(:disabled)");
  assert.match(
    hover,
    /background-image: linear-gradient\(\s*var\(--pp-fill-hover\),\s*var\(--pp-fill-hover\)\s*\);/,
  );
  assert.doesNotMatch(hover, /var\(--pp-bg-tertiary\)/);
});

test("chat chips read clearly at rest and when on", () => {
  const chips = rule(
    ".pp-chat-tools__bar .pp-btn,\n.pp-chat-tools__bar .pp-chat-length",
  );
  assert.match(chips, /border-radius: var\(--pp-radius-pill\);/);
  assert.match(chips, /background-color: var\(--pp-bg-button\);/);
  assert.match(chips, /color: var\(--pp-text-primary\);/);
  assertContrast("var(--pp-text-primary)", "var(--pp-bg-button)", 4.5);

  const on = rule(
    '.pp-chat-tools__bar .pp-btn[aria-expanded="true"],\n.pp-chat-commands .pp-btn[data-active="true"]',
  );
  assert.match(on, /background-color: var\(--pp-bg-accent\);/);
  assert.match(on, /color: var\(--pp-text-accent\);/);
  assertContrast("var(--pp-text-accent)", "var(--pp-bg-accent)", 4.5);
});

test("Send is the only filled chat control and Stop reads differently", () => {
  assert.match(rule("#chat-send"), /border-radius: var\(--pp-radius-pill\);/);
  const stop = rule('#chat-send[data-action="stop"]');
  assert.match(stop, /background: var\(--pp-bg-button\);/);
  assert.match(stop, /color: var\(--pp-text-primary\);/);
  const mark = rule('#chat-send[data-action="stop"]::before');
  assert.match(mark, /content: "";/);
  assert.match(mark, /background: currentColor;/);
});

test("Jump to latest floats without shifting the layout", () => {
  const jump = rule(".pp-chat-new-response");
  assert.match(jump, /height: 28px;/);
  assert.match(jump, /margin: -42px auto 14px;/);
  assert.match(jump, /color: var\(--pp-text-accent\);/);
  assertContrast("var(--pp-text-accent)", "var(--pp-bg-button)", 4.5);
});

test("message actions are quiet pills and More hides the default marker", () => {
  const quiet = rule(
    ".pp-message-footer .pp-btn,\n.pp-message-actions > summary",
  );
  assert.match(quiet, /border-radius: var\(--pp-radius-pill\);/);
  assert.match(quiet, /background-color: var\(--pp-fill-quiet\);/);
  assert.match(rule(".pp-message-actions > summary"), /list-style: none;/);
  assert.match(
    rule('.pp-message-copy[data-state="copied"]'),
    /color: var\(--pp-success\);/,
  );
});

test("chat and workspace selects keep Zotero's arrow image", () => {
  // Zotero draws the select arrow as a background image. The shorthand
  // `background:` would reset it to none.
  for (const selector of [
    ".pp-chat-tools select,\n.pp-chat-tools input,\n.pp-chat-tools textarea",
    ".pprw-select",
    ".pprw-input,\n.pprw-textarea",
  ]) {
    assert.doesNotMatch(rule(selector), /(^|\n)\s*background:/);
  }
  assert.match(rule("select.pprw-input"), /padding-inline-end: 32px;/);
  const length = rule(".pp-chat-tools__bar .pp-chat-length");
  assert.match(length, /padding-inline-end: 30px;/);
  assert.doesNotMatch(
    rule(".pp-chat-tools__bar .pp-chat-length:hover"),
    /background-image/,
  );
});
