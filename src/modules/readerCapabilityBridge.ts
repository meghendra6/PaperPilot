export type ReaderCapabilityAction = "critical-read" | "paper-mastery";

declare const addon: {
  data: {
    activateReaderCapability?: Map<
      number,
      (capability: ReaderCapabilityAction) => Promise<boolean>
    >;
  };
};

/** How long a newly opened reader tab may take to render its pane. */
const PANE_WAIT_MS = 4_000;
const PANE_POLL_MS = 100;

export async function activateReaderCapability(
  itemID: number,
  capability: ReaderCapabilityAction,
) {
  // Opening a reader returns before its item pane renders and registers
  // the activation callback, so wait for it briefly.
  const deadline = Date.now() + PANE_WAIT_MS;
  let activate = addon.data.activateReaderCapability?.get(itemID);
  while (!activate && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PANE_POLL_MS));
    activate = addon.data.activateReaderCapability?.get(itemID);
  }
  return (await activate?.(capability)) ?? false;
}
