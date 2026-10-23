import { unzipSync } from "fflate";
import { TEXT_DOCUMENT } from "./aiContracts";

/** Extract only document text; never follow DOCX external relationships. */
export function documentText(
  name: string,
  bytes: Uint8Array<ArrayBufferLike>,
  parseXML: (xml: string) => Document,
) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (TEXT_DOCUMENT.test(name)) return decoder.decode(bytes);
  if (!/\.docx$/i.test(name))
    throw new Error(`${name}: choose a text document or DOCX for AI context.`);
  const parts = unzipSync(bytes, {
    filter: (entry) =>
      entry.name === "word/document.xml" &&
      entry.originalSize <= 8 * 1024 * 1024,
  });
  const xml = parts["word/document.xml"];
  if (!xml) throw new Error("DOCX document text is missing or exceeds 8 MiB.");
  const doc = parseXML(decoder.decode(xml));
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("Invalid DOCX document XML.");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Array.from(doc.getElementsByTagNameNS(ns, "p"))
    .map((paragraph) => {
      const walk = (node: Element): string => {
        if (node.namespaceURI === ns) {
          if (node.localName === "del") return "";
          if (node.localName === "t") return node.textContent ?? "";
          if (node.localName === "tab") return "\t";
          if (node.localName === "br") return "\n";
        }
        return Array.from(node.childNodes)
          .filter((child) => child?.nodeType === 1)
          .map((child) => walk(child as Element))
          .join("");
      };
      return walk(paragraph);
    })
    .join("\n");
}
