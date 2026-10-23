/** Join concurrent save requests; drain edits that arrived during persistence. */
export class SaveCoordinator {
  private flight: Promise<void> | undefined;

  constructor(
    private dirty: () => boolean,
    private saveOne: () => Promise<void>,
  ) {}

  get pending() {
    return Boolean(this.flight);
  }

  save(): Promise<void> {
    if (this.flight) return this.flight;
    const flight = Promise.resolve()
      .then(async () => {
        while (this.dirty()) await this.saveOne();
      })
      .finally(() => {
        if (this.flight === flight) this.flight = undefined;
      });
    this.flight = flight;
    return flight;
  }
}
