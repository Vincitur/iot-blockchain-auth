// Marius-Remus Dumitrel - device.js - IoT Device Simulator for Decentralized Authentication Framework

// This script simulates an IoT device that registers itself and authenticates with the decentralized authentication gateway.
// It supports both CoAP/CBOR and HTTP/JSON transports, with application-layer security implemented via ECDH key exchange and AES-256-CBC encryption.
// The simulator generates its own ECDSA key pair, registers with the gateway, requests an authentication challenge, signs the challenge, and verifies the authentication response.
// It also measures and reports latency metrics for each operation to the backend for performance monitoring.


const crypto = require('crypto');
const coap = require('coap');
const { encode, decode } = require('cbor-x');
const axios = require('axios');
const { performance } = require('perf_hooks');
const os = require('os');

// Transport selection: if HTTP_URL is set, use HTTP/JSON; otherwise use CoAP/CBOR
const HTTP_URL = process.env.HTTP_URL || '';
const COAP_URL = process.env.COAP_URL || 'coap://127.0.0.1:5683/api/v1';
const USE_HTTP = HTTP_URL.length > 0;
const SOURCE   = process.env.SOURCE   || 'docker-simulator';
const REGISTRATION_PSK = process.env.REGISTRATION_PSK || 'iot-device-psk-2024';

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

// CoAP/CBOR transport ─────────────────────────────────────────────────────
// Helper to send CoAP POST requests with CBOR payload
// Returns { data, payloadBytes } where payloadBytes is the size of the CBOR-encoded request body
function coapPost(endpoint, data) {
    return new Promise((resolve, reject) => {
        const urlString = `${COAP_URL}/${endpoint}`;
        const url = new URL(urlString);
        const req = coap.request({
            pathname: url.pathname,
            host: url.hostname,
            port: url.port || 5683,
            method: 'POST'
        });
        
        const encodedPayload = encode(data);
        const payloadBytes = encodedPayload.length;

        req.on('response', (res) => {
            let responseData = null;
            if (res.payload && res.payload.length > 0) {
                try {
                    responseData = decode(res.payload);
                } catch (e) {
                    console.error('Failed to decode CBOR response', e);
                }
            }
            if (res.code.startsWith('2.')) {
                resolve({ data: responseData, payloadBytes });
            } else {
                reject({ response: { data: responseData, status: res.code } });
            }
        });

        req.on('error', reject);
        req.write(encodedPayload);
        req.end();
    });
}

// HTTP/JSON transport ─────────────────────────────────────────────────────
// Fallback for environments where UDP is not routable (Docker Desktop + WSL).
// Returns { data, payloadBytes } to match coapPost signature.
async function httpPost(endpoint, data) {
    const jsonPayload = JSON.stringify(data);
    const payloadBytes = Buffer.byteLength(jsonPayload);
    const res = await axios.post(`${HTTP_URL}/${endpoint}`, data);
    return { data: res.data, payloadBytes };
}

// Unified transport function — selects CoAP or HTTP based on configuration
function coapGet(endpoint) {
    return new Promise((resolve, reject) => {
        const urlString = `${COAP_URL}/${endpoint}`;
        const url = new URL(urlString);
        const req = coap.request({
            pathname: url.pathname,
            host: url.hostname,
            port: url.port || 5683,
            method: 'GET'
        });
        
        req.on('response', (res) => {
            let responseData = null;
            if (res.payload && res.payload.length > 0) {
                try {
                    responseData = decode(res.payload);
                } catch (e) {
                    console.error('Failed to decode CBOR response', e);
                }
            }
            if (res.code.startsWith('2.')) {
                resolve({ data: responseData, payloadBytes: res.payload ? res.payload.length : 0 });
            } else {
                reject({ response: { data: responseData, status: res.code } });
            }
        });

        req.on('error', reject);
        req.end();
    });
}

// HTTP GET helper that returns { data, payloadBytes } to match coapGet signature
async function httpGet(endpoint) {
    const res = await axios.get(`${HTTP_URL}/${endpoint}`);
    return { data: res.data, payloadBytes: res.data ? Buffer.byteLength(JSON.stringify(res.data)) : 0 };
}

function get(endpoint) {
    return USE_HTTP ? httpGet(endpoint) : coapGet(endpoint);
}

// Unified transport function — selects CoAP or HTTP based on configuration
function post(endpoint, data) {
    return USE_HTTP ? httpPost(endpoint, data) : coapPost(endpoint, data);
}

// Application-Layer Security via ECDH and AES-256-CBC

// Convert raw EC public key (65 bytes uncompressed) to SPKI PEM (the format expected by the gateway and chaincode for signature verification)
// Disclaimer: The assistence of AI was used for this conversion function, as the PEM format is quite particular and the Node.js crypto library does not provide a direct way to convert raw EC keys to PEM.
// Disclaimer: this is a simplified conversion that assumes the key is always in uncompressed format and uses a fixed ASN.1 header for secp256r1 keys. In production, we need to consider using a proper library for key handling.
function rawPublicKeyToSPKIPem(rawKeyBuffer) {
    const spkiHeader = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    const spki = Buffer.concat([spkiHeader, rawKeyBuffer]);
    const b64 = spki.toString('base64');
    const lines = b64.match(/.{1,64}/g).join('\n');
    return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

// Extract raw EC public key bytes from SPKI PEM (strip 26-byte ASN.1 header)
function spkiPemToRawPublicKey(pem) {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Buffer.from(b64, 'base64');
    return der.slice(26);
}

// securePost performs an application-layer encryption of the payload using ECDH key exchange and AES-256-CBC encryption before sending it to the gateway. 
// It also decrypts the response from the gateway using the same derived AES key. 
// This ensures that sensitive information like device credentials and authentication signatures are not exposed in plaintext over the network, even if CoAP is used without DTLS.
async function securePost(endpoint, payload, gatewayPubPEM) {
    const encStart = performance.now();
    // 1. Generate ephemeral ECDH key
    const ephemeral = crypto.createECDH('prime256v1');
    ephemeral.generateKeys();
    const ephemeralPublicKey = rawPublicKeyToSPKIPem(ephemeral.getPublicKey());
    
    // 2. Derive shared secret and AES key
    const rawGatewayKey = spkiPemToRawPublicKey(gatewayPubPEM);
    const sharedSecret = ephemeral.computeSecret(rawGatewayKey);
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
    
    // 3. Encrypt payload
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    let ciphertext = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const encEnd = performance.now();
    const encryptionMs = Math.round(encEnd - encStart);
    
    // 4. Send encrypted payload
    const response = await post(endpoint, {
        ephemeralPublicKey,
        iv: iv.toString('hex'),
        ciphertext
    });
    
    // 5. Decrypt response
    if (response.data && response.data.ciphertext) {
        const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, Buffer.from(response.data.iv, 'hex'));
        let decrypted = decipher.update(response.data.ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        response.data = JSON.parse(decrypted);
    }
    response.encryptionMs = encryptionMs;
    return response;
}

async function main() {
    // Stagger startup when running as part of a fleet
    await randomDelay();

    // Use DEVICE_ID env var, or generate a unique one from the container hostname + random suffix
    const deviceId = process.env.DEVICE_ID || `sim-${os.hostname().slice(0, 6)}-${Math.floor(Math.random() * 10000)}`;
    const deviceType = process.env.DEVICE_TYPE || SENSOR_TYPES[Math.floor(Math.random() * SENSOR_TYPES.length)];

    const protocol = USE_HTTP ? 'HTTP/JSON' : 'CoAP/CBOR';
    const target   = USE_HTTP ? HTTP_URL : COAP_URL;
    console.log(`[+] Initializing Simulator for ${deviceId} (${deviceType})`);
    console.log(`    Transport: ${protocol} → ${target}\n`);

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
    const keyGenTime = Math.round(t1 - t0);
    console.log(`    Key Generation took: ${(t1 - t0).toFixed(2)} ms\n`);

    // Track total payload bytes sent across all operations (for protocol efficiency comparison)
    let totalPayloadBytes = 0;

    // 1.5 Fetch Gateway Public Key for Application-Layer Security
    console.log('[+] Fetching Gateway Public Key...');
    let gatewayPubPEM = '';
    try {
        const gwRes = await get('gateway/key');
        gatewayPubPEM = gwRes.data.publicKey;
        console.log('    Gateway public key received.\n');
    } catch (error) {
        console.error('    Failed to fetch Gateway public key:', error.message);
        return;
    }

    // 2. Register Device
    console.log(`[+] Registering device on Decentralized Framework (via ${protocol})...`);
    const regStart = performance.now();
    let registrationTime;
    try {
        const regResult = await securePost('devices/register', {
            deviceId,
            deviceType,
            publicKey,
            psk: REGISTRATION_PSK
        }, gatewayPubPEM);
        totalPayloadBytes += regResult.payloadBytes;
        const regEnd = performance.now();
        registrationTime = Math.round(regEnd - regStart);
        console.log(`    Registration Successful! (${registrationTime} ms, ${regResult.payloadBytes} bytes)\n`);
    } catch (error) {
        console.error('    Registration Failed:', error.response ? error.response.data : error.message);
        return;
    }

    // 3. Request Challenge
    console.log('[+] Requesting Authentication Challenge...');
    let nonce;
    let totalEncryptionMs = 0;
    const authStart = performance.now();
    try {
        const response = await securePost('auth/challenge', { deviceId }, gatewayPubPEM);
        totalPayloadBytes += response.payloadBytes;
        totalEncryptionMs += response.encryptionMs;
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
    const deviceTimestampStr = new Date().toISOString(); // Added Timestamp
    sign.update(nonce + deviceTimestampStr); // Sign both nonce and timestamp
    sign.end();
    // Emit signature in base64 to match chaincode verification logic
    const signatureBase64 = sign.sign(privateKey, 'base64');
    const t3 = performance.now();
    const signingTime = Math.round(t3 - t2);
    console.log(`    Cryptographic Signature generation took: ${(t3 - t2).toFixed(2)} ms\n`);

    // 5. Verify Authentication
    console.log('[+] Authenticating Response (Blockchain Verification)...');
    try {
        const response = await securePost('auth/verify', {
            deviceId,
            timestamp: deviceTimestampStr, // Send timestamp to gateway
            signature: signatureBase64
        }, gatewayPubPEM);
        totalPayloadBytes += response.payloadBytes;
        totalEncryptionMs += response.encryptionMs;
        const authEnd = performance.now();
        const authLatency = Math.round(authEnd - authStart);
        console.log(`    Authentication Successful! Received Token: ${response.data.token}`);
        console.log(`    End-to-end Auth Latency: ${authLatency} ms`);
        console.log(`    Total ${USE_HTTP ? 'JSON' : 'CBOR'} payload sent: ${totalPayloadBytes} bytes\n`);

        // 6. Report the measured latency back to the backend so the frontend dashboard can display it
        try {
            await post('metrics/latency', {
                deviceId,
                latencyMs: authLatency,
                keyGenMs: keyGenTime,
                registrationMs: registrationTime,
                signingMs: signingTime,
                encryptionMs: totalEncryptionMs,
                payloadBytes: totalPayloadBytes,
                source: SOURCE,
                protocol: USE_HTTP ? 'http' : 'coap'
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
