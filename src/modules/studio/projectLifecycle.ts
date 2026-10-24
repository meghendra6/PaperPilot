export interface StudioProjectSession {
  confirmClose(): boolean;
  stop(): Promise<void>;
  close(): void;
}

/** Tracks bridge work even after its window has unloaded. No file deletion here. */
export class StudioProjectLifecycle {
  private blocked = new Set<string>();
  private openings = new Map<string, symbol>();
  private requests = new Map<string, Set<Promise<unknown>>>();
  private sessions = new Map<string, Set<StudioProjectSession>>();
  private quiescing = new Map<string, Promise<void>>();

  assertAvailable(scope: string) {
    if (this.blocked.has(scope))
      throw new Error(
        "This project is being deleted. Retry deletion to finish cleanup.",
      );
  }

  openingGuard(scope: string) {
    this.assertAvailable(scope);
    const token = this.openings.get(scope) ?? Symbol(scope);
    this.openings.set(scope, token);
    return () => {
      this.assertAvailable(scope);
      if (this.openings.get(scope) !== token)
        throw new Error("This project window opening was canceled.");
    };
  }

  track<T>(scope: string, action: () => Promise<T>) {
    this.assertAvailable(scope);
    const requests = this.requests.get(scope) ?? new Set<Promise<unknown>>();
    this.requests.set(scope, requests);
    const operation = Promise.resolve().then(action);
    requests.add(operation);
    const release = () => {
      requests.delete(operation);
      if (!requests.size && this.requests.get(scope) === requests)
        this.requests.delete(scope);
    };
    void operation.then(release, release);
    return operation;
  }

  register(scope: string, session: StudioProjectSession) {
    this.assertAvailable(scope);
    const sessions =
      this.sessions.get(scope) ?? new Set<StudioProjectSession>();
    this.sessions.set(scope, sessions);
    sessions.add(session);
    return () => {
      sessions.delete(session);
      if (!sessions.size && this.sessions.get(scope) === sessions)
        this.sessions.delete(scope);
    };
  }

  quiesce(
    scope: string,
    hooks: {
      pendingOpen?: Promise<void>;
      cleanup(): Promise<void>;
      closePendingWindow(): void;
    },
  ) {
    const pending = this.quiescing.get(scope);
    if (pending) return pending;
    this.blocked.add(scope);
    this.openings.delete(scope);
    const operation = Promise.resolve()
      .then(async () => {
        await hooks.pendingOpen?.catch(() => {});
        const sessions = [...(this.sessions.get(scope) ?? [])];
        if (sessions.some((session) => !session.confirmClose())) {
          this.blocked.delete(scope);
          throw new Error(
            "Project deletion canceled; unsaved Studio changes were kept.",
          );
        }
        // Start cancellation before draining. Cleanup uses fresh native ports
        // and retries ownership retained by windows which have already closed.
        const stops = sessions.map((session) => {
          try {
            return session.stop();
          } catch (error) {
            return Promise.reject(error);
          }
        });
        // Attach handlers now: a stop can fail while another owner is draining.
        const stopped = Promise.allSettled(stops);
        await hooks.cleanup();
        await stopped;
        await Promise.allSettled([...(this.requests.get(scope) ?? [])]);
        // An admitted request can finish preparation after the initial owner
        // snapshot. Confirm once more after no request can retain a new job.
        await hooks.cleanup();
        for (const session of sessions) session.close();
        hooks.closePendingWindow();
      })
      .finally(() => this.quiescing.delete(scope));
    this.quiescing.set(scope, operation);
    return operation;
  }

  /** Only after catalog and owned-file deletion succeeded, or dirty refusal. */
  release(scope: string) {
    if (this.quiescing.has(scope))
      throw new Error("Project cleanup is still running.");
    this.blocked.delete(scope);
  }
}
