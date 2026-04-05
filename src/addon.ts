import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    codexRunStates?: Map<
      number,
      import("./modules/codex/runState").CodexRunState
    >;
    codexRunPollers?: Map<number, ReturnType<typeof setInterval>>;
    codexExecutableResolvedPath?: string;
    codexLastProbeError?: string;
    codexDiagnosticsText?: string;
    codexExecutableCandidates?: import("./modules/codex/executableSelection").CodexExecutableProbe[];
    lastCodexRequests?: Map<
      number,
      {
        sessionId: string;
        sessionTitle: string;
        question: string;
        selectedText?: string;
        annotationIDs?: string[];
        useResume: boolean;
        resumeSessionId?: string;
      }
    >;
    paperIndexStore?: Map<string, { hash: string; chunks: string[] }>;
    modeOverrides?: Map<number, "gemini_cli" | "codex_cli">;
    recentCodexModels?: string[];
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    readerActionDraft?: {
      source: "selection-popup" | "annotation-menu" | "page-context";
      action: string;
      text?: string;
      annotationIDs?: string[];
      updatedAt: string;
    };
    contextCard?: {
      summary: string;
      updatedAt: string;
    };
    lastPreparedPrompt?: {
      mode: "gemini_cli" | "codex_cli";
      text: string;
      updatedAt: string;
    };
    currentSessionId?: string;
    pendingReaderAction?: {
      question: string;
      autoSubmit: boolean;
      updatedAt: string;
    };
    relatedRecommendationStates?: Map<
      number,
      {
        running: boolean;
        status: string;
        groups: import("./modules/relatedRecommendations").RecommendationGroup[];
      }
    >;
    applyReaderActionToPane?: () => Promise<void> | void;
    aiReaderPaneRegistered?: boolean;
    autoHighlightStates?: Map<number, { running: boolean; status: string }>;
    paperArtifactStates?: Map<
      number,
      {
        running: boolean;
        status: string;
        activeKind?: import("./modules/paperArtifacts").PaperArtifactKind;
        cards: import("./modules/paperArtifacts").PaperArtifactCard[];
      }
    >;
    comprehensionCheckStates?: Map<
      number,
      import("./modules/comprehensionCheck/types").ComprehensionCheckState
    >;
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: createZToolkit(),
      codexRunStates: new Map(),
      codexRunPollers: new Map(),
      lastCodexRequests: new Map(),
      paperIndexStore: new Map(),
      modeOverrides: new Map(),
      recentCodexModels: [],
      relatedRecommendationStates: new Map(),
      autoHighlightStates: new Map(),
      paperArtifactStates: new Map(),
      comprehensionCheckStates: new Map(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
