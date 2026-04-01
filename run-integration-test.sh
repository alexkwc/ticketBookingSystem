#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose"
PROJECT="ticket-integration-test"

cleanup() {
  echo ""
  echo "── Tearing down containers ──────────────────────────────"
  $COMPOSE -p "$PROJECT" --profile integration-test down -v --remove-orphans
}

# Always tear down on exit (success, failure, or Ctrl-C)
trap cleanup EXIT

echo "── Building images ──────────────────────────────────────"
$COMPOSE -p "$PROJECT" --profile integration-test build

echo ""
echo "── Starting infrastructure + services ───────────────────"
$COMPOSE -p "$PROJECT" --profile integration-test up -d \
  postgres redis migrate api payment worker-outbox worker-jobs

echo ""
echo "── Running integration tests ────────────────────────────"
# `run --rm` uses the service's depends_on conditions to wait for healthy deps,
# then runs the integration-test container to completion and removes it.
$COMPOSE -p "$PROJECT" --profile integration-test run --rm integration-test
EXIT_CODE=$?

# cleanup is called by the EXIT trap; propagate the integration-test exit code
exit "$EXIT_CODE"
