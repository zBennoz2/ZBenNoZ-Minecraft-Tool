#!/usr/bin/env bash
set -euo pipefail

JAVA_BIN="${JAVA_BIN:-java}"
ASSETS_PATH="${ASSETS_PATH:-/server/Assets.zip}"
BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"
PORT="${PORT:-5520}"
AUTH_MODE="${AUTH_MODE:-authenticated}"
JVM_ARGS="${JVM_ARGS:-}"
SERVER_JAR="${SERVER_JAR:-HytaleServer.jar}"

ARGS=()

if [ -n "${JVM_ARGS}" ]; then
  # shellcheck disable=SC2206
  ARGS+=(${JVM_ARGS})
fi

ARGS+=("-jar" "${SERVER_JAR}" "--assets" "${ASSETS_PATH}" "--bind" "${BIND_ADDRESS}:${PORT}")

if [ "${AUTH_MODE}" = "offline" ]; then
  ARGS+=("--auth" "offline")
fi

exec "${JAVA_BIN}" "${ARGS[@]}"
