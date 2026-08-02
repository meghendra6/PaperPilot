declare const Zotero: any;

export function buildKillProcessTreeScript(processId: string): string {
  return [
    "typeset -a run_tree_pids",
    "remember_run_pid() {",
    '  local candidate="$1"',
    "  local known",
    '  for known in "${run_tree_pids[@]}"; do',
    '    [[ "$known" == "$candidate" ]] && return 0',
    "  done",
    '  run_tree_pids+=("$candidate")',
    "}",
    "is_run_pid_alive() {",
    "  local state",
    '  state=$(/bin/ps -o state= -p "$1" 2>/dev/null | /usr/bin/tr -d "[:space:]")',
    '  [[ -n "$state" && "$state" != Z* ]]',
    "}",
    "signal_run_tree() {",
    '  local pid="$1"',
    '  local signal="$2"',
    "  local child",
    '  remember_run_pid "$pid"',
    '  for child in $(/usr/bin/pgrep -P "$pid" 2>/dev/null || true); do',
    '    signal_run_tree "$child" "$signal"',
    "  done",
    '  kill "-$signal" "$pid" >/dev/null 2>&1 || true',
    "}",
    "freeze_run_tree() {",
    '  local pid="$1"',
    "  local child",
    '  is_run_pid_alive "$pid" || return 0',
    '  remember_run_pid "$pid"',
    '  kill -STOP "$pid" >/dev/null 2>&1 || true',
    '  for child in $(/usr/bin/pgrep -P "$pid" 2>/dev/null || true); do',
    '    freeze_run_tree "$child"',
    "  done",
    "}",
    "terminate_run_tree() {",
    '  local root_pid="$1"',
    "  local attempt",
    "  local pid",
    "  local running",
    '  signal_run_tree "$root_pid" TERM',
    "  for attempt in {1..10}; do",
    "    running=0",
    '    for pid in "${run_tree_pids[@]}"; do',
    '      if is_run_pid_alive "$pid"; then',
    "        running=1",
    '        signal_run_tree "$pid" TERM',
    "      fi",
    "    done",
    "    (( running == 0 )) && return 0",
    "    /bin/sleep 0.1",
    "  done",
    '  for pid in "${run_tree_pids[@]}"; do',
    '    freeze_run_tree "$pid"',
    "  done",
    '  for pid in "${run_tree_pids[@]}"; do',
    '    kill -KILL "$pid" >/dev/null 2>&1 || true',
    "  done",
    "  for attempt in {1..10}; do",
    "    running=0",
    '    for pid in "${run_tree_pids[@]}"; do',
    '      is_run_pid_alive "$pid" && running=1',
    "    done",
    "    (( running == 0 )) && return 0",
    "    /bin/sleep 0.1",
    "  done",
    "  return 1",
    "}",
    `terminate_run_tree ${processId}`,
  ].join("\n");
}

export async function stopDetachedRunProcess(
  processId?: string,
  options: { requireProcessId?: boolean } = {},
): Promise<void> {
  const numericProcessId = Number(processId);
  if (
    !processId ||
    !/^[1-9]\d*$/.test(processId) ||
    !Number.isSafeInteger(numericProcessId) ||
    numericProcessId <= 1
  ) {
    if (options.requireProcessId) {
      throw new Error("The started CLI process did not provide a valid pid.");
    }
    return;
  }
  const result = await Zotero.Utilities.Internal.exec("/bin/zsh", [
    "-lc",
    buildKillProcessTreeScript(processId),
  ]);
  if (result instanceof Error) throw result;
}

export async function settleLatePreparedRun(params: {
  stop: () => void | Promise<void>;
  cleanup: () => unknown | Promise<unknown>;
  settle: () => void;
  onStopFailure?: (error: unknown) => void;
  onCleanupFailure?: (error: unknown) => void;
}): Promise<"settled" | "stop_failed"> {
  try {
    await params.stop();
  } catch (error) {
    params.onStopFailure?.(error);
    return "stop_failed";
  }

  try {
    await params.cleanup();
  } catch (error) {
    params.onCleanupFailure?.(error);
  } finally {
    params.settle();
  }
  return "settled";
}

export async function finishRunAfterCleanup(params: {
  prepare: () => void | Promise<void>;
  cleanup: () => unknown | Promise<unknown>;
  complete: () => void | Promise<void>;
  incomplete?: (error: unknown) => void | Promise<void>;
  shouldComplete?: () => boolean;
  finalize: () => void | Promise<void>;
}): Promise<void> {
  let failed = false;
  let failure: unknown;

  const captureFailure = (error: unknown) => {
    if (failed) return;
    failed = true;
    failure = error;
  };

  try {
    await params.prepare();
  } catch (error) {
    captureFailure(error);
  }

  try {
    await params.cleanup();
  } catch (error) {
    captureFailure(error);
  }

  if (failed) {
    try {
      await params.incomplete?.(failure);
    } catch (error) {
      captureFailure(error);
    }
  } else if (params.shouldComplete?.() !== false) {
    try {
      await params.complete();
    } catch (error) {
      captureFailure(error);
    }
  }

  try {
    await params.finalize();
  } catch (error) {
    captureFailure(error);
  }

  if (failed) throw failure;
}
