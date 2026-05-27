// Marius-Remus Dumitrel - Controllers - Business Logic for IoT Authentication Gateway

// This module contains the core business logic for handling device registration, authentication challenges, and interactions with the Hyperledger Fabric chaincode.
// It also includes functions for recording and retrieving latency metrics reported by IoT device simulators.

const crypto = require('crypto');
const fabricService = require('./fabricService');
const cryptoHelper = require('./cryptoHelper');

// In-memory store for challenge nonces mapped to device IDs
const challengeStore = new Map();

// In-memory store for simulator-reported authentication latencies.
const simulatorLatencies = [];

// 1. getGatewayKey returns the public key of the authentication gateway, which IoT devices can use to encrypt their registration and authentication requests. 
// This allows devices to securely communicate sensitive information without exposing it in plaintext over the network.
async function getGatewayKey() {
    return { publicKey: cryptoHelper.getPublicKeyPEM() };
}

// 2. Pre-Shared Key for device registration authorization (Sybil attack prevention)
const REGISTRATION_PSK = process.env.REGISTRATION_PSK || 'iot-device-psk-2024';

// registerDevice handles the registration of a new IoT device. 
// It expects an encrypted payload containing the device's information and a valid Pre-Shared Key (PSK) to authorize the registration.
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

// requestChallenge generates a unique nonce for the device to sign, which is used in the authentication process. 
// It checks if the device is active before issuing a challenge.
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

// verifyAuthentication validates the authentication signature provided by the IoT device against the expected challenge.
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

// getDevices retrieves the list of all registered devices from the Hyperledger Fabric ledger.
async function getDevices() {
    try {
        return await fabricService.getAllDevices();
    } catch (error) {
        throw { status: 500, message: 'Failed to fetch devices from ledger' };
    }
}

// getBlockHeight retrieves the current block height of the Hyperledger Fabric ledger, which can be useful for monitoring and debugging purposes.
async function getBlockHeight() {
    try {
        const height = await fabricService.getBlockHeight();
        return { height };
    } catch (error) {
        throw { status: 500, message: 'Failed to query block height' };
    }
}

// getDevice retrieves the details of a specific device by its ID from the Hyperledger Fabric ledger. It throws a 404 error if the device is not found.
async function getDevice(deviceId) {
    try {
        return await fabricService.getDevice(deviceId);
    } catch (error) {
        throw { status: 404, message: 'Device not found' };
    }
}

// revokeDevice revokes the authentication status of a specific device by its ID.
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

// suspendDevice suspends a specific device by its ID, preventing it from requesting authentication challenges or authenticating until it is reactivated.
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

// recordLatency allows IoT device simulators to report the latency of their authentication operations, which I use for performance monitoring and analysis. 
// It expects a payload containing the device ID, latency in milliseconds, and optional metadata about the operation.
function recordLatency(data) {
    const { deviceId, latencyMs, source, keyGenMs, registrationMs, signingMs, encryptionMs, payloadBytes, protocol } = data;
    if (!deviceId || latencyMs === undefined) {
        throw { status: 400, message: 'Missing deviceId or latencyMs' };
    }
    simulatorLatencies.push({
        deviceId,
        latencyMs: Number(latencyMs),
        keyGenMs: keyGenMs !== undefined ? Number(keyGenMs) : null,
        registrationMs: registrationMs !== undefined ? Number(registrationMs) : null,
        signingMs: signingMs !== undefined ? Number(signingMs) : null,
        encryptionMs: encryptionMs !== undefined ? Number(encryptionMs) : null,
        payloadBytes: payloadBytes !== undefined ? Number(payloadBytes) : null,
        source: source || 'unknown',
        protocol: protocol || null,
        timestamp: Date.now()
    });
    return { message: 'Latency recorded' };
}

// getLatencyMetrics calculates and returns aggregated latency metrics based on the data reported by IoT device simulators.
// It includes average, minimum, and maximum latency, as well as the count of recorded latencies and the raw latency data for further analysis.
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

// clearLatencyMetrics clears all recorded latency metrics from the in-memory store, allowing for a fresh start in performance monitoring and analysis.
function clearLatencyMetrics() {
    simulatorLatencies.length = 0;
    return { message: 'All latency metrics cleared' };
}

// getOrdererConfig queries the current BatchTimeout and MaxMessageCount from the live Fabric channel configuration.
// It executes the updateBatchTimeout.sh script in --query mode and parses the JSON output.
async function getOrdererConfig() {
    const { execSync } = require('child_process');
    const path = require('path');
    const scriptPath = path.resolve(__dirname, '..', '..', 'updateBatchTimeout.sh');
    try {
        const output = execSync(`bash ./updateBatchTimeout.sh --query`, {
            timeout: 30000,
            encoding: 'utf-8',
            cwd: path.resolve(__dirname, '..', '..')
        });
        // The script outputs multiple lines; the JSON is on the last non-empty line
        const lines = output.trim().split('\n').filter(l => l.trim().length > 0);
        const jsonLine = lines[lines.length - 1];
        return JSON.parse(jsonLine);
    } catch (error) {
        console.error('Failed to query orderer config:', error.message);
        throw { status: 500, message: 'Failed to query orderer configuration: ' + (error.stderr || error.message) };
    }
}

// updateOrdererConfig applies new BatchTimeout and/or MaxMessageCount values to the live Fabric channel
// by executing a Channel Configuration Update Transaction via the updateBatchTimeout.sh script.
async function updateOrdererConfig({ batchTimeout, maxMessageCount }) {
    if (!batchTimeout) {
        throw { status: 400, message: 'Missing batchTimeout parameter' };
    }
    const { execSync } = require('child_process');
    const path = require('path');
    const scriptPath = path.resolve(__dirname, '..', '..', 'updateBatchTimeout.sh');

    let cmd = `bash ./updateBatchTimeout.sh "${batchTimeout}"`;
    if (maxMessageCount !== undefined && maxMessageCount !== null) {
        cmd += ` ${maxMessageCount}`;
    }

    try {
        const output = execSync(cmd, {
            timeout: 60000,
            encoding: 'utf-8',
            cwd: path.resolve(__dirname, '..', '..')
        });
        console.log('[OrdererConfig] Update output:', output);
        // Parse the JSON result from the last line
        const lines = output.trim().split('\n').filter(l => l.trim().length > 0);
        const jsonLine = lines[lines.length - 1];
        const result = JSON.parse(jsonLine);
        return { message: 'Orderer configuration updated successfully', ...result };
    } catch (error) {
        console.error('Failed to update orderer config:', error.message);
        throw { status: 500, message: 'Failed to update orderer configuration: ' + (error.stderr || error.message) };
    }
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
    getGatewayKey,
    getOrdererConfig,
    updateOrdererConfig
};

