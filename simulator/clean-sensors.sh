#!/bin/bash
# Script to cleanly stop and remove all IoT simulation containers, images, and volumes.

echo "=========================================="
echo "Cleaning up Docker IoT Simulation Fleet..."
echo "=========================================="

# Ensure we're in the simulator directory
cd "$(dirname "$0")" || { echo "Error: Failed to change to simulator directory"; exit 1; }

echo "[1/3] Running docker-compose down..."
docker-compose down -v 2>/dev/null || true

echo "[2/3] Removing all containers containing 'sensor' in their name..."
# Find all containers with 'sensor' in the name and force remove them along with their volumes
docker ps -a --filter "name=sensor" -q | xargs -r docker rm -f -v

echo "[3/3] Removing all images containing 'simulator' in their name..."
# Find all images with 'simulator' in their repository name and force remove them
docker images --filter "reference=*simulator*" -q | xargs -r docker rmi -f

echo ""
echo "Cleanup complete!"
echo "You can start fresh anytime with: docker-compose up --build --scale sensor=<N>"
