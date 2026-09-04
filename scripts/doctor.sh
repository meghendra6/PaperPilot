#!/bin/bash

set -euo pipefail

TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"
errors=0
warnings=0

error() {
    printf 'ERROR: %s\n' "$*"
    errors=$((errors + 1))
}

warn() {
    printf 'WARN: %s\n' "$*"
    warnings=$((warnings + 1))
}

ok() {
    printf 'OK: %s\n' "$*"
}

printf 'Paper Pilot doctor\nTarget: %s\n\n' "${TARGET_DIR}"

if command -v node >/dev/null 2>&1; then
    node_version="$(node --version)"
    node_major="${node_version#v}"
    node_major="${node_major%%.*}"
    if [ "${node_major}" -ge 20 ] 2>/dev/null; then
        ok "Node ${node_version}"
    else
        error "Node 20 or newer is required; found ${node_version}"
    fi
else
    error "Node is not installed"
fi

if command -v npm >/dev/null 2>&1; then
    ok "npm $(npm --version)"
else
    error "npm is not installed"
fi

if command -v java >/dev/null 2>&1; then
    java_line="$(java -version 2>&1 | head -n 1 || true)"
    java_version="$(printf '%s' "${java_line}" | sed -E 's/.*version "([0-9]+)(\.([0-9]+))?.*/\1 \3/')"
    java_major="${java_version%% *}"
    if [ "${java_major}" = "1" ]; then
        java_major="${java_version##* }"
    fi
    if [ -n "${java_major}" ] && [ "${java_major}" -ge 11 ] 2>/dev/null; then
        ok "${java_line}"
    else
        warn "Java 11 or newer is recommended for OpenDataLoader; found ${java_line}"
    fi
else
    warn "Java 11 or newer is recommended for OpenDataLoader extraction"
fi

extractor_jar="${TARGET_DIR}/addon/chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar"
if [ -f "${extractor_jar}" ]; then
    ok "Vendored OpenDataLoader runtime is present"
else
    error "Vendored OpenDataLoader runtime is missing; run npm install then node scripts/prepare-opendataloader.mjs"
fi

available_engines=""
for engine in codex claude gemini; do
    if command -v "${engine}" >/dev/null 2>&1; then
        available_engines="${available_engines}${available_engines:+, }${engine}"
    fi
done
if [ -n "${available_engines}" ]; then
    ok "Local engine CLI available: ${available_engines}"
else
    warn "No Codex, Claude, or Gemini CLI was found on PATH"
fi

if command -v git >/dev/null 2>&1 && git -C "${TARGET_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    never_commit_status="$(git -C "${TARGET_DIR}" status --short -- \
        .github ':!.github/workflows' ':!.github/FUNDING.yml' \
        .vscode docs/superpowers .worktrees reference build)"
    if [ -n "${never_commit_status}" ]; then
        error "Never-commit paths contain changes:\n${never_commit_status}"
    else
        ok "Never-commit paths are clean"
    fi
else
    warn "Git worktree status could not be checked"
fi

printf '\nDoctor found %s error(s) and %s warning(s).\n' "${errors}" "${warnings}"
if [ "${errors}" -gt 0 ]; then
    exit 1
fi
