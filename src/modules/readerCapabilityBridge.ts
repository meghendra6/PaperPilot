export type ReaderCapabilityAction = "critical-read" | "paper-mastery";

declare const addon: {
  data: {
    activateReaderCapability?: Map<
      number,
      (capability: ReaderCapabilityAction) => Promise<boolean>
    >;
  };
};

export async function activateReaderCapability(
  itemID: number,
  capability: ReaderCapabilityAction,
) {
  return (
    (await addon.data.activateReaderCapability?.get(itemID)?.(capability)) ??
    false
  );
}
