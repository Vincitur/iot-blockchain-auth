// Here I define the Express routes for my API. 
// Each route corresponds to a specific endpoint and HTTP method, and interacts with the fabricService to perform the necessary operations on the Hyperledger Fabric network. 
// The routes handle device registration, authentication challenges, signature verification, device queries, and revocation.

const express = require('express');
const crypto = require('crypto');
const fabricService = require('./fabricService');

const router = express.Router();

// In-memory store for challenge nonces mapped to device IDs
const challengeStore = new Map();

// In-memory store for simulator-reported authentication latencies.
// Each entry: { deviceId, latencyMs, source, timestamp }
// This array is reset whenever the backend restarts (i.e., when you redeploy the network).
const simulatorLatencies = [];

// POST /api/v1/devices/register
router.post('/devices/register', async (req, res) => {
    const { deviceId, deviceType, publicKey } = req.body;

    if (!deviceId || !deviceType || !publicKey) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        await fabricService.registerDevice(deviceId, deviceType, publicKey);
        res.status(201).json({ message: 'Device registered successfully', deviceId });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to register device' });
    }
});

// POST /api/v1/auth/challenge
router.post('/auth/challenge', async (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'Missing deviceId' });
    }

    try {
        // Ensure device exists on the network and check its status
        const device = await fabricService.getDevice(deviceId);

        // Only allow challenges for devices that can be authenticated
        // (registered, active, suspended — NOT revoked)
        if (device.status === 'revoked') {
            return res.status(403).json({ error: `Device ${deviceId} is revoked and cannot request challenges.` });
        }

        // Generate a random 32-byte nonce
        const nonce = crypto.randomBytes(32).toString('hex');

        // Store the nonce with a timestamp (for expiration logic if needed)
        challengeStore.set(deviceId, { nonce, timestamp: Date.now() });

        res.status(200).json({ nonce });
    } catch (error) {
        res.status(404).json({ error: 'Device not found or not active' });
    }
});

// POST /api/v1/auth/verify
router.post('/auth/verify', async (req, res) => {
    const { deviceId, signature } = req.body;

    if (!deviceId || !signature) {
        return res.status(400).json({ error: 'Missing deviceId or signature' });
    }

    const challenge = challengeStore.get(deviceId);
    if (!challenge) {
        return res.status(400).json({ error: 'No active challenge for this device' });
    }

    try {
        // Call the smart contract to verify the signature against the nonce and public key
        // By relying on the chaincode, we offload cryptographic validation and identity lookup 
        // entirely to the immutable decentralized ledger.
        await fabricService.verifyAuthentication(deviceId, challenge.nonce, signature);

        // Clear the challenge upon successful utilization
        challengeStore.delete(deviceId);

        // In a real system, we could return a JWT or session token here.
        res.status(200).json({ message: 'Authentication successful', token: 'mock-jwt-token-for-' + deviceId });
    } catch (error) {
        res.status(401).json({ error: 'Authentication failed' });
    }
});

// GET /api/v1/network/devices - List all devices from the ledger
router.get('/network/devices', async (req, res) => {
    try {
        const devices = await fabricService.getAllDevices();
        res.status(200).json(devices);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch devices from ledger' });
    }
});

// GET /api/v1/network/blockHeight - Query the current blockchain height from qscc
router.get('/network/blockHeight', async (req, res) => {
    try {
        const height = await fabricService.getBlockHeight();
        res.status(200).json({ height });
    } catch (error) {
        res.status(500).json({ error: 'Failed to query block height' });
    }
});

// GET /api/v1/network/devices/:deviceId
router.get('/network/devices/:deviceId', async (req, res) => {
    try {
        const device = await fabricService.getDevice(req.params.deviceId);
        res.status(200).json(device);
    } catch (error) {
        res.status(404).json({ error: 'Device not found' });
    }
});

// POST /api/v1/devices/revoke
router.post('/devices/revoke', async (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'Missing deviceId' });
    }

    try {
        await fabricService.revokeDevice(deviceId);
        res.status(200).json({ message: 'Device revoked successfully', deviceId });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to revoke device' });
    }
});

// POST /api/v1/devices/suspend
// Temporarily suspends a device. Unlike revocation, suspended devices can be re-authenticated.
router.post('/devices/suspend', async (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'Missing deviceId' });
    }

    try {
        await fabricService.suspendDevice(deviceId);
        res.status(200).json({ message: 'Device suspended successfully', deviceId });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to suspend device' });
    }
});

// POST /api/v1/metrics/latency
// Called by Docker simulator containers to report their measured end-to-end authentication latency.
// This enables the frontend dashboard to display latency metrics from external (non-browser) simulations.
router.post('/metrics/latency', (req, res) => {
    const { deviceId, latencyMs, source, keyGenMs, registrationMs, signingMs } = req.body;

    if (!deviceId || latencyMs === undefined) {
        return res.status(400).json({ error: 'Missing deviceId or latencyMs' });
    }

    simulatorLatencies.push({
        deviceId,
        latencyMs: Number(latencyMs),
        keyGenMs: keyGenMs !== undefined ? Number(keyGenMs) : null,
        registrationMs: registrationMs !== undefined ? Number(registrationMs) : null,
        signingMs: signingMs !== undefined ? Number(signingMs) : null,
        source: source || 'unknown',
        timestamp: Date.now()
    });

    res.status(201).json({ message: 'Latency recorded' });
});

// GET /api/v1/metrics/latency
// Returns all simulator-reported latencies and computed averages for the frontend dashboard.
router.get('/metrics/latency', (req, res) => {
    const count = simulatorLatencies.length;
    const avgMs = count > 0
        ? Math.round(simulatorLatencies.reduce((sum, e) => sum + e.latencyMs, 0) / count)
        : null;
    const minMs = count > 0
        ? Math.min(...simulatorLatencies.map(e => e.latencyMs))
        : null;
    const maxMs = count > 0
        ? Math.max(...simulatorLatencies.map(e => e.latencyMs))
        : null;

    res.status(200).json({
        count,
        avgMs,
        minMs,
        maxMs,
        latencies: simulatorLatencies
    });
});

// DELETE /api/v1/metrics/latency
// Clears all recorded latencies from memory, useful for resetting the dashboard between simulation runs.
router.delete('/metrics/latency', (req, res) => {
    simulatorLatencies.length = 0; // Clear the array in-place
    res.status(200).json({ message: 'All latency metrics cleared' });
});

module.exports = router;
