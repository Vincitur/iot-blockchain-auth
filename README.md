# Master Architecture & Implementation Rules
**Project:** A Decentralized Authentication Framework for IoT Devices Using Lightweight Blockchain Architecture (MSc. Thesis)

## 1. System Overview
This project simulates and evaluates a secure, resource-efficient authentication mechanism for low-power IoT devices. It eliminates centralized authentication servers by leveraging a permissioned blockchain to handle device identity and cryptographic verification.

## 2. Tech Stack & Environment
* **Blockchain Network:** Hyperledger Fabric (Multi-Org deployment).
* **Smart Contracts (Chaincode):** Node.js (TypeScript/JavaScript).
* **Middleware Backend:** Decentralized Multi-Gateway Node.js APIs (Org1 Gateway & Org2 Gateway) interfacing with the Fabric SDK.
* **Frontend Dashboard:** Pure React (Vite) for real-time visualization across both gateways and administrative controls. Includes in-browser (WebCrypto) IoT simulation.
* **IoT Emulation (Hardware Accuracy):** Docker containers running `qemu-rpi-os-lite:buster-latest` executing Python scripts (`device_arm.py`) to provide an authentic, resource-constrained ARM execution environment. Features robust exponential backoff for transient network resilience.
* **IoT Emulation (Network Scalability):** Standalone Node.js scripts (`device.js`) running in a Docker Fleet (x86) to stress-test the Hyperledger Fabric throughput via concurrent CoAP/HTTP requests to both gateways.

## 3. Middleware API Specifications (Node.js)
The backend acts as a lightweight bridge and decentralized gateway, ensuring IoT devices do not need to run the heavy Fabric SDK. Both Org1 and Org2 run independent gateways syncing to the shared ledger.

* **POST `/api/v1/devices/register`**
  * **Purpose:** Initial device onboarding.
  * **Payload:** `{ deviceId, deviceType, publicKey, psk }` encrypted via ECDH + AES-256-CBC.
  * **Security:** Requires a Pre-Shared Key (PSK) to mitigate Sybil attacks.
  * **Action:** Submits a transaction to the chaincode to store the device identity.
* **POST `/api/v1/auth/challenge`**
  * **Purpose:** Initiates the authentication handshake.
  * **Payload:** `{ deviceId }` encrypted.
  * **Action:** Generates and returns a random cryptographic `nonce`.
* **POST `/api/v1/auth/verify`**
  * **Purpose:** Completes authentication.
  * **Payload:** `{ deviceId, timestamp, signature }` encrypted.
  * **Action:** Passes the signature, timestamp, and nonce to the chaincode for ledger-backed verification. Returns an access token upon success.
* **GET `/api/v1/network/*`**
  * **Purpose:** Read-only endpoints for the React dashboard to fetch metrics (block height, transaction counts).
* **POST `/api/v1/metrics/latency`**
  * **Purpose:** Collects empirical timing data from external simulators.
  * **Payload:** `{ deviceId, latencyMs, keyGenMs, registrationMs, signingMs, source }`
  * **Action:** Aggregates granular phase timings in memory for the Frontend's Cross-Platform Comparison table.

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
  * **Action:** Validates uniqueness, constructs the state object with `status: "registered"`, and saves to the ledger (`putState`). Emits a `DeviceRegistered` event.
* `GetDevice(ctx, deviceId)`
  * **Action:** Retrieves and returns the device state from the ledger (`getState`).
* `VerifyAuthentication(ctx, deviceId, nonce, deviceTimestampStr, signature)`
  * **Action:** 1. Fetches identity via `GetDevice`.
    2. Validates `status` is one of `registered, active, suspended`.
    3. Checks `nonce` to prevent exact replay attacks.
    4. Enforces a strict 60-second valid time window comparing `deviceTimestampStr` and the transaction timestamp to prevent delayed replay attacks.
    5. Verifies the `signature` against the payload and stored `publicKey`.
    6. Logs the audit trail and returns success or failure.
* `SuspendDevice(ctx, deviceId)` / `RevokeDevice(ctx, deviceId)`
  * **Action:** Changes device status to `"suspended"` or `"revoked"` to block compromised hardware. These endpoints are strictly protected by an Admin API Key at the Gateway level to prevent privilege escalation.

### C. Cryptographic Standards
* **Algorithm:** ECDSA (Elliptic Curve Digital Signature Algorithm).
* **Curve:** `secp256r1` (prime256v1).
* **Rationale:** This is the native default for Hyperledger Fabric. It is highly optimized for the limited CPU and memory constraints of the ARM (`qemu-rpi-os-lite`) containers, generating signatures much faster and with a significantly smaller footprint than RSA.

## 5. IoT Device Simulation Strategy (Hybrid Approach)

This section outlines the planned strategy and architecture for simulating IoT devices in this Decentralized Authentication Framework thesis.

### Core Objective
Validate the authentication framework using realistic network conditions (stress-testing) and hardware-accurate cryptographic latency (ARM emulation). To satisfy both **Scalability** and **Hardware Accuracy** requirements for my thesis, the simulation is split into two distinct execution strategies:

### 1. Hardware Accuracy (QEMU ARM Emulation)
**Goal:** Prove that the required cryptographic operations (ECDSA secp256r1 nonce signing) run efficiently on constrained IoT hardware.
- **Image:** `critoma/qemu-rpi-os-lite:buster-latest`
- **Architecture:** ARM (Emulated via QEMU)
- **Execution Load:** 1 to 5 concurrent containers.
- **Implementation Steps:**
  1. Boot the QEMU container (`docker run -it -p 5022:5022 --name MyQemuRPi3_01 critoma/qemu-rpi-os-lite:buster-latest`).
  2. SSH into the container (`ssh -p 5022 pi@127.0.0.1`).
  3. Execute the device logic locally on the emulated ARM CPU using **Python 3 and OpenSSL** (`device_arm.py`). Python is used instead of Node.js to bypass "Illegal instruction" errors common with Node.js binaries on legacy ARMv7 environments.
  4. Capture granular phase metrics (Key Generation, Registration, ECDSA Signing, and End-to-End Auth) to highlight the computational limits of IoT hardware.

### 2. Network Scalability (Lightweight Swarm)
**Goal:** Prove the Hyperledger Fabric blockchain backend can handle mass concurrent authentications (throughput and stability).
- **Image:** `node:18-alpine` (or `python:3.10-alpine`)
- **Architecture:** x86 (Native host execution)
- **Execution Load:** 50, 100, or 200 concurrent containers.
- **Implementation Steps:**
  1. Containerize the existing simulator payload (`device.js`).
  2. Use environment variables to inject dynamic IDs (`DEVICE_ID`) and targeting (`API_URL`).
  3. Create a `docker-compose.yml` to orchestrate massive swarms.
  4. Monitor backend `/api/v1/network/blockHeight` and latency metrics while the swarm registers and authenticates simultaneously.
