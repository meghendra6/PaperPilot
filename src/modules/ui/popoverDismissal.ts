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
