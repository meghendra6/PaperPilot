import type {
  CriticalReadAgentOutput,
  CriticalReadState,
  CriticalReadStepID,
  CriticalReadStepState,
} from "./types";

export const CRITICAL_READ_STEP_DEFINITIONS: ReadonlyArray<
  Pick<
    CriticalReadStepState,
    "id" | "title" | "instruction" | "requiresReaderInput"
  >
> = [
  {
    id: 1,
    title: "Survey abstract, figures, and tables",
    instruction:
      "Skim first. Record what appears important before reading the authors' interpretation.",
    requiresReaderInput: true,
  },
  {
    id: 2,
    title: "Identify the core research question",
    instruction:
      "State the research question in your own words after reading the introduction.",
    requiresReaderInput: true,
  },
  {
    id: 3,
    title: "Map prior work",
    instruction:
      "Paper Pilot will search for verified main-conference work, other peer-reviewed work, and recent novelty signals.",
    requiresReaderInput: false,
  },
  {
    id: 4,
    title: "Evaluate the methodology",
    instruction:
      "Assess assumptions, design choices, baselines, data, metrics, and threats before asking the agent to critique them.",
    requiresReaderInput: true,
  },
  {
    id: 5,
    title: "Draw your conclusion from results",
    instruction:
      "Inspect results and graphs without the discussion. Write the conclusion the evidence supports.",
    requiresReaderInput: true,
  },
  {
    id: 6,
    title: "Contrast your conclusion with the authors'",
    instruction:
      "Paper Pilot will compare your conclusion with the paper's discussion and conclusion.",
    requiresReaderInput: false,
  },
  {
    id: 7,
    title: "Generate alternative explanations",
    instruction:
      "Propose confounds, mechanisms, boundary conditions, and plausible rival explanations before asking for expansion.",
    requiresReaderInput: true,
  },
] as const;

function nowISO(now?: Date) {
  return (now || new Date()).toISOString();
}

export function buildInitialCriticalReadState(now?: Date): CriticalReadState {
  return {
    schemaVersion: 1,
    phase: "idle",
    running: false,
    status: "Ready to start a seven-step critical read.",
    currentStep: 1,
    steps: CRITICAL_READ_STEP_DEFINITIONS.map((definition) => ({
      ...definition,
      status: definition.id === 1 ? "ready" : "locked",
    })),
    updatedAt: nowISO(now),
  };
}

export function startCriticalRead(
  state: CriticalReadState,
  now?: Date,
): CriticalReadState {
  const timestamp = nowISO(now);
  return {
    ...state,
    phase: "active",
    status: "Step 1 is ready. Record your independent observations.",
    startedAt: state.startedAt || timestamp,
    updatedAt: timestamp,
  };
}

export function getCriticalReadStep(
  state: CriticalReadState,
  stepID = state.currentStep,
) {
  return state.steps.find((step) => step.id === stepID);
}

export function canRunCriticalReadStep(
  state: CriticalReadState,
  readerInput = "",
) {
  const step = getCriticalReadStep(state);
  if (!step || state.running || step.status === "locked") return false;
  return !step.requiresReaderInput || Boolean(readerInput.trim());
}

export function canViewPublicReviewInsights(
  state: CriticalReadState | undefined,
) {
  if (!state || state.phase === "idle") return true;
  return Boolean(
    ([4, 5, 6] as const).every(
      (stepID) =>
        state.steps.find((step) => step.id === stepID)?.status === "complete",
    ),
  );
}

export function markCriticalReadStepRunning(
  state: CriticalReadState,
  readerInput?: string,
  now?: Date,
): CriticalReadState {
  const step = getCriticalReadStep(state);
  if (!step) throw new Error("Critical Read step is unavailable.");
  if (step.requiresReaderInput && !readerInput?.trim()) {
    throw new Error("Write your own assessment before running this step.");
  }
  return {
    ...state,
    phase: "active",
    running: true,
    status: `Running step ${step.id}: ${step.title}…`,
    steps: state.steps.map((entry) =>
      entry.id === step.id
        ? {
            ...entry,
            status: "running",
            readerInput: readerInput?.trim() || entry.readerInput,
          }
        : entry,
    ),
    updatedAt: nowISO(now),
  };
}

export function completeCriticalReadStep(params: {
  state: CriticalReadState;
  output?: CriticalReadAgentOutput;
  discovery?: CriticalReadStepState["discovery"];
  now?: Date;
}) {
  const { state } = params;
  const completedStep = state.currentStep;
  const timestamp = nowISO(params.now);
  const completedSteps = state.steps.map((entry) => {
    if (entry.id === completedStep) {
      const output = params.output || entry.output;
      const discovery = params.discovery || entry.discovery;
      const { staleReason: _staleReason, ...rest } = entry;
      return {
        ...rest,
        status: "complete" as const,
        ...(output ? { output } : {}),
        ...(discovery ? { discovery } : {}),
        completedAt: timestamp,
      };
    }
    return entry;
  });
  const firstIncomplete = completedSteps.find(
    (entry) => entry.status !== "complete",
  );
  const isComplete = !firstIncomplete;
  const nextStep = (firstIncomplete?.id || 7) as CriticalReadStepID;
  return {
    ...state,
    phase: isComplete ? ("complete" as const) : ("active" as const),
    running: false,
    currentStep: nextStep,
    status: isComplete
      ? "Critical Read complete. Review or save the report."
      : `Step ${completedStep} complete. Step ${nextStep} is ready.`,
    steps: completedSteps.map((entry) =>
      entry.id === nextStep && !isComplete
        ? { ...entry, status: "ready" as const }
        : entry,
    ),
    updatedAt: timestamp,
  } satisfies CriticalReadState;
}

export function failCriticalReadStep(
  state: CriticalReadState,
  message: string,
  now?: Date,
): CriticalReadState {
  return {
    ...state,
    running: false,
    status: message,
    steps: state.steps.map((step) =>
      step.id === state.currentStep
        ? { ...step, status: "ready" as const }
        : step,
    ),
    updatedAt: nowISO(now),
  };
}

export function reviseCriticalReadStep(
  state: CriticalReadState,
  stepID: CriticalReadStepID,
  now?: Date,
) {
  const invalidated = new Map<CriticalReadStepID, string>([
    [stepID, `Step ${stepID} is being revised.`],
  ]);
  if (stepID === 2) {
    invalidated.set(3, "Step 2 changed the prior-work research question.");
  } else if (stepID === 5) {
    invalidated.set(6, "Step 5 changed the independent conclusion.");
  }
  return {
    ...state,
    phase: "active" as const,
    running: false,
    currentStep: stepID,
    reportMarkdown: undefined,
    reportNoteItemID: undefined,
    status: `Step ${stepID} reopened. Only dependent outputs were invalidated.`,
    steps: state.steps.map((step) => {
      const staleReason = invalidated.get(step.id);
      if (staleReason) {
        return {
          ...step,
          status: step.id === stepID ? ("ready" as const) : ("locked" as const),
          staleReason,
          output: undefined,
          discovery: undefined,
          completedAt: undefined,
        };
      }
      return step;
    }),
    updatedAt: nowISO(now),
  } satisfies CriticalReadState;
}
