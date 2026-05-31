// Marius-Remus Dumitrel - AuthApp - Chaincode Unit Tests
import { Context } from 'fabric-contract-api';
import { ChaincodeStub } from 'fabric-shim';
import { DeviceAuthContract } from '../index';
import * as crypto from 'crypto';

// Jest unit tests for DeviceAuthContract
describe('DeviceAuthContract', () => {
    let contract: DeviceAuthContract;
    let ctx: Context;
    let stub: any;

    beforeEach(() => {          // first we initialize the contract and create a mock context and stub for testing
        contract = new DeviceAuthContract();
        stub = {
            getTxID: jest.fn().mockReturnValue('mockTxId'),
            getTxTimestamp: jest.fn().mockReturnValue({ seconds: Math.floor(Date.now() / 1000) }),
            getState: jest.fn(),
            putState: jest.fn(),
            setEvent: jest.fn(),
            getStateByRange: jest.fn()
        };
        ctx = {
            stub,
            clientIdentity: {} as any,
            logging: {} as any,
        };
    });

    // Now we can write unit tests for each function in the contract, starting with InitLedger and RegisterDevice, 
    // and then moving on to VerifyAuthentication which is the most critical function for my authentication logic.

    describe('InitLedger', () => {  // this test checks that the InitLedger function logs the expected message when called
        it('should initialize the ledger', async () => {
            const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
            await contract.InitLedger(ctx);
            expect(consoleSpy).toHaveBeenCalledWith('============= START : Initialize Ledger ===========');
            consoleSpy.mockRestore();
        });
    });

    // this test checks that a new device can be registered successfully and that the appropriate state is stored and event emitted. 
    // It also checks that if a device with the same ID already exists, an error is thrown.
    describe('RegisterDevice', () => {  
        it('should register a new device', async () => {
            stub.getState.mockResolvedValueOnce(Buffer.from('')); // Device does not exist
            
            await contract.RegisterDevice(ctx, 'device1', 'sensor', 'publicKey123');

            expect(stub.putState).toHaveBeenCalledWith('device1', expect.any(Buffer));
            expect(stub.setEvent).toHaveBeenCalledWith('DeviceRegistered', expect.any(Buffer));
        });

        it('should throw an error if device already exists', async () => {
            stub.getState.mockResolvedValueOnce(Buffer.from('{"deviceId":"device1"}')); // Device exists
            
            await expect(contract.RegisterDevice(ctx, 'device1', 'sensor', 'publicKey123'))
                .rejects.toThrow('The device device1 is already registered on the network.');
        });
    });

    // The VerifyAuthentication tests cover various scenarios including successful authentication, invalid signatures, replay attacks, and expired signatures.
    describe('VerifyAuthentication', () => {
        let keyPair: crypto.KeyPairSyncResult<string, string>; 

        beforeAll(() => {   // I generate a key pair for testing the cryptographic signature verification
            keyPair = crypto.generateKeyPairSync('ec', {
                namedCurve: 'prime256v1',
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            });
        });

        // This test simulates a successful authentication scenario where a device provides a valid signature for the given nonce and timestamp. 
        // It checks that the authentication returns true and that the nonce is marked as used to prevent replay attacks.
        it('should successfully authenticate a device', async () => {
            const deviceId = 'device1';
            const nonce = 'random-nonce-123';
            const timestamp = new Date().toISOString();
            
            const sign = crypto.createSign('SHA256');
            sign.update(nonce + timestamp);
            sign.end();
            const signature = sign.sign(keyPair.privateKey, 'base64'); // the mock device generated signature 

            const mockDevice = {
                docType: 'device',
                deviceId,
                deviceType: 'sensor',
                publicKey: keyPair.publicKey,
                status: 'registered',
                registeredAt: 'mockTxId'
            };

            stub.getState.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockDevice))); // GetDevice
            stub.getState.mockResolvedValueOnce(Buffer.from('')); // Nonce does not exist

            const result = await contract.VerifyAuthentication(ctx, deviceId, nonce, timestamp, signature);

            expect(result).toBe(true);
            expect(stub.putState).toHaveBeenCalled(); // to update status and add audit log
            expect(stub.putState).toHaveBeenCalledWith(`NONCE_${nonce}`, Buffer.from('USED')); // the nonce should be marked as used to prevent replay attacks
        });

        // This test simulates a scenario where the device provides an invalid signature that does not match the expected signature for the given nonce and timestamp. 
        // It checks that the authentication fails and that an appropriate error message is thrown.
        it('should fail if signature is invalid', async () => {
            const deviceId = 'device1';
            const nonce = 'random-nonce-123';
            const timestamp = new Date().toISOString();
            const invalidSignature = 'invalid-signature-data';

            const mockDevice = {
                docType: 'device',
                deviceId,
                deviceType: 'sensor',
                publicKey: keyPair.publicKey, // correct public key, but the signature doesn't match
                status: 'registered',
                registeredAt: 'mockTxId'
            };

            stub.getState.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockDevice))); // GetDevice
            stub.getState.mockResolvedValueOnce(Buffer.from('')); // Nonce does not exist

            await expect(contract.VerifyAuthentication(ctx, deviceId, nonce, timestamp, invalidSignature))
                .rejects.toThrow(`Authentication failed: Invalid cryptographic signature for device ${deviceId}.`);
        });

        // This test simulates a scenario where a device attempts to reuse a nonce, which should be prevented to avoid replay attacks.
        // It checks that the authentication fails and that an appropriate error message is thrown.
        it('should prevent replay attacks by checking nonce', async () => {
            const deviceId = 'device1';
            const nonce = 'used-nonce';
            const timestamp = new Date().toISOString();
            const signature = 'some-signature';

            const mockDevice = { status: 'registered', publicKey: keyPair.publicKey };
            
            stub.getState.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockDevice))); // GetDevice
            stub.getState.mockResolvedValueOnce(Buffer.from('USED')); // Nonce exists

            await expect(contract.VerifyAuthentication(ctx, deviceId, nonce, timestamp, signature))
                .rejects.toThrow(`Replay Attack Detected: The nonce ${nonce} has already been used.`);
        });

        // This test simulates a scenario where the device provides a valid signature, but the timestamp is outside the acceptable time window (more than 60 seconds old).
        // It checks that the authentication fails and that an appropriate error message is thrown indicating that the signature has expired.
        it('should expire signature if outside 60-second window', async () => {
            const deviceId = 'device1';
            const nonce = 'nonce-time';
            
            // Generate timestamp 2 minutes in the past
            const deviceDate = new Date();
            deviceDate.setMinutes(deviceDate.getMinutes() - 2);
            const timestamp = deviceDate.toISOString();
            
            const signature = 'some-signature';

            const mockDevice = { status: 'registered', publicKey: keyPair.publicKey };
            
            stub.getState.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockDevice))); // GetDevice
            stub.getState.mockResolvedValueOnce(Buffer.from('')); // Nonce doesn't exist

            await expect(contract.VerifyAuthentication(ctx, deviceId, nonce, timestamp, signature))
                .rejects.toThrow(/Signature Expired/);  // the error message should indicate that the signature has expired
        });
    });
});
