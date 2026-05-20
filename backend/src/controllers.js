const crypto = require('crypto');
const fabricService = require('./fabricService');
const cryptoHelper = require('./cryptoHelper');

// In-memory store for challenge nonces mapped to device IDs
const challengeStore = new Map();

// In-memory store for simulator-reported authentication latencies.
const simulatorLatencies = [];

async function getGatewayKey() {
    return { publicKey: cryptoHelper.getPublicKeyPEM() };
}

// Pre-Shared Key for device registration authorization (Sybil attack prevention)
const REGISTRATION_PSK = process.env.REGISTRATION_PSK || 'iot-device-psk-2024';

async function registerDevice({ ephemeralPublicKey, iv, ciphertext }) {
    if (!ephemeralPublicKey || !iv || !ciphertext) {
        throw { status: 400, message: 'Missing encryption parameters' };
    }
    try {
        const payload = cryptoHelper.decryptRequest(ephemeralPublicKey, iv, ciphertext);
        const { deviceId, deviceType, publicKey, psk } = payload;
        
        if (!deviceId || !deviceType || !publicKey) {
            throw { status: 400, message: 'Missing required fields in decrypted payload' };
        }

        // Validate Pre-Shared Key to prevent unauthorized registration (Sybil attack mitigation)
        if (!psk || psk !== REGISTRATION_PSK) {
            throw { status: 403, message: 'Registration denied: Invalid or missing Pre-Shared Key (PSK)' };
        }
        
        await fabricService.registerDevice(deviceId, deviceType, publicKey);
        
        const responsePayload = { message: 'Device registered successfully', deviceId };
        return cryptoHelper.encryptResponse(ephemeralPublicKey, responsePayload);
    } catch (error) {
        throw { status: 500, message: error.message || 'Failed to register device' };
    }
}

async function requestChallenge({ ephemeralPublicKey, iv, ciphertext }) {
    if (!ephemeralPublicKey || !iv || !ciphertext) {
        throw { status: 400, message: 'Missing encryption parameters' };
    }
    try {
        const payload = cryptoHelper.decryptRequest(ephemeralPublicKey, iv, ciphertext);
        const { deviceId } = payload;
        
        if (!deviceId) {
            throw { status: 400, message: 'Missing deviceId in decrypted payload' };
        }
        
        const device = await fabricService.getDevice(deviceId);
        if (device.status === 'revoked') {
            throw { status: 403, message: `Device ${deviceId} is revoked and cannot request challenges.` };
        }
        const nonce = crypto.randomBytes(32).toString('hex');
        challengeStore.set(deviceId, { nonce, timestamp: Date.now() });
        
        const responsePayload = { nonce };
        return cryptoHelper.encryptResponse(ephemeralPublicKey, responsePayload);
    } catch (error) {
        if (error.status) throw error;
        throw { status: 404, message: 'Device not found or not active' };
    }
}

async function verifyAuthentication({ ephemeralPublicKey, iv, ciphertext }) {
    if (!ephemeralPublicKey || !iv || !ciphertext) {
        throw { status: 400, message: 'Missing encryption parameters' };
    }
    try {
        const payload = cryptoHelper.decryptRequest(ephemeralPublicKey, iv, ciphertext);
        const { deviceId, timestamp, signature } = payload;

        if (!deviceId || !timestamp || !signature) {
            throw { status: 400, message: 'Missing deviceId, timestamp, or signature in decrypted payload' };
        }
        const challenge = challengeStore.get(deviceId);
        if (!challenge) {
            throw { status: 400, message: 'No active challenge for this device' };
        }
        
        await fabricService.verifyAuthentication(deviceId, challenge.nonce, timestamp, signature);
        challengeStore.delete(deviceId);
        
        const responsePayload = { message: 'Authentication successful', token: 'mock-jwt-token-for-' + deviceId };
        return cryptoHelper.encryptResponse(ephemeralPublicKey, responsePayload);
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
    const { deviceId, latencyMs, source, keyGenMs, registrationMs, signingMs, payloadBytes, protocol } = data;
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
        protocol: protocol || null,
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
    clearLatencyMetrics,
    getGatewayKey
};
