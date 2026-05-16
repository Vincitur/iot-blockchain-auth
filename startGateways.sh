#!/bin/bash
# startGateways.sh — Launches both Org1 and Org2 gateways side-by-side.
# Each gateway connects to its own peer using its organization's MSP credentials.
# This demonstrates the decentralized, stateless nature of the middleware.

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" > /dev/null 2>&1 && pwd )"

# Load .env file, export variables, and launch the backend process
start_gateway() {
    local env_file="$1"
    local label="$2"
    echo "──────────────────────────────────────────────────────────"
    echo " Starting $label gateway (env: $env_file)"
    echo "──────────────────────────────────────────────────────────"
    (
        set -a
        source "$env_file"
        set +a
        node src/app.js 2>&1 | sed "s/^/[$label] /"
    ) &
}

cd "$DIR/backend" || { echo "ERROR: backend/ directory not found"; exit 1; }

start_gateway .env.org1 "ORG1"
start_gateway .env.org2 "ORG2"

echo ""
echo "Both gateways launching in background."
echo "  Org1: HTTP :3000  |  CoAP :5683"
echo "  Org2: HTTP :3001  |  CoAP :5684"
echo ""
echo "Press Ctrl+C to stop both."

# Wait for both background processes — Ctrl+C kills the whole group
wait
