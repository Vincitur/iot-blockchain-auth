# Decentralized IoT Authentication Framework: UML Diagrams

## A. System Architecture Component Diagram
This UML deployment diagram illustrates the true decentralized nature of the framework. IoT devices are not bound to a single centralized server; instead, they can authenticate via multiple independent organization gateways (Org1 or Org2) that sync state via the Hyperledger Fabric blockchain.

```mermaid
graph TD
    subgraph IoT Devices
        D1[Browser Emulator\nWebCrypto API]
        D2[Docker Fleet\nx86 Node.js / CoAP]
        D3[QEMU ARM Emulator\nPython / OpenSSL]
    end

    subgraph Decentralized Gateways
        G1[Org1 Gateway\nHTTP:3000 / CoAP:5683]
        G2[Org2 Gateway\nHTTP:3001 / CoAP:5684]
    end

    subgraph Hyperledger Fabric Network
        P1[(Peer0.Org1\nCouchDB)]
        P2[(Peer0.Org2\nCouchDB)]
        O[(Orderer Node)]
        CC{{DeviceAuthContract\nSmart Contract}}
    end

    %% Device to Gateway Connections (Encrypted via ECDH+AES)
    D1 -->|HTTP POST| G1
    D2 -.->|CoAP/UDP| G1
    D2 -.->|CoAP/UDP| G2
    D3 -->|HTTP POST| G2

    %% Gateway to Fabric SDK Connections
    G1 ==>|gRPC| P1
    G2 ==>|gRPC| P2

    %% Fabric Internal Consensus
    P1 <-->|Gossip Protocol| P2
    P1 <-->|Transaction Ordering| O
    P2 <-->|Transaction Ordering| O
    P1 -.-> CC
    P2 -.-> CC
```

## B. Threat Model & Trust Boundaries Flowchart
```mermaid
flowchart TD
    %% Zones
    subgraph Hostile["Hostile Environment (Untrusted)"]
        D[IoT Edge Device]
    end

    subgraph DMZ["Gateway / API Layer (Semi-Trusted)"]
        G[Decentralized Gateway Node.js]
    end

    subgraph Secure["Blockchain Ledger (Highly Trusted)"]
        HF[Hyperledger Fabric Peer]
        CC{DeviceAuthContract}
    end

    %% Flow and Protections
    D -- "1. Registration Request\n[Sybil Attack Vector]" --> G
    G -- "Enforces Pre-Shared Key (PSK)" --> HF
    
    D -- "2. Auth Request\n[Eavesdropping Vector]\n(Encrypted via ECDH + AES-256-CBC)" --> G
    
    D -- "3. Verify Request\n[Replay Attack Vector]" --> G
    G -- "Forwards Signature" --> CC
    CC -- "Enforces 60s Timestamp + Nonce" --> CC
    
    Admin[Admin Panel] -- "4. Suspend/Revoke\n[Privilege Escalation Vector]\n(Enforces Admin API Key)" --> G 
    
    style Hostile fill:#ffcccc,stroke:#ff0000,stroke-width:2px,stroke-dasharray: 5 5
    style DMZ fill:#ffffcc,stroke:#cccc00,stroke-width:2px,stroke-dasharray: 5 5
    style Secure fill:#ccffcc,stroke:#009900,stroke-width:2px
```

## C. Authentication Sequence Diagram (with Application-Layer Security)
This sequence diagram demonstrates the end-to-end security model, including Sybil attack mitigation (PSK), eavesdropping prevention (ECDH+AES), and replay attack mitigation (Nonces + 60s Timestamps).

```mermaid
sequenceDiagram
    participant D as IoT Device
    participant G as Org Gateway (Node.js)
    participant HF as Hyperledger Fabric (Chaincode)

    Note over D,G: Phase 1: Secure Registration (Sybil Mitigation)
    D->>D: Generate ECDSA P-256 Keypair
    D->>G: GET /gateway/key (Fetch Gateway PubKey)
    G-->>D: Gateway Public Key PEM
    D->>D: ECDH Derivation -> AES-256-CBC Key
    D->>G: POST /devices/register <br/>[Encrypted: deviceId, publicKey, PSK]
    G->>G: Decrypt & Verify PSK
    G->>HF: RegisterDevice(deviceId, publicKey)
    HF-->>G: Success (Status: 'registered')
    G-->>D: [Encrypted: Registration Success]

    Note over D,G: Phase 2: Challenge Request
    D->>D: ECDH Derivation -> AES Key
    D->>G: POST /auth/challenge <br/>[Encrypted: deviceId]
    G->>G: Generate Random Nonce
    G->>G: Store {deviceId: nonce}
    G-->>D: [Encrypted: Nonce]

    Note over D,G: Phase 3: Cryptographic Verification (Replay Mitigation)
    D->>D: Create Timestamp (UTC)
    D->>D: ECDSA Sign(Nonce + Timestamp)
    D->>G: POST /auth/verify <br/>[Encrypted: deviceId, Timestamp, Signature]
    G->>G: Decrypt Payload
    G->>HF: VerifyAuthentication(deviceId, Nonce, Timestamp, Signature)
    
    HF->>HF: Verify Timestamp (Within 60s window)
    HF->>HF: Verify Nonce hasn't been used
    HF->>HF: Cryptographic verification of Signature
    HF->>HF: Transition State -> 'active'
    HF-->>G: True
    G-->>D: [Encrypted: Auth Token]
```

## D. DeviceAuthContract chaincode Class Diagram
This UML Class Diagram outlines the properties of a `DeviceIdentity` asset on the ledger and the methods exposed by the `DeviceAuthContract` chaincode.

```mermaid
classDiagram
    class Device {
        +String docType
        +String deviceId
        +String deviceType
        +String publicKey
        +String status
        +String registeredAt
    }

    class AuthLog {
        +String docType
        +String deviceId
        +String previousStatus
        +String newStatus
        +String timestamp
        +String status
    }

    class DeviceAuthContract {
        +InitLedger(ctx: Context) void
        +RegisterDevice(ctx: Context, deviceId: String, deviceType: String, publicKey: String) void
        +GetDevice(ctx: Context, deviceId: String) String
        +DeviceExists(ctx: Context, deviceId: String) Boolean
        +GetAllDevices(ctx: Context) String
        +VerifyAuthentication(ctx: Context, deviceId: String, nonce: String, signatureBase64: String) Boolean
        +SuspendDevice(ctx: Context, deviceId: String) void
        +RevokeDevice(ctx: Context, deviceId: String) void
    }

    DeviceAuthContract ..> Device : Manages State
    DeviceAuthContract ..> AuthLog : Creates Audit Trail
```

## E.  DeviceAuthContract chaincode Lifecycle State Machine 
```mermaid
stateDiagram-v2
    [*] --> registered : RegisterDevice()\n[Requires Gateway PSK]
    
    registered --> active : VerifyAuthentication()\n[Requires Valid ECDSA Sig]
       
    active --> suspended : SuspendDevice()\n[Requires Admin API Key]
    
    suspended --> active : VerifyAuthentication()\n[Re-auth successful]
    
    registered --> revoked : RevokeDevice()\n[Requires Admin API Key]
    active --> revoked : RevokeDevice()\n[Requires Admin API Key]
    suspended --> revoked : RevokeDevice()\n[Requires Admin API Key]
    
    revoked --> [*] : Permanent Lockout
```

## F. Future Work Component Diagram
```mermaid
flowchart TD
    subgraph Edge Environment
        IoT1[IoT Device 1<br/>with Hardware TPM]
        IoT2[IoT Device 2<br/>with Secure Element]
    end

    subgraph Gateway Layer
        DTLS[DTLS Proxy / Load Balancer<br/>e.g. Eclipse Californium]
        Node1[Node.js Gateway Instance 1]
        Node2[Node.js Gateway Instance 2]
    end

    subgraph Blockchain Layer
        Peer1[Fabric Peer 1<br/>Org1MSP]
        Peer2[Fabric Peer 2<br/>Org2MSP]
        Orderer[Raft Orderer Cluster]
    end

    IoT1 -- CoAPS (UDP) --> DTLS
    IoT2 -- CoAPS (UDP) --> DTLS
    DTLS -- Plain CoAP --> Node1
    DTLS -- Plain CoAP --> Node2
    Node1 -- gRPC (TLS) --> Peer1
    Node2 -- gRPC (TLS) --> Peer2
    Peer1 <--> Orderer
    Peer2 <--> Orderer
```