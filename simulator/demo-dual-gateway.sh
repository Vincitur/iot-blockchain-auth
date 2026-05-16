#!/bin/bash
# demo-dual-gateway.sh — Prove decentralization by sending devices
# through both Org1 and Org2 gateways against the same shared ledger.

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" > /dev/null 2>&1 && pwd )"
cd "$DIR" || exit

echo "╔══════════════════════════════════════════════════════════╗"
echo "║        Dual-Gateway Decentralization Demonstration       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Gateway 1 (Org1MSP): HTTP :3000  |  CoAP :5683        ║"
echo "║  Gateway 2 (Org2MSP): HTTP :3001  |  CoAP :5684        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

SENSOR_COUNT=${1:-5}

echo "[1/2] Sending $SENSOR_COUNT devices via Org1 Gateway (CoAP :5683)..."
docker-compose -f docker-compose.coap.yml up --build --scale sensor=$SENSOR_COUNT -d
# Default COAP_URL already points to port 5683

echo ""
echo "[2/2] Sending $SENSOR_COUNT devices via Org2 Gateway (CoAP :5684)..."
COAP_URL=coap://host.docker.internal:5684/api/v1 \
  docker-compose -f docker-compose.coap.yml run --rm -e COAP_URL=coap://host.docker.internal:5684/api/v1 \
  -e SOURCE=org2-gateway sensor &

# Repeat for the full count
for i in $(seq 2 $SENSOR_COUNT); do
  docker-compose -f docker-compose.coap.yml run --rm -e COAP_URL=coap://host.docker.internal:5684/api/v1 \
    -e SOURCE=org2-gateway sensor &
done

wait

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  All devices processed. Both gateways wrote to the     ║"
echo "║  same Hyperledger Fabric ledger independently.          ║"
echo "╚══════════════════════════════════════════════════════════╝"
