// Here I define the Express routes for my API. 
// Each route corresponds to a specific endpoint and HTTP method, and interacts with the fabricService to perform the necessary operations on the Hyperledger Fabric network. 
// The routes handle device registration, authentication challenges, signature verification, device queries, and revocation.

const express = require('express');
const crypto = require('crypto');
const fabricService = require('./fabricService');

const router = express.Router();

// In-memory store for challenge nonces mapped to device IDs
const challengeStore = new Map();

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

        // In a real system, you might return a JWT or session token here.
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

module.exports = router;
