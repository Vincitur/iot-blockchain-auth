// Marius-Remus Dumitrel - Crypto Helper - Node.js Implementation for IoT Authentication Gateway

// This module provides cryptographic functions for the IoT Authentication Gateway, including ECDH key management and AES encryption/decryption.
// It initializes the gateway's ECDH key pair, provides the public key in PEM format for devices to use, and handles encryption/decryption of messages using AES-256-CBC with keys derived from ECDH shared secrets.

const crypto = require('crypto');

let gatewayECDH = null;
let gatewayPublicKeyPEM = null;

// Initialize the ECDH key pair for the gateway
function init() {
    if (!gatewayECDH) {
        gatewayECDH = crypto.createECDH('prime256v1'); // secp256r1
        gatewayECDH.generateKeys();

        // Pre-compute the PEM (SPKI) representation of the gateway public key.
        // ECDH.getPublicKey() returns the raw EC point (uncompressed, 65 bytes for P-256).
        // We wrap it in a proper SPKI ASN.1 structure so browsers/OpenSSL can import it.
        const rawPub = gatewayECDH.getPublicKey();
        gatewayPublicKeyPEM = rawPublicKeyToSPKIPem(rawPub);

        console.log('[CryptoHelper] Gateway ECDH KeyPair generated.');
    }
}

/**
 * Convert a raw EC public key (uncompressed point) to SPKI PEM.
 * For P-256, the raw key is 65 bytes (0x04 || x || y).
 * SPKI wraps it with an AlgorithmIdentifier for id-ecPublicKey + prime256v1.
 */
function rawPublicKeyToSPKIPem(rawKeyBuffer) {
    // ASN.1 SPKI header for EC P-256 (fixed 26-byte prefix)
    const spkiHeader = Buffer.from(
        '3059301306072a8648ce3d020106082a8648ce3d030107034200',
        'hex'
    );
    const spki = Buffer.concat([spkiHeader, rawKeyBuffer]);
    const b64 = spki.toString('base64');
    const lines = b64.match(/.{1,64}/g).join('\n');
    return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

/**
 * Extract the raw EC public key bytes from a PEM (SPKI) string.
 * Strips the 26-byte ASN.1 header to get the raw 65-byte uncompressed point.
 */
function spkiPemToRawPublicKey(pem) {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Buffer.from(b64, 'base64');
    // For P-256 SPKI, the header is 26 bytes; the remaining 65 bytes are the raw EC point
    return der.slice(26);
}

// Return the gateway's public key in PEM (SPKI) format
function getPublicKeyPEM() {
    if (!gatewayECDH) init();
    return gatewayPublicKeyPEM;
}

/**
 * Decrypt an incoming request using the temporary public key of the device.
 * @param {string} temporaryPublicKeyPem - The device's temporary public key in PEM format
 * @param {string} ivHex - The Initialization Vector (hex)
 * @param {string} ciphertextHex - The AES-256-CBC encrypted ciphertext (hex)
 * @returns {object} The decrypted and parsed JSON payload
 */

// This function is used in the CoAP server to decrypt incoming requests from devices. 
// The device encrypts the payload using AES-256-CBC with a key derived from the ECDH shared secret (using the gateway's public key and the device's temporary private key). 
// The gateway uses its ECDH private key and the device's temporary public key to derive the same shared secret, then hashes it to get the AES key, and finally decrypts the payload.
function decryptRequest(temporaryPublicKeyPem, ivHex, ciphertextHex) {
    if (!gatewayECDH) init();
    
    // 1. Convert PEM to raw EC point and derive shared secret
    const rawPeerKey = spkiPemToRawPublicKey(temporaryPublicKeyPem);
    const sharedSecret = gatewayECDH.computeSecret(rawPeerKey);
    
    // 2. Hash shared secret with SHA-256 to create a 32-byte AES key
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
    
    // 3. Decrypt ciphertext using AES-256-CBC
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // 4. Parse the original JSON payload
    return JSON.parse(decrypted);
}

/**
 * Encrypt an outgoing response using the same shared secret (derived from temporary public key).
 * @param {string} temporaryPublicKeyPem - The device's temporary public key in PEM format
 * @param {object} payload - The JSON payload to encrypt
 * @returns {object} { iv: string(hex), ciphertext: string(hex) }
 */

// This function is used in the CoAP server to encrypt responses back to the device. 
// It uses the same ECDH shared secret derived from the device's temporary public key and the gateway's private key to create an AES key.
// Then encrypts the JSON payload with AES-256-CBC and returns the IV and ciphertext in hex format.
function encryptResponse(temporaryPublicKeyPem, payload) {
    if (!gatewayECDH) init();
    
    // 1. Convert PEM to raw EC point and derive shared secret
    const rawPeerKey = spkiPemToRawPublicKey(temporaryPublicKeyPem);
    const sharedSecret = gatewayECDH.computeSecret(rawPeerKey);
    
    // 2. Hash shared secret with SHA-256 to create a 32-byte AES key
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
    
    // 3. Generate random 16-byte IV
    const iv = crypto.randomBytes(16);
    
    // 4. Encrypt payload using AES-256-CBC
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    let ciphertext = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    
    return {
        iv: iv.toString('hex'),
        ciphertext
    };
}

module.exports = {
    init,
    getPublicKeyPEM,
    decryptRequest,
    encryptResponse
};
