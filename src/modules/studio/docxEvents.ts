/** Selection and imported review bubbles do not change the saved document. */
export function isCommentMutation(event: { type?: string; comment?: unknown }) {
  return (
    ["new", "add", "update", "resolved", "deleted"].includes(
      event.type ?? "",
    ) &&
    !(event.comment as { trackedChange?: boolean } | undefined)?.trackedChange
  );
}
