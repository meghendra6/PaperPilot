import { getResearchWorkspaceLivingReviewService } from "./storage";
import { createResearchWorkspaceLivingReviewNotifier } from "./livingReviewNotifier";

declare const Zotero: any;

let activeNotifier:
  | ReturnType<typeof createResearchWorkspaceLivingReviewNotifier>
  | undefined;

export function registerResearchWorkspaceLivingReviewNotifier() {
  if (activeNotifier) return;
  if (!Zotero?.Notifier?.registerObserver) {
    throw new Error("Zotero item notifications are unavailable.");
  }
  activeNotifier = createResearchWorkspaceLivingReviewNotifier({
    notifier: Zotero.Notifier,
    scanAllActiveProjects: async () => {
      await getResearchWorkspaceLivingReviewService().checkAllActiveProjects();
    },
    log: (message, error) => {
      Zotero.logError?.(
        error instanceof Error
          ? new Error(`${message} ${error.message}`)
          : new Error(`${message} ${String(error)}`),
      );
    },
  });
  activeNotifier.start();
}

export function unregisterResearchWorkspaceLivingReviewNotifier() {
  activeNotifier?.stop();
  activeNotifier = undefined;
}

export function resetResearchWorkspaceLivingReviewNotifierForTests() {
  unregisterResearchWorkspaceLivingReviewNotifier();
}
