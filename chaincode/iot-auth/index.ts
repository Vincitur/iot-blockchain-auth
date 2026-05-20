import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as crypto from 'crypto';

// Define the Data Model for the World State Ledger
interface Device {
    docType: string;
    deviceId: string;
    deviceType: string;
    publicKey: string;
    status: string;
    registeredAt: string;
}

// This is the TypeScript implementation of the DeviceAuthContract, which is a Hyperledger Fabric smart contract responsible for managing device authentication in an IoT context.
// The contract includes functions for registering devices, retrieving device information, verifying authentication attempts, and revoking device access. 
// Each function interacts with the ledger to maintain a secure and auditable record of device identities and authentication events.
@Info({ title: 'DeviceAuthContract', description: 'Decentralized IoT Authentication Framework' })
export class DeviceAuthContract extends Contract {

    @Transaction()
    public async InitLedger(ctx: Context): Promise<void> {
        console.info('============= START : Initialize Ledger ===========');
        console.info('Ledger initialized successfully.');
        console.info('============= END : Initialize Ledger ===========');
    }

    @Transaction()
    public async RegisterDevice(ctx: Context, deviceId: string, deviceType: string, publicKey: string): Promise<void> {
        // 1. Check if the device already exists to prevent identity hijacking
        const exists = await this.DeviceExists(ctx, deviceId);
        if (exists) {
            throw new Error(`The device ${deviceId} is already registered on the network.`);
        }

        // 2. Construct the device state object
        const device: Device = {
            docType: 'device',
            deviceId,
            deviceType,
            publicKey,
            status: 'registered',
            registeredAt: ctx.stub.getTxID(),
        };

        // 3. Save to the ledger
        // Note: For deterministic sorting in production, standard stringify is often replaced with deterministic-stringify
        await ctx.stub.putState(deviceId, Buffer.from(JSON.stringify(device)));
        
        // 4. Emit an event for the Node.js Middleware to catch
        ctx.stub.setEvent('DeviceRegistered', Buffer.from(JSON.stringify({ deviceId, status: 'registered' })));
    }

    @Transaction(false)
    @Returns('string')
    public async GetDevice(ctx: Context, deviceId: string): Promise<string> {
        const deviceAsBytes = await ctx.stub.getState(deviceId);
        if (!deviceAsBytes || deviceAsBytes.length === 0) {
            throw new Error(`The device ${deviceId} does not exist.`);
        }
        return deviceAsBytes.toString();
    }

    @Transaction(false)
    @Returns('boolean')
    public async DeviceExists(ctx: Context, deviceId: string): Promise<boolean> {
        const deviceAsBytes = await ctx.stub.getState(deviceId);
        return deviceAsBytes && deviceAsBytes.length > 0;
    }

    // GetAllDevices returns all device records from the world state.
    // Uses the state iterator to scan the entire ledger and filters for docType === 'device'.
    @Transaction(false)
    @Returns('string')
    public async GetAllDevices(ctx: Context): Promise<string> {
        const allResults: Device[] = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value).toString('utf8');
            try {
                const record = JSON.parse(strValue);
                if (record.docType === 'device') {
                    allResults.push(record);
                }
            } catch (err) {
                // skip non-JSON or non-device entries
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(allResults);
    }

    @Transaction()
    @Returns('boolean')
    public async VerifyAuthentication(ctx: Context, deviceId: string, nonce: string, deviceTimestampStr: string, signatureBase64: string): Promise<boolean> {
        // 1. Fetch the identity
        const deviceString = await this.GetDevice(ctx, deviceId);
        const device: Device = JSON.parse(deviceString);

        // 2. Validate status — allow registered, active, or suspended devices to authenticate
        const allowedStates = ['registered', 'active', 'suspended'];
        if (!allowedStates.includes(device.status)) {
            throw new Error(`Authentication failed: Device ${deviceId} is marked as '${device.status}' and cannot be authenticated.`);
        }

        // 2.5 Replay Attack Protection (Nonce Cache & Deterministic Time Validation)
        const nonceKey = `NONCE_${nonce}`;
        const nonceExists = await ctx.stub.getState(nonceKey);
        if (nonceExists && nonceExists.length > 0) {
            throw new Error(`Replay Attack Detected: The nonce ${nonce} has already been used.`);
        }

        const timestampObj = ctx.stub.getTxTimestamp();
        let txSeconds = 0;
        if (timestampObj && timestampObj.seconds) {
            txSeconds = (typeof timestampObj.seconds === 'number') ? timestampObj.seconds : ((timestampObj.seconds as any).low || (timestampObj.seconds as any).toNumber());
        }
        const txDate = new Date(txSeconds * 1000);
        const deviceDate = new Date(deviceTimestampStr);
        const timeDiff = Math.abs(txDate.getTime() - deviceDate.getTime());
        
        // Reject if older than 60 seconds (60,000 ms)
        if (timeDiff > 60000) {
            throw new Error(`Signature Expired: The authentication payload is outside the valid 60-second time window. txDate: ${txDate}, deviceDate: ${deviceDate}`);
        }

        // 3. Cryptographic Verification
        // We enforce SHA256 hashing to verify the secp256r1 ECDSA signature
        const verify = crypto.createVerify('SHA256');
        verify.update(nonce + deviceTimestampStr);
        verify.end();

        // Pass the stored public key and the device's signature to evaluate the math
        const isValid = verify.verify(device.publicKey, signatureBase64, 'base64');

        if (!isValid) {
            throw new Error(`Authentication failed: Invalid cryptographic signature for device ${deviceId}.`);
        }

        // 4. Transition device status to 'active' upon successful verification
        const previousStatus = device.status;
        device.status = 'active';
        await ctx.stub.putState(deviceId, Buffer.from(JSON.stringify(device)));

        // 5. Audit Trail
        // Generate a log entry on the ledger proving a successful authentication occurred
        const auditLog = {
            docType: 'authLog',
            deviceId,
            previousStatus,
            newStatus: 'active',
            timestamp: ctx.stub.getTxID(),  // need this for the date to be deterministic across peers
            status: 'SUCCESS'
        };
        const logId = `LOG_${deviceId}_${ctx.stub.getTxID()}`;
        await ctx.stub.putState(logId, Buffer.from(JSON.stringify(auditLog)));

        ctx.stub.setEvent('DeviceAuthenticated', Buffer.from(JSON.stringify({ deviceId, previousStatus, newStatus: 'active' })));

        // 6. Mark Nonce as Used to prevent replay
        await ctx.stub.putState(nonceKey, Buffer.from('USED'));

        return true;
    }

    @Transaction()
    public async SuspendDevice(ctx: Context, deviceId: string): Promise<void> {
        const deviceString = await this.GetDevice(ctx, deviceId);
        const device: Device = JSON.parse(deviceString);

        if (device.status === 'revoked') {
            throw new Error(`Cannot suspend device ${deviceId}: device is already revoked.`);
        }

        device.status = 'suspended';
        await ctx.stub.putState(deviceId, Buffer.from(JSON.stringify(device)));
        ctx.stub.setEvent('DeviceSuspended', Buffer.from(JSON.stringify({ deviceId, status: 'suspended' })));
    }

    @Transaction()
    public async RevokeDevice(ctx: Context, deviceId: string): Promise<void> {
        const deviceString = await this.GetDevice(ctx, deviceId);
        const device: Device = JSON.parse(deviceString);

        if (device.status === 'revoked') {
            throw new Error(`Device ${deviceId} is already revoked.`);
        }

        device.status = 'revoked';
        await ctx.stub.putState(deviceId, Buffer.from(JSON.stringify(device)));
        ctx.stub.setEvent('DeviceRevoked', Buffer.from(JSON.stringify({ deviceId, status: 'revoked' })));
    }
}

export const contracts: any[] = [DeviceAuthContract];