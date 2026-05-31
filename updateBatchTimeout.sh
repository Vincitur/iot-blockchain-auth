#!/bin/bash
# Marius-Remus Dumitrel — updateBatchTimeout.sh
# Live Channel Configuration Update for Hyperledger Fabric test-network.
#
# This script modifies the BatchTimeout and/or MaxMessageCount orderer
# parameters on a running Fabric channel WITHOUT restarting the network.
# It performs a standard Channel Configuration Update Transaction:
#   1. Fetch current channel config block from the orderer
#   2. Decode to JSON via configtxlator
#   3. Patch the desired values with jq
#   4. Compute the config delta (old → new)
#   5. Sign and submit the update envelope
#
# Usage:
#   ./updateBatchTimeout.sh <timeout> [maxMessageCount]
#   ./updateBatchTimeout.sh --query
#
# Examples:
#   ./updateBatchTimeout.sh 1s          # Set BatchTimeout to 1 second
#   ./updateBatchTimeout.sh 500ms       # Set BatchTimeout to 500 milliseconds
#   ./updateBatchTimeout.sh 1s 5        # Set both BatchTimeout and MaxMessageCount
#   ./updateBatchTimeout.sh --query     # Print current values as JSON

set -eo pipefail

# Find the right paths ────────────────────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
TEST_NETWORK_HOME="$SCRIPT_DIR/../Hyperledger-Fabric/fabric-samples/test-network"
export TEST_NETWORK_HOME

# Add Fabric binaries to PATH
export PATH="$TEST_NETWORK_HOME/../bin:$PATH"
export FABRIC_CFG_PATH="$TEST_NETWORK_HOME/../config"

CHANNEL_NAME="mychannel"
WORK_DIR="$TEST_NETWORK_HOME/channel-artifacts"

# Import environment variable helpers (setGlobals, ORDERER_CA, etc.)
. "$TEST_NETWORK_HOME/scripts/envVar.sh"

# ── Normalise timeout to Fabric-compatible format ────────────────────────────
# Fabric's configtx uses Go duration strings: "2s", "500ms", "1s", etc.
# We accept the same format and validate it.
normalise_timeout() {
    local input="$1"
    # Accept patterns like: 2s, 1s, 500ms, 250ms, 0.5s
    if [[ "$input" =~ ^[0-9]+(\.[0-9]+)?(s|ms)$ ]]; then
        echo "$input"
    elif [[ "$input" =~ ^[0-9]+$ ]]; then
        # Bare number → assume seconds
        echo "${input}s"
    else
        echo "Error: Invalid timeout format '$input'. Use e.g. 2s, 1s, 500ms" >&2
        exit 1
    fi
}

# ── Set Orderer Identity ───────────────────────────────────────────────────────
setOrdererGlobals() {
    export CORE_PEER_LOCALMSPID="OrdererMSP"
    export CORE_PEER_TLS_ROOTCERT_FILE="$ORDERER_CA"
    export CORE_PEER_MSPCONFIGPATH="${TEST_NETWORK_HOME}/organizations/ordererOrganizations/example.com/users/Admin@example.com/msp"
    export CORE_PEER_ADDRESS=localhost:7050
}

# ── Fetch and decode current channel config ──────────────────────────────────
fetch_config() {
    # Set Orderer admin identity for channel operations
    setOrdererGlobals

    echo "[1/5] Fetching current channel configuration from orderer..."
    peer channel fetch config "$WORK_DIR/config_block.pb" \
        -o localhost:7050 \
        --ordererTLSHostnameOverride orderer.example.com \
        -c "$CHANNEL_NAME" \
        --tls --cafile "$ORDERER_CA" 2>&1 | grep -v "^$"

    echo "[2/5] Decoding config block to JSON..."
    configtxlator proto_decode \
        --input "$WORK_DIR/config_block.pb" \
        --type common.Block \
        --output "$WORK_DIR/config_block.json"

    jq .data.data[0].payload.data.config "$WORK_DIR/config_block.json" \
        > "$WORK_DIR/current_config.json"
}

# Query mode: print current BatchTimeout and MaxMessageCount ───────────────
query_config() {
    fetch_config

    local batch_timeout
    local max_message_count
    batch_timeout=$(jq -r '.channel_group.groups.Orderer.values.BatchTimeout.value.timeout' "$WORK_DIR/current_config.json")
    max_message_count=$(jq -r '.channel_group.groups.Orderer.values.BatchSize.value.max_message_count' "$WORK_DIR/current_config.json")

    # Output as JSON for easy parsing by the backend
    echo "{\"batchTimeout\":\"$batch_timeout\",\"maxMessageCount\":$max_message_count}"
}

# Update mode: patch config and submit update tx ───────────────────────────
update_config() {
    local new_timeout="$1"
    local new_max_msg="${2:-}"

    fetch_config

    # Read current values for display
    local old_timeout
    local old_max_msg
    old_timeout=$(jq -r '.channel_group.groups.Orderer.values.BatchTimeout.value.timeout' "$WORK_DIR/current_config.json")
    old_max_msg=$(jq -r '.channel_group.groups.Orderer.values.BatchSize.value.max_message_count' "$WORK_DIR/current_config.json")

    echo ""
    echo "Current configuration:"
    echo "  BatchTimeout:    $old_timeout"
    echo "  MaxMessageCount: $old_max_msg"
    echo ""

    # Build the jq patch expression
    # The jq is tricky here: we need to update the BatchTimeout, and optionally MaxMessageCount if provided.
    local jq_expr=".channel_group.groups.Orderer.values.BatchTimeout.value.timeout = \"$new_timeout\""

    if [ -n "$new_max_msg" ]; then
        jq_expr="$jq_expr | .channel_group.groups.Orderer.values.BatchSize.value.max_message_count = $new_max_msg"
    fi

    echo "[3/5] Patching configuration..."
    echo "  BatchTimeout:    $old_timeout → $new_timeout"
    if [ -n "$new_max_msg" ]; then
        echo "  MaxMessageCount: $old_max_msg → $new_max_msg"
    fi

    jq "$jq_expr" "$WORK_DIR/current_config.json" > "$WORK_DIR/modified_config.json"

    # Encode both configs to protobuf and compute the delta
    echo "[4/5] Computing configuration delta..."
    configtxlator proto_encode \
        --input "$WORK_DIR/current_config.json" \
        --type common.Config \
        --output "$WORK_DIR/original_config.pb"

    configtxlator proto_encode \
        --input "$WORK_DIR/modified_config.json" \
        --type common.Config \
        --output "$WORK_DIR/modified_config.pb"

    configtxlator compute_update \
        --channel_id "$CHANNEL_NAME" \
        --original "$WORK_DIR/original_config.pb" \
        --updated "$WORK_DIR/modified_config.pb" \
        --output "$WORK_DIR/batch_update.pb"

    # Wrap the delta in an envelope
    configtxlator proto_decode \
        --input "$WORK_DIR/batch_update.pb" \
        --type common.ConfigUpdate \
        --output "$WORK_DIR/batch_update.json"

    echo '{"payload":{"header":{"channel_header":{"channel_id":"'"$CHANNEL_NAME"'","type":2}},"data":{"config_update":'$(cat "$WORK_DIR/batch_update.json")'}}}'  \
        | jq . > "$WORK_DIR/batch_update_envelope.json"

    configtxlator proto_encode \
        --input "$WORK_DIR/batch_update_envelope.json" \
        --type common.Envelope \
        --output "$WORK_DIR/batch_update_envelope.pb"

    # Sign and submit using the Orderer admin identity
    echo "[5/5] Submitting channel configuration update transaction..."
    setOrdererGlobals

    peer channel update \
        -f "$WORK_DIR/batch_update_envelope.pb" \
        -c "$CHANNEL_NAME" \
        -o localhost:7050 \
        --ordererTLSHostnameOverride orderer.example.com \
        --tls --cafile "$ORDERER_CA"

    echo ""
    echo " Channel configuration updated successfully!"
    echo " BatchTimeout is now: $new_timeout"
    if [ -n "$new_max_msg" ]; then
        echo "  MaxMessageCount is now: $new_max_msg"
    fi

    # Output JSON result for backend parsing (last line)
    local final_max_msg="${new_max_msg:-$old_max_msg}"
    echo "{\"batchTimeout\":\"$new_timeout\",\"maxMessageCount\":$final_max_msg}"
}

# Main ─────────────────────────────────────────────────────────────────────
if [ $# -lt 1 ]; then
    echo "Usage:"
    echo "  $0 <timeout> [maxMessageCount]   Update orderer batch parameters"
    echo "  $0 --query                        Query current values"
    echo ""
    echo "Examples:"
    echo "  $0 1s        # Set BatchTimeout to 1 second"
    echo "  $0 500ms     # Set BatchTimeout to 500 milliseconds"
    echo "  $0 1s 5      # Set both parameters"
    echo "  $0 --query   # Print current values as JSON"
    exit 1
fi

if [ "$1" = "--query" ]; then
    query_config
else
    TIMEOUT=$(normalise_timeout "$1")
    MAX_MSG="${2:-}"
    update_config "$TIMEOUT" "$MAX_MSG"
fi
