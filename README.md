# Master Architecture & Implementation Rules
**Project:** A Decentralized Authentication Framework for IoT Devices Using Lightweight Blockchain Architecture (MSc. Thesis)

## 1. System Overview
This project simulates and evaluates a secure, resource-efficient authentication mechanism for low-power IoT devices. It eliminates centralized authentication servers by leveraging a permissioned blockchain to handle device identity and cryptographic verification.

## 2. Tech Stack & Environment
* **Blockchain Network:** Hyperledger Fabric.
* **Smart Contracts (Chaincode):** Node.js (TypeScript/JavaScript).
* **Middleware Backend:** Node.js API server to interface with the Fabric SDK.
* **Frontend Dashboard:** Pure React (Vite) for real-time visualization and administrative controls.
* **IoT Emulation:** Docker containers running `qemu-rpi-os-lite:buster-latest` to provide an authentic ARM execution environment.

## 3. Middleware API Specifications (Node.js)
The backend acts as a lightweight bridge, ensuring IoT devices do not need to run the heavy Fabric SDK.

* **POST `/api/v1/devices/register`**
  * **Purpose:** Initial device onboarding.
  * **Payload:** `{ deviceId, deviceType, publicKey }`
  * **Action:** Submits a transaction to the chaincode to store the device identity.
* **POST `/api/v1/auth/challenge`**
  * **Purpose:** Initiates the authentication handshake.
  * **Payload:** `{ deviceId }`
  * **Action:** Generates and returns a random cryptographic `nonce`.
* **POST `/api/v1/auth/verify`**
  * **Purpose:** Completes authentication.
  * **Payload:** `{ deviceId, signature }`
  * **Action:** Passes the signature and nonce to the chaincode for ledger-backed verification. Returns an access token upon success.
* **GET `/api/v1/network/*`**
  * **Purpose:** Read-only endpoints for the React dashboard to fetch metrics (latency, CPU load, transaction logs, success rates).

## 4. Chaincode (Smart Contract) Logic
The chaincode acts as the immutable ledger for device identities and the execution environment for cryptographic verification.

### A. Ledger State (Data Model)
IoT devices are represented in the Fabric World State as JSON objects:

```json
{
  "docType": "device",
  "deviceId": "rpi-sensor-001",
  "deviceType": "temperature_sensor",
  "publicKey": "-----BEGIN PUBLIC KEY...-----",
  "status": "active", 
  "registeredAt": "2026-03-15T21:33:58Z"
}
```

### B. Core Functions (`DeviceAuthContract`)
* `RegisterDevice(ctx, deviceId, deviceType, publicKey)`
  * **Action:** Validates uniqueness, constructs the state object with `status: "active"`, and saves to the ledger (`putState`). Emits a `DeviceRegistered` event.
* `GetDevice(ctx, deviceId)`
  * **Action:** Retrieves and returns the device state from the ledger (`getState`).
* `VerifyAuthentication(ctx, deviceId, nonce, signature)`
  * **Action:** 1. Fetches identity via `GetDevice`.
    2. Validates `status === "active"`.
    3. Verifies the `signature` against the original `nonce` and stored `publicKey`.
    4. Logs the audit trail and returns success or failure.
* `RevokeDevice(ctx, deviceId)`
  * **Action:** Changes device status to `"revoked"` to instantly block compromised hardware.

### C. Cryptographic Standards
* **Algorithm:** ECDSA (Elliptic Curve Digital Signature Algorithm).
* **Curve:** `secp256r1` (prime256v1).
* **Rationale:** This is the native default for Hyperledger Fabric. It is highly optimized for the limited CPU and memory constraints of the ARM (`qemu-rpi-os-lite`) containers, generating signatures much faster and with a significantly smaller footprint than RSA.
