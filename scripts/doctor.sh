#!/bin/bash

set -euo pipefail

TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

errors=0
warnings=0

say_error() {
    echo -e "${RED}ERROR:${NC} $*"
    errors=$((errors + 1))
}

say_warn() {
    echo -e "${YELLOW}WARN:${NC} $*"
    warnings=$((warnings + 1))
}

say_ok() {
    echo -e "${GREEN}OK:${NC} $*"
}

require_file() {
    local path="$1"
    if [ ! -f "${path}" ]; then
        say_error "Missing file: ${path#${TARGET_DIR}/}"
    fi
}

warn_if_missing_file() {
    local path="$1"
    if [ ! -f "${path}" ]; then
        say_warn "Missing optional file: ${path#${TARGET_DIR}/}"
    fi
}

require_dir() {
    local path="$1"
    if [ ! -d "${path}" ]; then
        say_error "Missing directory: ${path#${TARGET_DIR}/}"
    fi
}

get_setting() {
    local settings_file="$1"
    local key="$2"

    python3 - "${settings_file}" "${key}" <<'PY'
import json
import re
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    lines = []
    for line in fh:
        if re.match(r"^\s*//", line):
            continue
        lines.append(line)
    data = json.loads("".join(lines))
value = data.get(key, None)
if isinstance(value, bool):
    print("true" if value else "false")
elif value is None:
    print("unset")
else:
    print(str(value))
PY
}

SETTINGS_PATH="${TARGET_DIR}/.vscode/settings.json"

echo "oh-my-copilot doctor"
echo "Target: ${TARGET_DIR}"
echo ""

require_file "${TARGET_DIR}/.github/copilot-instructions.md"
require_dir "${TARGET_DIR}/.github/instructions"
require_dir "${TARGET_DIR}/.github/prompts"
require_dir "${TARGET_DIR}/.github/agents"
require_dir "${TARGET_DIR}/.github/skills"
require_file "${TARGET_DIR}/.vscode/toolsets.json"
require_file "${SETTINGS_PATH}"

# AGENTS.md is useful when chat.useAgentsMdFile is enabled, but not installed by install.sh.
warn_if_missing_file "${TARGET_DIR}/AGENTS.md"

# Core prompt/agent/skill files required for one-request workflow.
require_file "${TARGET_DIR}/.github/prompts/ultrawork.prompt.md"
require_file "${TARGET_DIR}/.github/prompts/autopilot.prompt.md"
require_file "${TARGET_DIR}/.github/prompts/handoff.prompt.md"
require_file "${TARGET_DIR}/.github/prompts/ecomode.prompt.md"
require_file "${TARGET_DIR}/.github/prompts/note.prompt.md"
require_file "${TARGET_DIR}/.github/agents/sisyphus.agent.md"
require_file "${TARGET_DIR}/.github/agents/oracle.agent.md"
require_file "${TARGET_DIR}/.github/skills/context-map/SKILL.md"
require_file "${TARGET_DIR}/.github/skills/handoff/SKILL.md"

if [ -f "${SETTINGS_PATH}" ]; then
    use_instructions=$(get_setting "${SETTINGS_PATH}" "github.copilot.chat.codeGeneration.useInstructionFiles")
    use_agents_md=$(get_setting "${SETTINGS_PATH}" "chat.useAgentsMdFile")
    use_nested_agents=$(get_setting "${SETTINGS_PATH}" "chat.useNestedAgentsMdFiles")
    use_agent_skills=$(get_setting "${SETTINGS_PATH}" "chat.useAgentSkills")

    if [ "${use_instructions}" != "true" ]; then
        say_warn "github.copilot.chat.codeGeneration.useInstructionFiles is ${use_instructions}"
    else
        say_ok "Instruction files enabled"
    fi

    if [ "${use_agents_md}" != "true" ]; then
        say_warn "chat.useAgentsMdFile is ${use_agents_md}"
    else
        say_ok "AGENTS.md enabled"
    fi

    if [ "${use_nested_agents}" = "true" ]; then
        say_warn "chat.useNestedAgentsMdFiles is true (nested AGENTS.md adds more context; enable only when needed)"
    elif [ "${use_nested_agents}" = "false" ]; then
        say_ok "Nested AGENTS.md disabled by default"
    fi

    if [ "${use_agent_skills}" = "true" ]; then
        say_ok "Agent Skills enabled"
    else
        say_warn "chat.useAgentSkills is ${use_agent_skills}"
    fi
fi

echo ""
if [ "${errors}" -gt 0 ]; then
    echo -e "${RED}Doctor found ${errors} error(s) and ${warnings} warning(s).${NC}"
    exit 1
fi

if [ "${warnings}" -gt 0 ]; then
    echo -e "${YELLOW}Doctor found ${warnings} warning(s).${NC}"
    exit 0
fi

echo -e "${GREEN}Doctor checks passed.${NC}"
