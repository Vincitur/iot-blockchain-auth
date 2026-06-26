// Marius-Remus Dumitrel - Hyperledger Fabric Service - Node.js Implementation for IoT Authentication Gateway

// Connect to Hyperledger Fabric network and provide functions to interact with the chaincode for device registration, authentication verification, and device management.

const grpc = require('@grpc/grpc-js');
const { connect, signers, hash } = require('@hyperledger/fabric-gateway');
const { common } = require('@hyperledger/fabric-protos');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// channel and chaincode configuration
const channelName = 'mychannel';
const chaincodeName = 'iot-auth';

// Gateway identity — controlled via environment variables so the same codebase
// can run as either Org1 or Org2 (or any future organization in the consortium).
// Defaults preserve the original Org1 behaviour when no env vars are set.
const ORG_NAME      = process.env.FABRIC_ORG            || 'org1';
const mspId         = process.env.FABRIC_MSP_ID         || 'Org1MSP';
const peerEndpoint  = process.env.FABRIC_PEER_ENDPOINT  || 'localhost:7051';
const peerHostAlias = process.env.FABRIC_PEER_HOST      || 'peer0.org1.example.com';

// Disclaimer: to establish a correct connection, I have used Claude AI to assist me with the proper parameters.

// Derive crypto-material paths from the organization name.
// Assuming running from AuthApp/backend
const cryptoPath = path.resolve(__dirname, '..', '..', '..', 'Hyperledger-Fabric', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', `${ORG_NAME}.example.com`);
const keyDirectoryPath = path.resolve(cryptoPath, 'users', `User1@${ORG_NAME}.example.com`, 'msp', 'keystore');
const certDirPath = path.resolve(cryptoPath, 'users', `User1@${ORG_NAME}.example.com`, 'msp', 'signcerts');
const tlsCertPath = path.resolve(cryptoPath, 'peers', `peer0.${ORG_NAME}.example.com`, 'tls', 'ca.crt');

let gateway;
let contract;
let network;

// Establish a new gRPC connection to the peer with TLS credentials
async function newGrpcConnection() {
    const tlsRootCert = fs.readFileSync(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

// Load the user's certificate and private key to create an identity and signer for the Fabric Gateway connection
function newIdentity() {
    const certFiles = fs.readdirSync(certDirPath);
    const certPath = path.join(certDirPath, certFiles[0]); // Typically cert.pem
    const credentials = fs.readFileSync(certPath);
    return { mspId, credentials };
}

// Load the user's private key to create a signer for transaction submission to the Fabric Gateway
function newSigner() {
    const files = fs.readdirSync(keyDirectoryPath);
    const keyPath = path.resolve(keyDirectoryPath, files[0]); // a single private key file
    const privateKeyPem = fs.readFileSync(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

// Initialize the connection to the Hyperledger Fabric network and set up the contract for interactions. 
// This function is called before starting the Express server to ensure that the backend is ready to handle requests that interact with the blockchain.
async function initFabric() {
    try {
        const client = await newGrpcConnection();
        gateway = connect({
            client,
            identity: newIdentity(),
            signer: newSigner(),
            evaluateOptions: () => {
                return { deadline: Date.now() + 5000 };
            },
            endorseOptions: () => {
                return { deadline: Date.now() + 15000 };
            },
            submitOptions: () => {
                return { deadline: Date.now() + 5000 };
            },
            commitStatusOptions: () => {
                return { deadline: Date.now() + 60000 };
            },
        });

        // Get the network (channel) and contract (chaincode) objects for interacting with the blockchain
        network = gateway.getNetwork(channelName);
        contract = network.getContract(chaincodeName);
        console.log(`Successfully connected to Fabric Gateway (${mspId} -> ${peerEndpoint})`);
    } catch (error) {
        console.error('Error connecting to Fabric Gateway:', error);
        process.exit(1);
    }
}

// Function to register a new device on the blockchain by submitting a transaction to the chaincode.
async function registerDevice(deviceId, deviceType, publicKey) {
    console.log(`Submitting RegisterDevice transaction for ${deviceId}...`);
    try {
        await contract.submitTransaction('RegisterDevice', deviceId, deviceType, publicKey);
        return { success: true };
    } catch (error) {
        console.error('Failed to submit RegisterDevice:', error);
        throw error;
    }
}

// Function to verify the authentication of a device by submitting a transaction to the chaincode with the device ID, nonce, timestamp, and signature.
async function verifyAuthentication(deviceId, nonce, timestamp, signatureBase64) {
    console.log(`Submitting VerifyAuthentication transaction for ${deviceId}...`);
    try {
        await contract.submitTransaction('VerifyAuthentication', deviceId, nonce, timestamp, signatureBase64);
        return { success: true };
    } catch (error) {
        console.error('Failed to submit VerifyAuthentication:', error);
        throw error;
    }
}

// Function to retrieve device information from the blockchain by evaluating a transaction on the chaincode with the device ID.
async function getDevice(deviceId) {
    console.log(`Evaluating GetDevice query for ${deviceId}...`);
    try {
        const resultBytes = await contract.evaluateTransaction('GetDevice', deviceId);
        const resultJson = new TextDecoder().decode(resultBytes);
        return JSON.parse(resultJson);
    } catch (error) {
        console.error('Failed to evaluate GetDevice:', error);
        throw error;
    }
}

// Function to revoke a device's authentication by submitting a transaction to the chaincode with the device ID. This marks the device as revoked on the blockchain.
async function revokeDevice(deviceId) {
    console.log(`Submitting RevokeDevice transaction for ${deviceId}...`);
    try {
        await contract.submitTransaction('RevokeDevice', deviceId);
        return { success: true };
    } catch (error) {
        console.error('Failed to submit RevokeDevice:', error);
        throw error;
    }
}

// Function to temporarily suspend a device by submitting a transaction to the chaincode. 
// Suspended devices can be re-authenticated to return to 'active' status, unlike revoked devices.
async function suspendDevice(deviceId) {
    console.log(`Submitting SuspendDevice transaction for ${deviceId}...`);
    try {
        await contract.submitTransaction('SuspendDevice', deviceId);
        return { success: true };
    } catch (error) {
        console.error('Failed to submit SuspendDevice:', error);
        throw error;
    }
}

// Function to retrieve all device records from the blockchain.
// Uses the GetAllDevices chaincode method which iterates over the world state.
async function getAllDevices() {
    console.log('Evaluating GetAllDevices query...');
    try {
        const resultBytes = await contract.evaluateTransaction('GetAllDevices');
        const resultJson = new TextDecoder().decode(resultBytes);
        return JSON.parse(resultJson);
    } catch (error) {
        console.error('Failed to evaluate GetAllDevices:', error);
        throw error;
    }
}

// Query the system chaincode (qscc) to get the current blockchain height (BH)
// GetChainInfo returns a protobuf-encoded BlockchainInfo message whose first field is the block height.
async function getBlockHeight() {
    console.log('Querying qscc GetChainInfo...');
    try {
        const qscc = network.getContract('qscc');
        const resultBytes = await qscc.evaluateTransaction('GetChainInfo', channelName);
        const chainInfo = common.BlockchainInfo.deserializeBinary(resultBytes);
        return Number(chainInfo.getHeight());
    } catch (error) {
        console.error('Failed to query block height:', error);
        throw error;
    }
}

// Export the functions for use in other parts of the application, such as the API routes defined in app.js.
module.exports = {
    initFabric,
    registerDevice,
    verifyAuthentication,
    getDevice,
    getAllDevices,
    revokeDevice,
    suspendDevice,
    getBlockHeight
};
