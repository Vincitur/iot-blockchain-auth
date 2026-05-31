#!/bin/bash
# Script to query device state directly from the Fabric ledger

export PATH=/mnt/c/Users/Marius/OneDrive/Desktop/Dizertatie/Hyperledger-Fabric/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/mnt/c/Users/Marius/OneDrive/Desktop/Dizertatie/Hyperledger-Fabric/fabric-samples/config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE=/mnt/c/Users/Marius/OneDrive/Desktop/Dizertatie/Hyperledger-Fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem
export CORE_PEER_MSPCONFIGPATH=/mnt/c/Users/Marius/OneDrive/Desktop/Dizertatie/Hyperledger-Fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

# Default device ID to query if not provided as an argument
DEVICE_ID=${1:-sensor-7704}

echo "=== Querying Device '$DEVICE_ID' from Fabric Ledger ==="
peer chaincode query -C mychannel -n iot-auth -c "{\"function\":\"GetDevice\",\"Args\":[\"$DEVICE_ID\"]}"
echo ""
echo "=== Checking if Device Exists ==="
peer chaincode query -C mychannel -n iot-auth -c "{\"function\":\"DeviceExists\",\"Args\":[\"$DEVICE_ID\"]}"
