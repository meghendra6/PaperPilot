export interface ResearchWorkspaceLivingReviewNotifierObserver {
  notify(
    event: string,
    type: string,
    ids: Array<string | number>,
    extraData: Record<string, unknown>,
  ): void;
}

export interface ResearchWorkspaceLivingReviewNotifierPort<Handle> {
  registerObserver(
    observer: ResearchWorkspaceLivingReviewNotifierObserver,
    types: string[],
    observerID: string,
  ): Handle;
  unregisterObserver(handle: Handle): void;
}

export interface ResearchWorkspaceLivingReviewNotifierDependencies<Handle> {
  notifier: ResearchWorkspaceLivingReviewNotifierPort<Handle>;
  /**
   * Scans every active project from its persisted source membership. Notifier
   * item IDs are deliberately not forwarded: they are only a wake-up signal.
   */
  scanAllActiveProjects: () => Promise<void> | void;
  log?: (message: string, error: unknown) => void;
}

export interface ResearchWorkspaceLivingReviewNotifierState {
  lifecycle: "idle" | "running" | "stopped";
  scheduled: boolean;
  draining: boolean;
  pending: boolean;
}

export interface ResearchWorkspaceLivingReviewNotifier {
  start(): void;
  stop(): void;
  getState(): ResearchWorkspaceLivingReviewNotifierState;
  /** Waits for scheduled and in-flight scans. Intended for deterministic tests. */
  flushForTests(): Promise<void>;
}

const OBSERVER_ID = "paperpilot-living-review";

/**
 * Converts Zotero item notifications into a coalesced, serialized full scan.
 *
 * The observer callback never awaits or starts scanning inline. A burst before
 * the drain starts becomes one scan. Notifications received during a scan set
 * one pending bit and therefore produce exactly one trailing scan.
 */
export function createResearchWorkspaceLivingReviewNotifier<Handle>({
  notifier,
  scanAllActiveProjects,
  log,
}: ResearchWorkspaceLivingReviewNotifierDependencies<Handle>): ResearchWorkspaceLivingReviewNotifier {
  let lifecycle: ResearchWorkspaceLivingReviewNotifierState["lifecycle"] =
    "idle";
  let registration: { handle: Handle } | undefined;
  let scheduled = false;
  let draining = false;
  let pending = false;
  let drainTask: Promise<void> | undefined;

  const reportScanFailure = (error: unknown) => {
    try {
      log?.("Research Workspace living-review scan failed.", error);
    } catch {
      // A diagnostic sink must never disable future scans.
    }
  };

  const drain = async () => {
    if (draining || lifecycle !== "running") return;
    draining = true;
    try {
      while (lifecycle === "running" && pending) {
        pending = false;
        try {
          await scanAllActiveProjects();
        } catch (error) {
          reportScanFailure(error);
        }
      }
    } finally {
      draining = false;
    }
  };

  const scheduleDrain = () => {
    if (scheduled || draining || lifecycle !== "running") return;
    scheduled = true;
    drainTask = Promise.resolve().then(async () => {
      scheduled = false;
      await drain();
    });
  };

  const requestScan = () => {
    if (lifecycle !== "running") return;
    pending = true;
    scheduleDrain();
  };

  const observer: ResearchWorkspaceLivingReviewNotifierObserver = {
    // Zotero payloads are intentionally ignored. Persisted project membership
    // is the authority for deciding which sources must be checked.
    notify: () => requestScan(),
  };

  return {
    start() {
      if (lifecycle !== "idle") return;
      lifecycle = "running";
      try {
        registration = {
          handle: notifier.registerObserver(observer, ["item"], OBSERVER_ID),
        };
      } catch (error) {
        lifecycle = "idle";
        pending = false;
        throw error;
      }
    },

    stop() {
      if (lifecycle === "stopped") return;
      lifecycle = "stopped";
      pending = false;
      const currentRegistration = registration;
      registration = undefined;
      if (currentRegistration) {
        notifier.unregisterObserver(currentRegistration.handle);
      }
    },

    getState() {
      return { lifecycle, scheduled, draining, pending };
    },

    async flushForTests() {
      while (scheduled || draining) {
        const currentTask = drainTask;
        if (currentTask) {
          await currentTask;
        } else {
          await Promise.resolve();
        }
      }
    },
  };
}
