import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import type { EngineMode } from "./modules/ai/types";

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
    pendingEngineCompletions?: Map<
      number,
      import("./modules/ai/runLifecycle").PendingEngineCompletion
    >;
    runProgressStates?: Map<
      number,
      import("./modules/ai/runProgress").RunProgressState
    >;
    geminiRunStates?: Map<
      number,
      import("./modules/gemini/runState").GeminiRunState
    >;
    geminiRunPollers?: Map<number, ReturnType<typeof setInterval>>;
    claudeRunStates?: Map<
      number,
      import("./modules/claude/runState").ClaudeRunState
    >;
    claudeRunPollers?: Map<number, ReturnType<typeof setInterval>>;
    codexExecutableResolvedPath?: string;
    codexLastProbeError?: string;
    codexDiagnosticsText?: string;
    codexExecutableCandidates?: import("./modules/codex/executableSelection").CodexExecutableProbe[];
    lastEngineRequests?: Map<
      number,
      import("./modules/ai/runLifecycle").LastEngineRequest
    >;
    paperIndexStore?: Map<string, { hash: string; chunks: string[] }>;
    modeOverrides?: Map<number, EngineMode>;
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
      mode: EngineMode;
      text: string;
      updatedAt: string;
    };
    currentSessionId?: string;
    pendingReaderAction?: {
      question: string;
      autoSubmit: boolean;
      updatedAt: string;
    };
    pendingDiscoveryConcern?: {
      text: string;
      origin: import("./modules/discovery/types").ResearchConcernOrigin;
      updatedAt: string;
    };
    relatedRecommendationStates?: Map<
      number,
      {
        running: boolean;
        status: string;
        groups: import("./modules/relatedRecommendations").RecommendationGroup[];
        discovery?: import("./modules/discovery/types").DiscoveryResult;
        concern?: string;
        concernOrigin?: import("./modules/discovery/types").ResearchConcernOrigin;
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
    criticalReadStates?: Map<
      number,
      import("./modules/criticalRead/types").CriticalReadState
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
      pendingEngineCompletions: new Map(),
      runProgressStates: new Map(),
      geminiRunStates: new Map(),
      geminiRunPollers: new Map(),
      claudeRunStates: new Map(),
      claudeRunPollers: new Map(),
      lastEngineRequests: new Map(),
      paperIndexStore: new Map(),
      modeOverrides: new Map(),
      recentCodexModels: [],
      relatedRecommendationStates: new Map(),
      autoHighlightStates: new Map(),
      paperArtifactStates: new Map(),
      comprehensionCheckStates: new Map(),
      criticalReadStates: new Map(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
