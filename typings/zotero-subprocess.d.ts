declare namespace _ZoteroTypes {
  namespace Utilities {
    interface Internal {
      subprocess(command: string, args?: string[]): Promise<string>;
    }
  }
}
