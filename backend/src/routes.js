const express = require('express');
const controllers = require('./controllers');

const router = express.Router();

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

router.post('/devices/revoke', async (req, res) => {
    try {
        const result = await controllers.revokeDevice(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

router.post('/devices/suspend', async (req, res) => {
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

module.exports = router;
