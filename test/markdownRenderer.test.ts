import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderInlineMarkdown,
  renderMarkdownFragment,
} from "../src/modules/components/markdownRenderer";

class FakeElement {
  children: FakeElement[] = [];
  className = "";
  private value = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  set textContent(value: string) {
    this.value = value;
    this.children = [];
  }

  get textContent(): string {
    return this.children.length
      ? this.children.map((child) => child.textContent).join("")
      : this.value;
  }

  attributes = new Map<string, string>();
  html = "";

  set innerHTML(value: string) {
    if (this.ownerDocument.rejectsMarkup)
      throw new SyntaxError("not well-formed XML");
    this.html = value;
    this.value = value.replace(/<[^>]+>/g, "");
    this.children = [];
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  /** Public-source anchors parsed from innerHTML, for click wiring tests. */
  anchors: FakeAnchor[] = [];

  querySelectorAll(selector: string): FakeAnchor[] {
    if (selector !== "a.pp-public-source") return [];
    const own = [
      ...this.html.matchAll(/<a href="([^"]*)" class="pp-public-source"/g),
    ].map((match) => match[1].replace(/&amp;/g, "&"));
    if (own.length && !this.anchors.length)
      this.anchors = own.map((href) => new FakeAnchor(href));
    return [
      ...this.anchors,
      ...this.children.flatMap((child) => child.querySelectorAll(selector)),
    ];
  }
}

class FakeAnchor {
  listeners: Array<(event: { preventDefault(): void }) => void> = [];
  constructor(readonly href: string) {}
  getAttribute(name: string) {
    return name === "href" ? this.href : null;
  }
  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => void,
  ) {
    if (type === "click") this.listeners.push(listener);
  }
}

class FakeDocument {
  /** Mirrors the XHTML pane, whose fragment parser throws on bad markup. */
  constructor(readonly rejectsMarkup = false) {}

  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    return new FakeElement("#fragment", this);
  }
}

function descendants(root: FakeElement, tagName: string): FakeElement[] {
  return root.children.flatMap((child) => [
    ...(child.tagName === tagName ? [child] : []),
    ...descendants(child, tagName),
  ]);
}

function render(text: string) {
  const doc = new FakeDocument();
  return renderMarkdownFragment(
    text,
    doc as unknown as Document,
  ) as unknown as FakeElement;
}

test("Markdown tables skip each separator row without dropping data rows", () => {
  const fragment = render(
    "| Name | Value |\n| --- | --- |\n| alpha | one |\n| --- | --- |\n| beta | two |",
  );
  const bodies = descendants(fragment, "tbody");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].children.length, 2);
  assert.match(bodies[0].textContent, /alphaone/);
  assert.match(bodies[0].textContent, /betatwo/);
});

test("Markdown only treats exact math and code markers as block openers", () => {
  const fragment = render(
    "$$x$$ is displayed, then prose\n\n```ts trailing prose\nStill visible",
  );
  assert.equal(descendants(fragment, "pre").length, 0);
  assert.equal(descendants(fragment, "div").length, 0);
  assert.match(fragment.textContent, /\$\$x\$\$ is displayed, then prose/);
  assert.match(fragment.textContent, /```ts trailing prose/);
  assert.match(fragment.textContent, /Still visible/);
});

test("Markdown preserves headings, blockquotes, fenced code, and nested-list text", () => {
  const fragment = render(
    "# Heading\n\n> Quoted evidence\n\n- parent\n  - nested\n\n```ts\nconst answer = 42;\n```",
  );
  assert.equal(descendants(fragment, "h1").length, 1);
  assert.equal(descendants(fragment, "blockquote").length, 1);
  assert.equal(descendants(fragment, "li").length, 2);
  assert.equal(descendants(fragment, "pre").length, 1);
  assert.match(fragment.textContent, /nested/);
  assert.match(fragment.textContent, /const answer = 42;/);
});

test("inline math does not consume currency ranges", () => {
  const rendered = renderInlineMarkdown(
    "It costs $5 and $10 per unit, while $x + 1$ is math.",
  );
  assert.match(rendered, /It costs \$5 and \$10 per unit/);
  assert.match(rendered, /<math/);
  assert.doesNotMatch(rendered, /\$x \+ 1\$/);
});

test("Markdown strips input control characters without accepting literal placeholders", () => {
  const rendered = renderInlineMarkdown(
    "before\u0000MATH0\u0007 after and $x$",
  );
  assert.match(rendered, /beforeMATH0 after/);
  assert.equal(rendered.includes(String.fromCharCode(7)), false);
});

function hrefs(rendered: string) {
  return [...rendered.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

test("math or code next to a URL never lands inside an href attribute", () => {
  for (const text of [
    "（https://arxiv.org/abs/2106.09685）中的$W_0$",
    "See https://example.org/a$W_0$ now",
    "[paper](https://example.org/$x$) and `https://example.org/`code``",
  ]) {
    const rendered = renderInlineMarkdown(text);
    for (const href of hrefs(rendered)) {
      assert.doesNotMatch(href, /[<>]|PLACEHOLDER/, `${text} -> ${href}`);
    }
  }
});

test("bare URLs stop before adjacent text, quotes, markup, and unbalanced brackets", () => {
  assert.deepEqual(
    hrefs(
      renderInlineMarkdown("https://arxiv.org/abs/2106.09685에서 확인하세요"),
    ),
    ["https://arxiv.org/abs/2106.09685"],
  );
  assert.deepEqual(
    hrefs(renderInlineMarkdown("(code: https://github.com/microsoft/LoRA)")),
    ["https://github.com/microsoft/LoRA"],
  );
  const bold = renderInlineMarkdown("**https://example.org/a**");
  assert.deepEqual(hrefs(bold), ["https://example.org/a"]);
  assert.match(bold, /<strong><a /);
  assert.deepEqual(
    hrefs(
      renderInlineMarkdown(
        "[wiki](https://en.wikipedia.org/wiki/Mean_(statistics))",
      ),
    ),
    ["https://en.wikipedia.org/wiki/Mean_(statistics)"],
  );
});

test("model-authored link labels are escaped before innerHTML", () => {
  const rendered = renderInlineMarkdown(
    '[<img src=x onerror="alert(1)">](https://example.org/)',
  );
  assert.match(rendered, /<a href="https:\/\/example\.org\/"/);
  assert.match(rendered, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(rendered, /<img/);
});

test("math syntax inside inline code stays literal", () => {
  const rendered = renderInlineMarkdown("use `$\\alpha$` to write alpha");
  assert.match(rendered, /<code>\$\\alpha\$<\/code>/);
  assert.doesNotMatch(rendered, /<math/);
});

test("markup the XHTML parser rejects falls back to the source text", () => {
  const doc = new FakeDocument(true);
  const fragment = renderMarkdownFragment(
    "A paragraph with $x$\n\n- an item",
    doc as unknown as Document,
  ) as unknown as FakeElement;
  assert.match(fragment.textContent, /A paragraph with \$x\$/);
  assert.match(fragment.textContent, /an item/);
});

test("display math keeps text after its closer and an unclosed block stays text", () => {
  const closed = render("$$\nx^2\n$$ so the area grows");
  assert.equal(descendants(closed, "div").length, 1);
  assert.match(descendants(closed, "p")[0].textContent, /so the area grows/);

  const unclosed = render("$$\nx^2\n\nThe rest of the answer.");
  assert.equal(descendants(unclosed, "div").length, 0);
  assert.match(unclosed.textContent, /The rest of the answer\./);
});

test("numbered lists keep their numbering across sub-bullets and blank lines", () => {
  const fragment = render(
    "1. Data\n   - CIFAR-10\n2. Model\n\n3. Metric\n   - accuracy",
  );
  const lists = descendants(fragment, "ol");
  assert.equal(lists.length, 1);
  assert.equal(lists[0].children.length, 3);
  assert.equal(descendants(lists[0], "ul").length, 2);

  const continued = descendants(render("3. Third\n4. Fourth"), "ol");
  assert.equal(continued[0].attributes.get("start"), "3");
});

test("table cells split only on pipes outside code and math", () => {
  const fragment = render(
    "| Term | Value |\n| --- | --- |\n| `a|b` | $\\|w\\|_2$ |\n| x \\| y | z |",
  );
  const rows = descendants(descendants(fragment, "tbody")[0], "tr");
  assert.deepEqual(
    rows.map((row) => row.children.length),
    [2, 2],
  );
  assert.match(rows[1].children[0].textContent, /x \| y/);
});

test("every rendered public link opens externally on click, once", () => {
  const globals = globalThis as typeof globalThis & { Zotero?: unknown };
  const previous = globals.Zotero;
  const launched: string[] = [];
  (globalThis as Record<string, unknown>).Zotero = {
    launchURL: (url: string) => launched.push(url),
  };
  try {
    const fragment = render("See [the paper](https://example.org/paper).");
    const [anchor] = fragment.querySelectorAll("a.pp-public-source");
    assert.ok(anchor);
    assert.equal(anchor.listeners.length, 1);
    let prevented = false;
    anchor.listeners[0]({
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.deepEqual(launched, ["https://example.org/paper"]);
  } finally {
    globals.Zotero = previous;
  }
});

test("a bare URL followed by thousands of brackets renders in linear time", () => {
  const started = Date.now();
  const html = renderInlineMarkdown(
    `https://example.org/${")".repeat(32_000)}`,
  );
  assert.ok(Date.now() - started < 500, "trimming must stay linear");
  assert.match(html, /href="https:\/\/example\.org\/"/);
  assert.match(
    renderInlineMarkdown("See (https://example.org/a_(b)) now."),
    /href="https:\/\/example\.org\/a_\(b\)"/,
  );
});
