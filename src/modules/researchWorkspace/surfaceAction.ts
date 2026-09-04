export interface ResearchWorkspaceBusySurface {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface ResearchWorkspaceActionTrigger {
  disabled: boolean;
}

const activeSurfaces = new WeakSet<object>();

export async function runResearchWorkspaceSurfaceAction(params: {
  surface: ResearchWorkspaceBusySurface;
  trigger: ResearchWorkspaceActionTrigger;
  action: () => void | Promise<void>;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  const surfaceKey = params.surface as object;
  if (activeSurfaces.has(surfaceKey)) return false;

  activeSurfaces.add(surfaceKey);
  const initiallyDisabled = params.trigger.disabled;
  params.trigger.disabled = true;
  params.surface.setAttribute("aria-busy", "true");
  try {
    await params.action();
    return true;
  } catch (error) {
    params.onError(error);
    return false;
  } finally {
    activeSurfaces.delete(surfaceKey);
    params.surface.removeAttribute("aria-busy");
    params.trigger.disabled = initiallyDisabled;
  }
}

export async function replaceResearchWorkspaceDialogAfterCreate<
  T extends { window?: { close(): void } },
>(current: T | undefined, create: () => Promise<T>): Promise<T> {
  const replacement = await create();
  if (current && current !== replacement) current.window?.close();
  return replacement;
}
