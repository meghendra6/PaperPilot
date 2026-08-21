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
