import { getDocument, PDFWorker } from "@paperpilot/studio-editor";
import { node } from "./dom";

/** PDF actions, attachments, forms, and scripts are never executed by this preview. */
export function pdfPreview(
  host: HTMLElement,
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  workerSource: () => Promise<string>,
) {
  let worker: Worker | undefined;
  let wrapper: PDFWorker | undefined;
  let workerURL: string | undefined;
  let loading: ReturnType<typeof getDocument> | undefined;
  let failWorker: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => {
    failWorker = reject;
  });
  const deadline = window.setTimeout(
    () => failWorker(new Error("PDF loading timed out")),
    30000,
  );
  const startup = workerSource().then(async (source) => {
    if (disposed) throw new Error("PDF preview closed.");
    // Module imports from chrome: are blocked in an opaque Gecko frame. The
    // host supplies this fixed packaged asset, never document-provided code.
    workerURL = URL.createObjectURL(
      new Blob(
        [
          `self.addEventListener("error", (event) => self.postMessage({paperpilotPDFWorkerError: String(event.message || "PDF worker error")}));\n`,
          source,
        ],
        { type: "text/javascript" },
      ),
    );
    worker = new Worker(workerURL);
    worker.addEventListener("error", (event) =>
      failWorker(new Error(event.message || "PDF worker failed to start")),
    );
    // The supplied-port API resolves immediately. Wait for the packaged worker
    // to install its message handler before sending document requests.
    await new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data?.paperpilotPDFWorkerError === "string") {
          failWorker(new Error(event.data.paperpilotPDFWorkerError));
          return;
        }
        if (event.data?.action !== "ready") return;
        worker?.removeEventListener("message", onMessage);
        resolve();
      };
      worker!.addEventListener("message", onMessage);
    });
    if (disposed) throw new Error("PDF preview closed.");
    wrapper = PDFWorker.create({ port: worker });
    loading = getDocument({
      data: bytes,
      worker: wrapper,
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: true,
    });
    return loading.promise;
  });
  const ready = Promise.race([startup, failed]).finally(() =>
    window.clearTimeout(deadline),
  );
  const surface = node("section", undefined, "pdf-preview");
  const controls = node("div", undefined, "surface-controls");
  const previous = node("button", "Previous page");
  const next = node("button", "Next page");
  const position = node("output", "Loading PDF…");
  position.setAttribute("aria-live", "polite");
  const canvas = node("canvas");
  canvas.setAttribute("role", "img");
  const text = node("pre");
  const extracted = node("details");
  extracted.append(node("summary", "Page text"), text);
  controls.append(previous, position, next);
  surface.append(controls, canvas, extracted);
  host.append(surface);
  let pageNumber = 1;
  let disposed = false;
  let busy = false;
  async function render() {
    if (busy || disposed) return;
    busy = true;
    previous.disabled = next.disabled = true;
    try {
      const pdf = await ready;
      if (disposed) return;
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(300, Math.min(1100, host.clientWidth - 60));
      const scale = Math.min(
        width / base.width,
        Math.sqrt(10000000 / (base.width * base.height)),
      );
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute(
        "aria-label",
        `${name}, page ${pageNumber}. Expand Page text to read its text.`,
      );
      await page.render({ canvas, viewport }).promise;
      const content = await page.getTextContent();
      text.textContent = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      position.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
      previous.disabled = pageNumber === 1;
      next.disabled = pageNumber === pdf.numPages;
    } catch (error) {
      worker?.terminate();
      if (!disposed)
        position.textContent = `PDF preview unavailable: ${String(error)}. The original file can still be exported.`;
    } finally {
      busy = false;
    }
  }
  previous.addEventListener("click", () => {
    pageNumber--;
    void render();
  });
  next.addEventListener("click", () => {
    pageNumber++;
    void render();
  });
  void render();
  return () => {
    disposed = true;
    failWorker(new Error("PDF preview closed."));
    void loading?.destroy().catch(() => {});
    wrapper?.destroy();
    worker?.terminate();
    if (workerURL) URL.revokeObjectURL(workerURL);
  };
}
