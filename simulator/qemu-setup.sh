#!/bin/bash
# -----------------------------------------------------------------------------
# QEMU ARM Simulator Setup Script
# 
# This script automates the deployment of device.js into the QEMU ARM emulator.
# It SSHes into the emulated Raspberry Pi, installs Node.js, copies the
# simulator files, and runs the authentication flow to measure true ARM latency.
#
# Prerequisites:
#   1. The QEMU container must be running:
#      docker-compose -f docker-compose-qemu.yml up -d
#   2. Wait ~30-60 seconds for the emulated OS to fully boot before running this.
#   3. sshpass must be installed (sudo apt install sshpass / brew install sshpass)
#
# Usage:
#   bash qemu-setup.sh [number_of_runs]
#   Example: bash qemu-setup.sh 5   (runs 5 sequential authentications)
# -----------------------------------------------------------------------------



QEMU_HOST="localhost"
QEMU_PORT="5022"
QEMU_USER="pi"
QEMU_PASS="raspberry"
NUM_RUNS="${1:-1}"

# Determine the host IP that the QEMU VM can use to reach our backend.
# You can override this manually: HOST_IP=192.168.1.100 bash qemu-setup.sh
if [ -z "$HOST_IP" ]; then
    # Method 1: grep /etc/hosts inside the Docker container
    HOST_IP=$(docker exec qemu-arm-simulator grep host.docker.internal /etc/hosts 2>/dev/null | awk '{print $1}')
fi
if [ -z "$HOST_IP" ]; then
    # Method 2: resolve via ping inside the Docker container
    HOST_IP=$(docker exec qemu-arm-simulator sh -c "ping -c1 -W1 host.docker.internal 2>/dev/null" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
fi
if [ -z "$HOST_IP" ]; then
    # Method 3: QEMU default gateway (last resort)
    HOST_IP="10.0.2.2"
    echo "WARNING: Could not auto-detect host IP. Falling back to ${HOST_IP}."
    echo "         If this fails, re-run with: HOST_IP=<your-windows-ip> bash qemu-setup.sh"
fi

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${QEMU_PORT}"
SCP_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -P ${QEMU_PORT}"

echo "=========================================="
echo "QEMU ARM Simulator Setup"
echo "=========================================="
echo "  Host:     ${QEMU_HOST}:${QEMU_PORT}"
echo "  Host IP:  ${HOST_IP} (for backend access)"
echo "  Runs:     ${NUM_RUNS}"
echo ""

# Step 1: Wait for SSH to become available
echo "[1/5] Waiting for QEMU SSH to become available..."
MAX_RETRIES=30
RETRY=0
until sshpass -p "${QEMU_PASS}" ssh ${SSH_OPTS} ${QEMU_USER}@${QEMU_HOST} "echo 'SSH ready'" 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "ERROR: Could not connect to QEMU VM after ${MAX_RETRIES} attempts."
        echo "Make sure the container is running: docker-compose -f docker-compose-qemu.yml up -d"
        echo "And wait at least 30-60 seconds for the OS to boot."
        exit 1
    fi
    echo "  Attempt ${RETRY}/${MAX_RETRIES} - waiting 5s..."
    sleep 5
done
echo "  SSH connection established!"
echo ""

# Step 2: Copy the Python simulator to the QEMU VM
echo "[2/4] Copying simulator files to ARM emulator..."
sshpass -p "${QEMU_PASS}" ssh ${SSH_OPTS} ${QEMU_USER}@${QEMU_HOST} "mkdir -p ~/simulator"
sshpass -p "${QEMU_PASS}" scp ${SCP_OPTS} device_arm.py ${QEMU_USER}@${QEMU_HOST}:~/simulator/
echo "  Files copied successfully!"
echo ""



# Step 3: Run the simulator
echo "[3/3] Running ${NUM_RUNS} authentication(s) from ARM emulator..."
echo "  Testing connectivity to backend at ${HOST_IP}:3000..."
sshpass -p "${QEMU_PASS}" ssh ${SSH_OPTS} ${QEMU_USER}@${QEMU_HOST} \
    "curl -s --connect-timeout 5 http://${HOST_IP}:3000/api/v1/network/blockHeight && echo ' ✓ Backend reachable!' || echo ' ✗ Cannot reach backend at ${HOST_IP}:3000'"
echo "=========================================="

for i in $(seq 1 ${NUM_RUNS}); do
    echo ""
    echo "--- Run ${i}/${NUM_RUNS} ---"
    sshpass -p "${QEMU_PASS}" ssh ${SSH_OPTS} ${QEMU_USER}@${QEMU_HOST} \
        "cd ~/simulator && SOURCE=qemu API_URL=http://${HOST_IP}:3000/api/v1 python3 device_arm.py 2>&1"
    
    # Small delay between runs to avoid device ID collisions
    if [ $i -lt ${NUM_RUNS} ]; then
        sleep 2
    fi
done

echo ""
echo "=========================================="
echo "QEMU ARM simulation complete!"
echo "Check the frontend dashboard for the QEMU latency metrics."
echo "=========================================="

