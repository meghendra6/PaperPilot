/**
 * A preparation failure whose message already tells the reader how to
 * recover (move a file, start a new conversation, recapture the PDF). The run
 * card shows that message instead of the generic workspace-permission text,
 * which points at settings that cannot fix these conditions.
 */
export class WorkspacePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePreparationError";
  }
}

/** Matches by name, so errors from another realm are recognized too. */
export function isWorkspacePreparationError(
  error: unknown,
): error is WorkspacePreparationError {
  return (
    (error as { name?: unknown } | null)?.name === "WorkspacePreparationError"
  );
}
