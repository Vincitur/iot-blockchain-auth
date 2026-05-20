#!/bin/bash
# fix-fabric.sh
# Fixes the 'fabric binaries out of sync' issue by downloading the binaries matching your docker images.

# Get the directory of the current script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "Resolving Fabric binaries and Docker images out of sync error..."
cd "$DIR/../Hyperledger-Fabric" || exit

# Run the install script to download binaries only
./install-fabric.sh binary

echo "Binaries synced successfully. You can now start the network!"
