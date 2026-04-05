import type { ProviderDescriptor } from "./types";

export interface ReaderAiProvider {
  getDescriptor(): ProviderDescriptor;
}
