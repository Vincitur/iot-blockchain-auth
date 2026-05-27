// Marius-Remus Dumitrel - IoT Authentication Gateway - Express.js Routes

// This module defines the Express.js routes for the IoT Authentication Gateway backend. 
// It maps HTTP endpoints to controller functions that handle device registration, authentication challenges, and interactions with the Hyperledger Fabric chaincode.
// The routes also include endpoints for retrieving network information and managing latency metrics reported by IoT device simulators.

const express = require('express');
const controllers = require('./controllers');

const router = express.Router();

// Security keys for authorization
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'iot-admin-key-2024';

// Middleware to verify admin API key from x-api-key header
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Forbidden: Invalid or missing admin API key' });
    }
    next();
};

router.get('/gateway/key', async (req, res) => {
    try {
        const result = await controllers.getGatewayKey();
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/devices/register', async (req, res) => {
    try {
        const result = await controllers.registerDevice(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/auth/challenge', async (req, res) => {
    try {
        const result = await controllers.requestChallenge(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/auth/verify', async (req, res) => {
    try {
        const result = await controllers.verifyAuthentication(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.get('/network/devices', async (req, res) => {
    try {
        const result = await controllers.getDevices();
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.get('/network/blockHeight', async (req, res) => {
    try {
        const result = await controllers.getBlockHeight();
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.get('/network/devices/:deviceId', async (req, res) => {
    try {
        const result = await controllers.getDevice(req.params.deviceId);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/devices/revoke', requireAdminKey, async (req, res) => {
    try {
        const result = await controllers.revokeDevice(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/devices/suspend', requireAdminKey, async (req, res) => {
    try {
        const result = await controllers.suspendDevice(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/metrics/latency', (req, res) => {
    try {
        const result = controllers.recordLatency(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.get('/metrics/latency', (req, res) => {
    try {
        const result = controllers.getLatencyMetrics();
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.delete('/metrics/latency', (req, res) => {
    try {
        const result = controllers.clearLatencyMetrics();
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.get('/network/ordererConfig', async (req, res) => {
    try {
        const result = await controllers.getOrdererConfig();
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/network/ordererConfig', requireAdminKey, async (req, res) => {
    try {
        const result = await controllers.updateOrdererConfig(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;

