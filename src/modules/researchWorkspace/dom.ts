const HTML_NS = "http://www.w3.org/1999/xhtml";

export function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  text?: string,
) {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  doc: Document,
  label: string,
  action: (node: HTMLButtonElement) => unknown | Promise<unknown>,
  className = "pprw-button pp-btn pp-btn--secondary",
) {
  const node = element(doc, "button", className, label);
  node.type = "button";
  node.addEventListener("click", () => void action(node));
  return node;
}

export function metric(
  doc: Document,
  options: { className: string; label: string; value: string },
) {
  const node = element(doc, "div", options.className);
  node.append(
    element(doc, "strong", "", options.value),
    element(doc, "span", "", options.label),
  );
  return node;
}
