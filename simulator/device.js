// DEMO simulator for IoT Device Registration and Authentication
// This script simulates the lifecycle of an IoT device interacting with the decentralized authentication framework. 
// It generates cryptographic credentials, registers the device, requests an authentication challenge, signs the challenge, and verifies authentication through the API endpoints defined in routes.js.

const crypto = require('crypto');
const axios = require('axios');
const { performance } = require('perf_hooks');

const API_URL = 'http://127.0.0.1:3000/api/v1';

async function main() {
    const deviceId = `sensor-${Math.floor(Math.random() * 10000)}`;
    const deviceType = 'temperature_sensor';

    console.log(`[+] Initializing Simulator for ${deviceId}`);

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
        console.log(`    Authentication Successful! Received Token: ${response.data.token}\n`);
    } catch (error) {
        console.error('    Authentication Failed:', error.response ? error.response.data : error.message);
    }
}

main().catch(console.error);
