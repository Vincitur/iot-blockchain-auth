const crypto = require('crypto');
const fabricService = require('./fabricService');

// In-memory store for challenge nonces mapped to device IDs
const challengeStore = new Map();

// In-memory store for simulator-reported authentication latencies.
const simulatorLatencies = [];

async function registerDevice({ deviceId, deviceType, publicKey }) {
    if (!deviceId || !deviceType || !publicKey) {
        throw { status: 400, message: 'Missing required fields' };
    }
    try {
        await fabricService.registerDevice(deviceId, deviceType, publicKey);
        return { message: 'Device registered successfully', deviceId };
    } catch (error) {
        throw { status: 500, message: error.message || 'Failed to register device' };
    }
}

async function requestChallenge({ deviceId }) {
    if (!deviceId) {
        throw { status: 400, message: 'Missing deviceId' };
    }
    try {
        const device = await fabricService.getDevice(deviceId);
        if (device.status === 'revoked') {
            throw { status: 403, message: `Device ${deviceId} is revoked and cannot request challenges.` };
        }
        const nonce = crypto.randomBytes(32).toString('hex');
        challengeStore.set(deviceId, { nonce, timestamp: Date.now() });
        return { nonce };
    } catch (error) {
        if (error.status) throw error;
        throw { status: 404, message: 'Device not found or not active' };
    }
}

async function verifyAuthentication({ deviceId, signature }) {
    if (!deviceId || !signature) {
        throw { status: 400, message: 'Missing deviceId or signature' };
    }
    const challenge = challengeStore.get(deviceId);
    if (!challenge) {
        throw { status: 400, message: 'No active challenge for this device' };
    }
    try {
        await fabricService.verifyAuthentication(deviceId, challenge.nonce, signature);
        challengeStore.delete(deviceId);
        return { message: 'Authentication successful', token: 'mock-jwt-token-for-' + deviceId };
    } catch (error) {
        throw { status: 401, message: 'Authentication failed' };
    }
}

async function getDevices() {
    try {
        return await fabricService.getAllDevices();
    } catch (error) {
        throw { status: 500, message: 'Failed to fetch devices from ledger' };
    }
}

async function getBlockHeight() {
    try {
        const height = await fabricService.getBlockHeight();
        return { height };
    } catch (error) {
        throw { status: 500, message: 'Failed to query block height' };
    }
}

async function getDevice(deviceId) {
    try {
        return await fabricService.getDevice(deviceId);
    } catch (error) {
        throw { status: 404, message: 'Device not found' };
    }
}

async function revokeDevice({ deviceId }) {
    if (!deviceId) {
        throw { status: 400, message: 'Missing deviceId' };
    }
    try {
        await fabricService.revokeDevice(deviceId);
        return { message: 'Device revoked successfully', deviceId };
    } catch (error) {
        throw { status: 500, message: error.message || 'Failed to revoke device' };
    }
}

async function suspendDevice({ deviceId }) {
    if (!deviceId) {
        throw { status: 400, message: 'Missing deviceId' };
    }
    try {
        await fabricService.suspendDevice(deviceId);
        return { message: 'Device suspended successfully', deviceId };
    } catch (error) {
        throw { status: 500, message: error.message || 'Failed to suspend device' };
    }
}

function recordLatency(data) {
    const { deviceId, latencyMs, source, keyGenMs, registrationMs, signingMs, payloadBytes } = data;
    if (!deviceId || latencyMs === undefined) {
        throw { status: 400, message: 'Missing deviceId or latencyMs' };
    }
    simulatorLatencies.push({
        deviceId,
        latencyMs: Number(latencyMs),
        keyGenMs: keyGenMs !== undefined ? Number(keyGenMs) : null,
        registrationMs: registrationMs !== undefined ? Number(registrationMs) : null,
        signingMs: signingMs !== undefined ? Number(signingMs) : null,
        payloadBytes: payloadBytes !== undefined ? Number(payloadBytes) : null,
        source: source || 'unknown',
        timestamp: Date.now()
    });
    return { message: 'Latency recorded' };
}

function getLatencyMetrics() {
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

    return {
        count,
        avgMs,
        minMs,
        maxMs,
        latencies: simulatorLatencies
    };
}

function clearLatencyMetrics() {
    simulatorLatencies.length = 0;
    return { message: 'All latency metrics cleared' };
}

module.exports = {
    registerDevice,
    requestChallenge,
    verifyAuthentication,
    getDevices,
    getBlockHeight,
    getDevice,
    revokeDevice,
    suspendDevice,
    recordLatency,
    getLatencyMetrics,
    clearLatencyMetrics
};
