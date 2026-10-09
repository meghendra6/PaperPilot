export function shouldDismissPopover(root: HTMLElement, event: Event): boolean {
  const target = event.target as Node | null;
  const eventPath = event.composedPath?.() || [];
  const interactionInside =
    eventPath.includes(root) || Boolean(target && root.contains(target));
  return !interactionInside;
}

export function isNativeSelectInteraction(
  select: HTMLSelectElement,
  event: Event,
): boolean {
  const eventPath = event.composedPath?.() || [];
  if (event.target === select || eventPath.includes(select)) return true;
  return eventPath.some((entry) => {
    const id = (entry as { id?: unknown }).id;
    return (
      id === "ContentSelectDropdown" || id === "ContentSelectDropdownPopup"
    );
  });
}

// Zotero's native select popup retargets its final click to `main-window`.
// Preserve only that next click when the interaction began in one of the
// pickers and that picker still holds focus.
export function createNativeSelectClickGuard(
  selects: readonly HTMLSelectElement[],
) {
  let preserveNextClick = false;
  return {
    notePointerDown(event: Event) {
      preserveNextClick = selects.some((select) =>
        isNativeSelectInteraction(select, event),
      );
    },
    consumeClick(activeElement: Element | null): boolean {
      const preserve =
        preserveNextClick && selects.some((select) => select === activeElement);
      preserveNextClick = false;
      return preserve;
    },
  };
}

export function installPopoverDismissal(params: {
  doc: Document;
  getRoot: () => HTMLElement | undefined;
  dismiss: (restoreFocus: boolean) => void;
}) {
  const onDocumentClick = (event: MouseEvent) => {
    const root = params.getRoot();
    if (root && shouldDismissPopover(root, event)) params.dismiss(false);
  };
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!params.getRoot() || event.key !== "Escape") return;
    event.preventDefault();
    params.dismiss(true);
  };
  params.doc.addEventListener("click", onDocumentClick);
  params.doc.addEventListener("keydown", onDocumentKeyDown, true);
  return () => {
    params.doc.removeEventListener("click", onDocumentClick);
    params.doc.removeEventListener("keydown", onDocumentKeyDown, true);
  };
}
