#!/usr/bin/env bash
# SessionStart hook: make a fresh remote container able to typecheck, lint and
# run the RLS suite without any manual setup.
#
# Synchronous on purpose. Async would start the session sooner, but the agent
# would race the install and try to run tests against a half-built workspace.
set -euo pipefail

# Local machines already have their environment; only remote containers start empty.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "==> pnpm install"
# Not --frozen-lockfile: the container is cached after this hook, and a lockfile
# drift should slow one session down, not break every session.
corepack enable >/dev/null 2>&1 || true
pnpm install --prefer-offline

# The RLS suite needs a running cluster. Postgres server binaries ship in the
# image; scripts/db.sh builds a cluster in .pgdata without Docker.
if [ -x /usr/lib/postgresql/16/bin/initdb ]; then
  echo "==> starting local postgres"
  ./scripts/db.sh start || echo "warning: could not start postgres; 'pnpm db:test' will not work"
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PGPORT=54329'
    echo 'export DATABASE_URL="postgresql://postgres@127.0.0.1:54329/jobdrop"'
    # Expo tries to reach its API for update checks and telemetry; the sandbox
    # proxy blocks it and the failures are noise.
    echo 'export EXPO_NO_TELEMETRY=1'
    echo 'export EXPO_NO_UPDATE_CHECK=1'
  } >> "$CLAUDE_ENV_FILE"
fi

echo "==> ready"
