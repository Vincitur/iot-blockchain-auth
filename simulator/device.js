// DEMO simulator for IoT Device Registration and Authentication
// This script simulates the lifecycle of an IoT device interacting with the decentralized authentication framework. 
// It generates cryptographic credentials, registers the device, requests an authentication challenge, signs the challenge, and verifies authentication through the API endpoints defined in routes.js.

const crypto = require('crypto');
const axios = require('axios');
const { performance } = require('perf_hooks');
const os = require('os');

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000/api/v1';

// Sensor types to randomly pick from when DEVICE_TYPE is not specified
const SENSOR_TYPES = [
    'temperature_sensor',
    'humidity_sensor',
    'motion_detector',
    'pressure_sensor',
    'gas_sensor',
    'light_sensor',
    'vibration_sensor',
];

// Small random delay (0–3s) to stagger concurrent container startups and avoid overwhelming the Fabric orderer
function randomDelay() {
    const ms = Math.floor(Math.random() * 3000);
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    // Stagger startup when running as part of a fleet
    await randomDelay();

    // Use DEVICE_ID env var, or generate a unique one from the container hostname + random suffix
    const deviceId = process.env.DEVICE_ID || `sim-${os.hostname().slice(0, 6)}-${Math.floor(Math.random() * 10000)}`;
    const deviceType = process.env.DEVICE_TYPE || SENSOR_TYPES[Math.floor(Math.random() * SENSOR_TYPES.length)];

    console.log(`[+] Initializing Simulator for ${deviceId} (${deviceType})`);

    // 1. Generate local credentials (secp256r1 ECDSA key pair)
    console.log('[+] Generating secp256r1 ECDSA key pair...');
    const t0 = performance.now();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // Equivalent to secp256r1
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'sec1',
            format: 'pem'
        }
    });
    const t1 = performance.now();
    console.log(`    Key Generation took: ${(t1 - t0).toFixed(2)} ms\n`);

    // 2. Register Device
    console.log('[+] Registering device on Decentralized Framework (via API)...');
    try {
        await axios.post(`${API_URL}/devices/register`, {
            deviceId,
            deviceType,
            publicKey
        });
        console.log('    Registration Successful!\n');
    } catch (error) {
        console.error('    Registration Failed:', error.response ? error.response.data : error.message);
        return;
    }

    // 3. Request Challenge
    console.log('[+] Requesting Authentication Challenge...');
    let nonce;
    const authStart = performance.now();
    try {
        const response = await axios.post(`${API_URL}/auth/challenge`, { deviceId });
        nonce = response.data.nonce;
        console.log(`    Received Nonce: ${nonce}\n`);
    } catch (error) {
        console.error('    Challenge Request Failed:', error.response ? error.response.data : error.message);
        return;
    }

    // 4. Sign Challenge
    console.log('[+] Signing Nonce...');
    const t2 = performance.now();
    const sign = crypto.createSign('SHA256');
    sign.update(nonce);
    sign.end();
    // Emit signature in base64 to match chaincode verification logic
    const signatureBase64 = sign.sign(privateKey, 'base64');
    const t3 = performance.now();
    console.log(`    Cryptographic Signature generation took: ${(t3 - t2).toFixed(2)} ms\n`);

    // 5. Verify Authentication
    console.log('[+] Authenticating Response (Blockchain Verification)...');
    try {
        const response = await axios.post(`${API_URL}/auth/verify`, {
            deviceId,
            signature: signatureBase64
        });
        const authEnd = performance.now();
        const authLatency = Math.round(authEnd - authStart);
        console.log(`    Authentication Successful! Received Token: ${response.data.token}`);
        console.log(`    End-to-end Auth Latency: ${authLatency} ms\n`);

        // 6. Report the measured latency back to the backend so the frontend dashboard can display it
        try {
            await axios.post(`${API_URL}/metrics/latency`, {
                deviceId,
                latencyMs: authLatency,
                source: 'docker-simulator'
            });
            console.log(`    Latency reported to backend ✓\n`);
        } catch (err) {
            console.warn('    Warning: Could not report latency to backend:', err.message);
        }
    } catch (error) {
        console.error('    Authentication Failed:', error.response ? error.response.data : error.message);
    }
}

main().catch(console.error);
