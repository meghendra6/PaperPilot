export interface ResearchWorkspaceBusySurface {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface ResearchWorkspaceActionTrigger {
  disabled: boolean;
}

/** The running action on each surface, by label. */
const activeSurfaces = new WeakMap<object, string | undefined>();

export async function runResearchWorkspaceSurfaceAction(params: {
  surface: ResearchWorkspaceBusySurface;
  trigger: ResearchWorkspaceActionTrigger;
  action: () => void | Promise<void>;
  onError: (error: unknown) => void;
  /** Names this action when a later click has to wait for it. */
  label?: string;
  /** Receives the running action's label when this click cannot run. */
  onBusy?: (activeLabel: string | undefined) => void;
}): Promise<boolean> {
  const surfaceKey = params.surface as object;
  if (activeSurfaces.has(surfaceKey)) {
    params.onBusy?.(activeSurfaces.get(surfaceKey));
    return false;
  }

  activeSurfaces.set(surfaceKey, params.label);
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
