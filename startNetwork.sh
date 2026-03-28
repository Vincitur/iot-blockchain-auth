#!/bin/bash
# startNetwork.sh
# Navigates to fabric-samples/test-network, tears down existing network, and starts anew with CAs.

# Get the directory of the current script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Navigate to test-network
echo "Navigating to test-network directory..."
cd "$DIR/../Hyperledger-Fabric/fabric-samples/test-network" || exit

echo "Tearing down existing network..."
./network.sh down

echo "Starting network with Certificate Authorities..."
./network.sh up createChannel -c mychannel -ca

echo "Network started successfully!"
