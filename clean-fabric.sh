#!/bin/bash

# Define the prefix to exclude
EXCLUDE_PREFIX="critoma/"

echo "--- Starting Fabric Environment Cleanup ---"

# 1. Stop and remove all containers associated with the Peer/Orderer or Chaincode
# This filters for containers often used in Fabric (dev-*, peer*, orderer*, cli)
echo "Removing Fabric-related containers..."
CONTAINERS=$(docker ps -aq)
if [ -n "$CONTAINERS" ]; then
    docker rm -f $CONTAINERS
else
    echo "No containers found to remove."
fi

# 2. Remove Chaincode Images, but EXCLUDE your core images (critoma/*)
echo "Cleaning up images (excluding $EXCLUDE_PREFIX)..."

# Get all image IDs and their repository names
docker images --format '{{.Repository}} {{.ID}}' | while read repo id; do
    # Check if the repository name starts with the excluded prefix
    if [[ $repo == $EXCLUDE_PREFIX* ]]; then
        echo "Skipping protected image: $repo ($id)"
    elif [[ $repo == "dev-peer"* ]] || [[ $repo == "<none>" ]]; then
        # Specifically target chaincode (dev-peer) and dangling images (<none>)
        echo "Removing image: $repo ($id)"
        docker rmi -f $id 2>/dev/null
    fi
done

# 3. Cleanup unused networks and build cache
echo "Pruning unused networks and build cache..."
docker network prune -f
docker builder prune -f

echo "--- Cleanup Complete ---"
docker system df