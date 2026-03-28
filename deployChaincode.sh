#!/bin/bash
# deployChaincode.sh
# Deploys the iot-auth chaincode to the mychannel channel

# Get the directory of the current script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Resolve the absolute path to the chaincode
# We need to use WSL compatible paths if we run this in WSL, or relative paths that work inside the network.sh container context.
# network.sh expects the path to be relative to the test-network directory or an absolute path.
# Let's use an absolute path formatted for the environment.
CHAINCODE_PATH="$DIR/chaincode/iot-auth"

# Navigate to test-network
echo "Navigating to test-network directory..."
cd "$DIR/../Hyperledger-Fabric/fabric-samples/test-network" || exit

echo "Deploying iot-auth chaincode..."
# -ccn: chaincode name
# -ccp: chaincode path (relative to test-network or absolute)
# -ccl: chaincode language
# -c: channel name
./network.sh deployCC -ccn iot-auth -ccp "$CHAINCODE_PATH" -ccl typescript -c mychannel

echo "Chaincode deployed successfully!"
