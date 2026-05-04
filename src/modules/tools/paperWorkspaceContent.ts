import { buildCodexCommandEnvironment } from "../codex/environment";
import { shellEscape } from "../codex/shell";

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

export interface PaperWorkspaceContent {
  fullText: string;
  markdownText?: string;
  structuredContent?: unknown;
  extractionMethod: "opendataloader-pdf" | "zotero-attachment-text";
  extractionNotes: string[];
}

interface StructuredExtractionResult {
  markdownText: string;
  structuredContent: unknown;
}

class PaperWorkspaceContentCache {
  private currentItemID: string | null = null;
  private currentContent: PaperWorkspaceContent | null = null;

  async getPaperContent(item: any): Promise<PaperWorkspaceContent> {
    const itemID = String(item.id);
    if (this.currentItemID !== itemID || this.currentContent === null) {
      this.currentContent = await this.extractPaperContent(item);
      this.currentItemID = itemID;
    }

    return this.currentContent;
  }

  clearCache() {
    this.currentItemID = null;
    this.currentContent = null;
  }

  private async extractPaperContent(item: any): Promise<PaperWorkspaceContent> {
    const attachment = await resolvePdfAttachment(item);
    if (!attachment) {
      throw new Error("No PDF attachment found for this item");
    }

    const fallbackText = await Promise.resolve(attachment.attachmentText || "");
    const extractionNotes: string[] = [];
    const filePath = await attachment.getFilePathAsync();

    if (filePath) {
      try {
        const structured = await extractStructuredPdf(filePath);
        return {
          fullText: structured.markdownText || fallbackText,
          markdownText: structured.markdownText,
          structuredContent: structured.structuredContent,
          extractionMethod: "opendataloader-pdf",
          extractionNotes,
        };
      } catch (error) {
        extractionNotes.push(
          `OpenDataLoader PDF extraction unavailable; fell back to Zotero attachment text. ${String(
            error instanceof Error ? error.message : error,
          )}`,
        );
      }
    } else {
      extractionNotes.push(
        "OpenDataLoader PDF extraction unavailable because the local PDF file path could not be resolved.",
      );
    }

    return {
      fullText: fallbackText,
      extractionMethod: "zotero-attachment-text",
      extractionNotes,
    };
  }
}

async function resolvePdfAttachment(item: any) {
  if (item.isAttachment()) {
    if (
      item.attachmentContentType === "application/pdf" ||
      item.attachmentContentType === ""
    ) {
      return item;
    }
    throw new Error("Attachment is not a PDF");
  }

  const attachments = item.getAttachments();
  for (const attachmentID of attachments) {
    const attachment = Zotero.Items.get(attachmentID);
    if (
      attachment &&
      (attachment.attachmentContentType === "application/pdf" ||
        attachment.attachmentContentType === "")
    ) {
      return attachment;
    }
  }

  return undefined;
}

function fileURLToPathString(fileUrl: string) {
  return decodeURIComponent(new URL(fileUrl).pathname);
}

async function pathExists(path: string) {
  try {
    return await IOUtils.exists(path);
  } catch {
    return false;
  }
}

async function fetchBundledJarToProfile(rootUri: string) {
  const profilePath = Zotero.getProfileDirectory?.()?.path || "";
  if (!profilePath) {
    throw new Error("Could not resolve the Zotero profile directory.");
  }

  const cacheDir = PathUtils.join(profilePath, "paperpilot-tools");
  const cachePath = PathUtils.join(cacheDir, "opendataloader-pdf-cli.jar");

  if (await pathExists(cachePath)) {
    return cachePath;
  }

  const normalizedRootUri = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
  const bundledJarUrl = new URL(
    "chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar",
    normalizedRootUri,
  ).href;
  const response = await fetch(bundledJarUrl);
  if (!response.ok) {
    throw new Error(
      `Could not read the bundled OpenDataLoader asset (${response.status}).`,
    );
  }

  await IOUtils.makeDirectory(cacheDir, { ignoreExisting: true });
  await IOUtils.write(cachePath, new Uint8Array(await response.arrayBuffer()));
  return cachePath;
}

export async function resolveOpenDataLoaderJarPath(options?: {
  rootUri?: string;
  exists?: (path: string) => Promise<boolean>;
}) {
  const exists = options?.exists ?? pathExists;
  const rootUri =
    options?.rootUri ??
    ((globalThis as typeof globalThis & { rootURI?: string }).rootURI || "");
  const candidates: string[] = [];

  if (rootUri) {
    try {
      const bundledPath = await fetchBundledJarToProfile(rootUri);
      if (await exists(bundledPath)) {
        return bundledPath;
      }
    } catch {
      // Fall back to the development-time node_modules lookup below.
    }
  }

  if (rootUri.startsWith("file:")) {
    const normalizedRootUri = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
    const searchRoots = [
      new URL(".", normalizedRootUri),
      new URL("../", normalizedRootUri),
      new URL("../../", normalizedRootUri),
      new URL("../../../", normalizedRootUri),
    ];

    for (const base of searchRoots) {
      candidates.push(
        fileURLToPathString(
          new URL(
            "node_modules/@opendataloader/pdf/lib/opendataloader-pdf-cli.jar",
            base,
          ).href,
        ),
      );
    }
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Could not locate the OpenDataLoader PDF runtime assets in the bundled addon or node_modules.",
  );
}

function buildOpenDataLoaderScript(params: {
  jarPath: string;
  inputPath: string;
  outputDir: string;
}) {
  const environment = buildCodexCommandEnvironment("java");
  const exports = Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
  const command = [
    "java",
    "-jar",
    params.jarPath,
    params.inputPath,
    "--output-dir",
    params.outputDir,
    "--format",
    "markdown,json",
    "--quiet",
    "--use-struct-tree",
    "--reading-order",
    "xycut",
    "--table-method",
    "cluster",
  ]
    .map(shellEscape)
    .join(" ");

  return [...exports, command].join(" && ");
}

async function listDirectoryFiles(path: string) {
  const files: string[] = [];
  await Zotero.File.iterateDirectory(
    path,
    async (entry: { isDir?: boolean; path: string }) => {
      if (!entry.isDir) {
        files.push(entry.path);
      }
    },
  );
  return files;
}

async function readTextFile(path: string) {
  return String(
    (await Promise.resolve(Zotero.File.getContentsAsync(path, "utf-8"))) || "",
  );
}

async function extractStructuredPdf(
  filePath: string,
): Promise<StructuredExtractionResult> {
  const jarPath = await resolveOpenDataLoaderJarPath();
  const outputDir = await IOUtils.createUniqueDirectory(
    `${Zotero.getTempDirectory().path}/paper-pilot-opendataloader`,
    "run",
  );

  try {
    const result = await Zotero.Utilities.Internal.exec("/bin/zsh", [
      "-lc",
      buildOpenDataLoaderScript({
        jarPath,
        inputPath: filePath,
        outputDir,
      }),
    ]);
    if (result instanceof Error) {
      throw result;
    }
  } catch (error) {
    throw new Error(String(error));
  }

  const files = await listDirectoryFiles(outputDir);
  const markdownPath = files.find((path) => path.endsWith(".md"));
  const jsonPath = files.find((path) => path.endsWith(".json"));

  if (!markdownPath || !jsonPath) {
    throw new Error(
      "OpenDataLoader PDF did not produce both Markdown and JSON outputs.",
    );
  }

  const markdownText = await readTextFile(markdownPath);
  const jsonText = await readTextFile(jsonPath);

  if (!markdownText.trim() || !jsonText.trim()) {
    throw new Error(
      "OpenDataLoader PDF produced empty Markdown or JSON output.",
    );
  }

  try {
    return {
      markdownText,
      structuredContent: JSON.parse(jsonText),
    };
  } catch (error) {
    throw new Error(
      `OpenDataLoader PDF returned invalid JSON output. ${String(
        error instanceof Error ? error.message : error,
      )}`,
    );
  }
}

export const paperWorkspaceContentCache = new PaperWorkspaceContentCache();
