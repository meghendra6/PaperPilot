/**
 * Keeps unsaved panel choices and keyboard focus across a project rebuild.
 * Controls are matched by a stable key, never by position alone.
 */
const dirtyTrackedRoots = new WeakSet<HTMLElement>();

/** Marks text a reader typed, so a panel rebuild can keep it. */
export function trackDirtyInputs(root: HTMLElement) {
  if (dirtyTrackedRoots.has(root)) return;
  dirtyTrackedRoots.add(root);
  // Text fields, selects (a screening decision), and checkboxes (the
  // analysis scope) all hold unsaved choices.
  const markDirty = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "INPUT" ||
      target?.tagName === "SELECT"
    )
      target.dataset.dirty = "true";
  };
  root.addEventListener("input", markDirty);
  root.addEventListener("change", markDirty);
}

function isToggle(node: HTMLElement) {
  const type = (node as HTMLInputElement).type;
  return node.tagName === "INPUT" && (type === "checkbox" || type === "radio");
}

interface KeyedControl {
  node: HTMLElement;
  key: string;
  index: number;
}

/**
 * Panel controls with a stable key: panel heading, tag, and label, plus
 * the position among equal keys (one "Record decision" per paper row).
 */
function keyedControls(root: HTMLElement, operations: HTMLElement) {
  const counts = new Map<string, number>();
  const controls: KeyedControl[] = [];
  const nodes = Array.from(
    root.querySelectorAll("button, input, textarea, select, summary"),
  ) as HTMLElement[];
  for (const node of nodes) {
    if (operations.contains(node)) continue;
    // A source control carries a stable key of source ID and purpose.
    if (node.dataset.restoreKey) {
      controls.push({ node, key: `key:${node.dataset.restoreKey}`, index: 0 });
      continue;
    }
    // A checkbox is named by its wrapping label; a select by its aria-label.
    const label =
      node.getAttribute("aria-label") ||
      (node as HTMLInputElement).placeholder ||
      (isToggle(node)
        ? node.closest("label")?.textContent?.trim()
        : node.textContent?.trim()) ||
      "";
    if (!label) continue;
    const heading =
      node.closest("section")?.querySelector("h3, h2")?.textContent?.trim() ??
      "";
    const key = `${heading}|${node.tagName}|${label}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    controls.push({ node, key, index });
  }
  return controls;
}

export function captureSurfaceState(
  root: HTMLElement,
  operations: HTMLElement,
) {
  const active = root.ownerDocument.activeElement;
  const controls = keyedControls(root, operations);
  const focused = controls.find((entry) => entry.node === active);
  return {
    focused: focused && { key: focused.key, index: focused.index },
    focusWasInPanels: Boolean(
      active && root.contains(active) && !operations.contains(active),
    ),
    dirty: controls
      .filter(
        (entry) =>
          entry.node.dataset.dirty === "true" &&
          (entry.node as HTMLInputElement).type !== "file",
      )
      .map((entry) => ({
        key: entry.key,
        index: entry.index,
        toggle: isToggle(entry.node),
        value: (entry.node as HTMLInputElement).value,
        checked: Boolean((entry.node as HTMLInputElement).checked),
      })),
  };
}

export function restoreSurfaceState(
  root: HTMLElement,
  operations: HTMLElement,
  state: ReturnType<typeof captureSurfaceState>,
) {
  const controls = keyedControls(root, operations);
  const find = (key: string, index: number) =>
    controls.find((entry) => entry.key === key && entry.index === index)?.node;
  // Values are restored without events, so no change handler (such as an
  // autosave) runs for a choice the reader has not confirmed.
  for (const entry of state.dirty) {
    const node = find(entry.key, entry.index) as
      | HTMLInputElement
      | HTMLSelectElement
      | undefined;
    if (!node) continue;
    if (entry.toggle) {
      if (isToggle(node) && !(node as HTMLInputElement).disabled)
        (node as HTMLInputElement).checked = entry.checked;
    } else if (node.tagName === "SELECT") {
      const select = node as HTMLSelectElement;
      if (
        (Array.from(select.options) as HTMLOptionElement[]).some(
          (option) => option.value === entry.value,
        )
      ) {
        select.value = entry.value;
        // Filters render their result in the change handler, which has no
        // side effects, so it runs again for the restored value.
        const EventClass = root.ownerDocument.defaultView?.Event;
        if (select.dataset.restoreRefresh === "true" && EventClass)
          select.dispatchEvent(new EventClass("change"));
      }
    } else if (node.value !== entry.value) {
      node.value = entry.value;
    }
    node.dataset.dirty = "true";
  }
  if (!state.focusWasInPanels) return;
  const target = state.focused
    ? (find(state.focused.key, state.focused.index) as
        | HTMLButtonElement
        | undefined)
    : undefined;
  if (target && !target.disabled) {
    target.focus();
    return;
  }
  // The control is gone (a row was resolved), so focus the status line.
  root.querySelector<HTMLElement>("[data-project-message]")?.focus();
}
