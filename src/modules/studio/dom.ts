export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export interface TextSurface {
  text(): string;
  selectedText(): string;
  insert(text: string): void;
  canNavigate?(): boolean;
  destroy(): void;
}
