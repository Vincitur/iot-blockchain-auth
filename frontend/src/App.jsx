// Marius-Remus Dumitrel - App.jsx - React Frontend for IoT Authentication Application
// Disclaimer: For the Helpers and UI part of this fontend source code, the assistence of AI tools (Claude and GitHub Copilot) was used to rapidly prototype and iterate on the React components, state management, and API integration.

// This React application serves as the frontend for the IoT Authentication Gateway, allowing users to simulate IoT devices, view their authentication status, and monitor latency metrics. 
// It interacts with the backend Express server via RESTful APIs to perform device registration, fetch gateway information, and retrieve metrics. 
// The UI includes a dashboard with device cards, real-time logs, and charts visualizing authentication latencies and session events. 
// The application also implements secure communication with the backend using ECDH key exchange and AES encryption for sensitive operations like device registration.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Activity, ShieldCheck, ShieldOff, ShieldAlert, Thermometer, Laptop, RefreshCw, KeyRound, Pause, BarChart3, Clock, Zap, Shield, Boxes, Trash2 } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import './index.css';

// Gateway configuration — each organization runs its own stateless gateway
// connected to its respective Fabric peer. The frontend can target either.
const GATEWAYS = {
  org1: { label: 'Org1 Gateway', msp: 'Org1MSP', url: 'http://localhost:3000/api/v1', color: '#3B82F6', peer: 'peer0.org1:7051' },
  org2: { label: 'Org2 Gateway', msp: 'Org2MSP', url: 'http://localhost:3001/api/v1', color: '#8B5CF6', peer: 'peer0.org2:9051' },
};

// Pre-Shared Key for device registration authorization (simulates manufacturer provisioning)
const REGISTRATION_PSK = 'iot-device-psk-2024';

// Admin API key for protected operations (suspend, revoke)
const ADMIN_API_KEY = 'iot-admin-key-2024';

function App() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);

  // Gateway selector — determines which organization's backend handles API calls
  const [activeGateway, setActiveGateway] = useState('org1');
  const API_URL = GATEWAYS[activeGateway].url;
  const [authenticatingId, setAuthenticatingId] = useState(null);

  // In-memory store for device private keys (keyed by deviceId).
  // Keys are also persisted to localStorage as JWK so they survive page refreshes.
  // In a real scenario, keys would reside in a hardware secure element on each device.
  const [deviceKeys, setDeviceKeys] = useState({});

  const [logs, setLogs] = useState([
    { id: '1', time: new Date().toLocaleTimeString(), message: 'System Initialized', type: 'info' }
  ]);

  // Metrics state
  const [authLatencies, setAuthLatencies] = useState([]);
  const [sessionEvents, setSessionEvents] = useState({ registrations: 0, authentications: 0, suspensions: 0, revocations: 0 });
  const [blockHeight, setBlockHeight] = useState(null);

  // Simulator latency metrics polled from the backend (reported by Docker containers)
  const [simLatencyMetrics, setSimLatencyMetrics] = useState({ count: 0, avgMs: null, minMs: null, maxMs: null, latencies: [] });

  // Overall latencies persisted across sessions via localStorage
  const [overallLatencies, setOverallLatencies] = useState(() => {
    try {
      const stored = localStorage.getItem('overallAuthLatencies');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  // Ref to prevent duplicate 'Restored keys' log on React StrictMode double-mount
  const keysRestoredRef = useRef(false);
  const actionGuardsRef = useRef(new Set());

  // Network config state
  const [ordererConfig, setOrdererConfig] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [tempMaxMsg, setTempMaxMsg] = useState('');

  const addLog = (message, type = 'info') => {
    setLogs(prev => [{ id: Date.now().toString(), time: new Date().toLocaleTimeString(), message, type }, ...prev]);
  };

  // Fetch all registered devices from the Fabric ledger on component mount.
  // This provides persistent state: refreshing the page reloads devices from the blockchain.
  // Also restores private keys from localStorage so suspended/registered devices can still authenticate.
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await axios.get(`${API_URL}/network/devices`);
        const ledgerDevices = res.data.map(d => ({
          id: d.deviceId,
          type: d.deviceType,
          status: d.status,
          lastAuth: '—'
        }));
        setDevices(ledgerDevices);

        if (ledgerDevices.length === 0) {
          // If the ledger has 0 devices, it's likely a newly deployed test network.
          // Reset the overall latencies and clean up any orphaned private keys.
          localStorage.removeItem('overallAuthLatencies');
          setOverallLatencies([]);
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('deviceKey_')) {
              keysToRemove.push(k);
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        }

        if (ledgerDevices.length > 0) {
          addLog(`Loaded ${ledgerDevices.length} device(s) from Fabric ledger`, 'info');
        }

        // Restore private keys from localStorage for all known devices
        const restoredKeys = {};
        for (const d of ledgerDevices) {
          const jwkStr = localStorage.getItem(`deviceKey_${d.id}`);
          if (jwkStr) {
            try {
              const jwk = JSON.parse(jwkStr);
              const privateKey = await window.crypto.subtle.importKey(
                'jwk', jwk,
                { name: 'ECDSA', namedCurve: 'P-256' },
                true, ['sign']
              );
              restoredKeys[d.id] = privateKey;
            } catch (err) {
              console.warn(`Failed to restore key for ${d.id}:`, err);
            }
          }
        }
        if (Object.keys(restoredKeys).length > 0) {
          setDeviceKeys(prev => ({ ...prev, ...restoredKeys }));
          if (!keysRestoredRef.current) {
            keysRestoredRef.current = true;
            addLog(`Restored ${Object.keys(restoredKeys).length} private key(s) from local storage`, 'info');
          }
        }
      } catch (error) {
        console.error('Failed to fetch devices from ledger:', error);
        addLog('Warning: Could not connect to backend. Is the Fabric network running?', 'error');
      }
    };
    fetchDevices();

    // Poll devices from both gateways every 5 seconds for live Total Devices count
    const pollDevices = async () => {
      try {
        const [res1, res2] = await Promise.all([
          axios.get(`${GATEWAYS.org1.url}/network/devices`).catch(() => ({ data: [] })),
          axios.get(`${GATEWAYS.org2.url}/network/devices`).catch(() => ({ data: [] }))
        ]);
        // Merge devices from both orgs, deduplicating by deviceId
        const deviceMap = new Map();
        [...res1.data, ...res2.data].forEach(d => {
          if (!deviceMap.has(d.deviceId)) {
            deviceMap.set(d.deviceId, {
              id: d.deviceId,
              type: d.deviceType,
              status: d.status,
              lastAuth: '—'
            });
          }
        });
        setDevices(prev => {
          const updated = Array.from(deviceMap.values());
          // Preserve lastAuth from previous state
          return updated.map(d => {
            const existing = prev.find(p => p.id === d.id);
            return existing ? { ...d, lastAuth: existing.lastAuth } : d;
          });
        });
      } catch (err) {
        // Silently ignore polling errors
      }
    };
    const deviceInterval = setInterval(pollDevices, 5000);
    return () => clearInterval(deviceInterval);
  }, []);

  // Poll block height every 10 seconds
  useEffect(() => {
    const fetchBlockHeight = async () => {
      try {
        const res = await axios.get(`${API_URL}/network/blockHeight`);
        setBlockHeight(res.data.height);
      } catch (err) {
        console.warn('Could not fetch block height:', err);
      }
    };
    fetchBlockHeight();
    const interval = setInterval(fetchBlockHeight, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll simulator latency metrics from all gateways every 5 seconds
  useEffect(() => {
    const fetchSimLatency = async () => {
      try {
        const [res1, res2] = await Promise.all([
          axios.get(`${GATEWAYS.org1.url}/metrics/latency`).catch(() => ({ data: { latencies: [] } })),
          axios.get(`${GATEWAYS.org2.url}/metrics/latency`).catch(() => ({ data: { latencies: [] } }))
        ]);
        
        // Tag each entry with its org so the chart can distinguish them
        const org1Latencies = (res1.data.latencies || []).map(e => ({ ...e, org: 'org1' }));
        const org2Latencies = (res2.data.latencies || []).map(e => ({ ...e, org: 'org2' }));
        const combinedLatencies = [...org1Latencies, ...org2Latencies];
        combinedLatencies.sort((a, b) => a.timestamp - b.timestamp);

        setSimLatencyMetrics({ latencies: combinedLatencies });

        // Update lastAuth on device cards for simulator-authenticated devices
        if (combinedLatencies.length > 0) {
          const latestByDevice = {};
          combinedLatencies.forEach(entry => {
            if (!latestByDevice[entry.deviceId] || entry.timestamp > latestByDevice[entry.deviceId].timestamp) {
              latestByDevice[entry.deviceId] = entry;
            }
          });
          setDevices(prev => prev.map(d => {
            const match = latestByDevice[d.id];
            if (match) {
              return { ...d, lastAuth: new Date(match.timestamp).toLocaleTimeString() };
            }
            return d;
          }));
        }
      } catch (err) {
        // Silently ignore — endpoint may not exist on older backend versions
      }

      try {
        const confRes = await axios.get(`${API_URL}/network/ordererConfig`);
        setOrdererConfig(confRes.data);
        if (confRes.data && confRes.data.maxMessageCount) {
          // Only set it initially if it's empty to avoid overwriting user typing
          setTempMaxMsg(prev => prev || confRes.data.maxMessageCount.toString());
        }
      } catch (err) {
        // Silently ignore
      }
    };
    fetchSimLatency();
    const interval = setInterval(fetchSimLatency, 5000);
    return () => clearInterval(interval);
  }, []);

  // some mock sensor types for simulation
  const sensorTypes = [
    { type: 'temperature_sensor', label: 'Temperature Sensor', prefix: 'temp' },
    { type: 'humidity_sensor', label: 'Humidity Sensor', prefix: 'hum' },
    { type: 'motion_detector', label: 'Motion Detector', prefix: 'motion' },
    { type: 'pressure_sensor', label: 'Pressure Sensor', prefix: 'pres' },
    { type: 'gas_sensor', label: 'Gas Sensor', prefix: 'gas' },
    { type: 'light_sensor', label: 'Light Sensor', prefix: 'light' },
    { type: 'vibration_sensor', label: 'Vibration Sensor', prefix: 'vib' },
  ];

  const updateOrdererConfig = async (batchTimeout) => {
    setIsConfiguring(true);
    addLog(`Applying Channel Config Update: BatchTimeout=${batchTimeout}...`, 'info');
    try {
      const payload = { batchTimeout };
      if (tempMaxMsg) payload.maxMessageCount = parseInt(tempMaxMsg, 10);
      const res = await axios.post(`${API_URL}/network/ordererConfig`, payload, { headers: { 'x-api-key': ADMIN_API_KEY } });
      setOrdererConfig(res.data);
      if (res.data && res.data.maxMessageCount) setTempMaxMsg(res.data.maxMessageCount.toString());
      addLog(`Channel config updated to: ${res.data.batchTimeout}`, 'success');
    } catch (error) {
      console.error(error);
      addLog(`Failed to update config: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
      setIsConfiguring(false);
    }
  };

  // Helper: convert ArrayBuffer to base64 string
  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Helper: convert SPKI ArrayBuffer to PEM string (the format the chaincode expects)
  const spkiToPem = (spkiBuffer) => {
    const base64 = arrayBufferToBase64(spkiBuffer);
    const lines = base64.match(/.{1,64}/g).join('\n');
    return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  };

  // Helper: convert WebCrypto IEEE P1363 signature (r||s, 64 bytes) to ASN.1 DER format
  // Node's crypto.createVerify expects DER-encoded signatures, but WebCrypto outputs raw r||s.
  const ieeeP1363ToDer = (p1363Sig) => {
    const r = new Uint8Array(p1363Sig.slice(0, 32));
    const s = new Uint8Array(p1363Sig.slice(32, 64));

    const encodeInteger = (intBytes) => {
      // Remove leading zeros but keep one if needed
      let start = 0;
      while (start < intBytes.length - 1 && intBytes[start] === 0) start++;
      let trimmed = intBytes.slice(start);
      // If high bit is set, prepend 0x00 to keep positive
      const needsPad = trimmed[0] & 0x80;
      const result = new Uint8Array(trimmed.length + (needsPad ? 1 : 0));
      if (needsPad) result[0] = 0;
      result.set(trimmed, needsPad ? 1 : 0);
      return result;
    };

    const rDer = encodeInteger(r);
    const sDer = encodeInteger(s);
    // SEQUENCE { INTEGER r, INTEGER s }
    const totalLen = 2 + rDer.length + 2 + sDer.length;
    const der = new Uint8Array(2 + totalLen);
    let offset = 0;
    der[offset++] = 0x30; // SEQUENCE tag
    der[offset++] = totalLen;
    der[offset++] = 0x02; // INTEGER tag
    der[offset++] = rDer.length;
    der.set(rDer, offset); offset += rDer.length;
    der[offset++] = 0x02; // INTEGER tag
    der[offset++] = sDer.length;
    der.set(sDer, offset);
    return der;
  };

  // Helper: Hex string to ArrayBuffer
  const hexToArrayBuffer = (hex) => {
    const view = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      view[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return view.buffer;
  };

  // Helper: ArrayBuffer to Hex string
  const arrayBufferToHex = (buffer) => {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  };

  // Helper: Secure Post using ECDH + AES-256-CBC
  const securePost = async (endpoint, payload, gatewayPubPEM) => {
    const encStart = performance.now();
    // 1. Generate Ephemeral ECDH keypair (P-256)
    const ephemeralPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );

    // Export ephemeral public key to SPKI PEM
    const ephSpki = await window.crypto.subtle.exportKey('spki', ephemeralPair.publicKey);
    const ephemeralPublicKey = spkiToPem(ephSpki);

    // 2. Import Gateway Public Key
    const gwB64 = gatewayPubPEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const gwBuffer = Uint8Array.from(atob(gwB64), c => c.charCodeAt(0)).buffer;
    const gwKey = await window.crypto.subtle.importKey(
      'spki',
      gwBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    // 3. Derive Shared Secret
    const sharedSecret = await window.crypto.subtle.deriveBits(
      { name: 'ECDH', public: gwKey },
      ephemeralPair.privateKey,
      256
    );

    // 4. Hash Secret to get AES key
    const aesKeyRaw = await window.crypto.subtle.digest('SHA-256', sharedSecret);
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      aesKeyRaw,
      { name: 'AES-CBC' },
      false,
      ['encrypt', 'decrypt']
    );

    // 5. Encrypt Payload
    const iv = window.crypto.getRandomValues(new Uint8Array(16));
    const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertextBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      aesKey,
      encodedPayload
    );
    const ciphertext = arrayBufferToHex(ciphertextBuf);
    const ivHex = arrayBufferToHex(iv.buffer);
    const encEnd = performance.now();
    const encryptionMs = Math.round(encEnd - encStart);

    // 6. Send Request
    const res = await axios.post(`${API_URL}/${endpoint}`, {
      ephemeralPublicKey,
      iv: ivHex,
      ciphertext
    });

    // 7. Decrypt Response
    if (res.data && res.data.ciphertext) {
      const respIv = hexToArrayBuffer(res.data.iv);
      const respCiphertext = hexToArrayBuffer(res.data.ciphertext);
      const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: respIv },
        aesKey,
        respCiphertext
      );
      res.data = JSON.parse(new TextDecoder().decode(decryptedBuf));
    }
    res.encryptionMs = encryptionMs;
    return res;
  };

  // PHASE 1: Simulate Device Registration only.
  // Uses the browser-native Web Crypto API (SubtleCrypto) for ECDSA P-256 key generation.
  // The device starts in the 'registered' state and is NOT yet authenticated.
  const simulateDevice = async () => {
    setLoading(true);
    const sensor = sensorTypes[Math.floor(Math.random() * sensorTypes.length)];
    const deviceId = `${sensor.prefix}-${Math.floor(1000 + Math.random() * 9000)}`;

    addLog(`Simulating ${sensor.label} → ${deviceId} via ${GATEWAYS[activeGateway].label}`, 'info');

    try {
      // 1. Generate ECDSA P-256 key pair using the browser's native Web Crypto API
      const keyGenStart = performance.now();
      const keyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true, // extractable so we can export the public key
        ['sign', 'verify']
      );

      // 2. Export public key as SPKI → PEM (the format Node's crypto.createVerify expects)
      const spkiBuffer = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
      const publicKeyPEM = spkiToPem(spkiBuffer);
      const keyGenEnd = performance.now();
      const keyGenMs = Math.round(keyGenEnd - keyGenStart);

      // 3. Fetch Gateway Public Key
      const gwRes = await axios.get(`${API_URL}/gateway/key`);
      const gatewayPubPEM = gwRes.data.publicKey;

      // 4. Register device on the blockchain via backend API securely
      const regStart = performance.now();
      const regResult = await securePost('devices/register', {
        deviceId,
        deviceType: sensor.type,
        publicKey: publicKeyPEM,
        psk: REGISTRATION_PSK
      }, gatewayPubPEM);
      const regEnd = performance.now();
      const registrationMs = Math.round(regEnd - regStart);

      addLog(`Device ${deviceId} registered on ledger (status: REGISTERED) — keyGen: ${keyGenMs}ms, reg: ${registrationMs}ms`, 'success');
      setSessionEvents(prev => ({ ...prev, registrations: prev.registrations + 1 }));

      // Report registration-phase timings to backend
      try {
        await axios.post(`${API_URL}/metrics/latency`, { deviceId, latencyMs: registrationMs, keyGenMs, registrationMs, encryptionMs: regResult.encryptionMs, source: 'browser' });
      } catch (_) { /* best-effort */ }

      // 5. Store the private key in-memory and persist to localStorage as JWK
      //    so the key survives page refreshes (simulates the key living on the physical device)
      setDeviceKeys(prev => ({ ...prev, [deviceId]: keyPair.privateKey }));
      const jwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
      localStorage.setItem(`deviceKey_${deviceId}`, JSON.stringify(jwk));

      // 6. Add the device to the dashboard with 'registered' status
      setDevices(prev => [...prev, { id: deviceId, type: sensor.label, status: 'registered', lastAuth: '—' }]);

    } catch (error) {
      console.error(error);
      addLog(`Error: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // PHASE 2: Authenticate a previously registered (or suspended) device.
  // Performs the challenge-response handshake to cryptographically verify the device identity
  // and transitions the device to 'active' status on the blockchain.
  const authenticateDevice = async (deviceId) => {
    if (actionGuardsRef.current.has(deviceId)) return;
    actionGuardsRef.current.add(deviceId);
    setAuthenticatingId(deviceId);
    addLog(`Starting authentication for ${deviceId} via ${GATEWAYS[activeGateway].label}...`, 'info');

    const privateKey = deviceKeys[deviceId];
    if (!privateKey) {
      addLog(`Error: No private key found for ${deviceId}. Cannot authenticate.`, 'error');
      actionGuardsRef.current.delete(deviceId);
      setAuthenticatingId(null);
      return;
    }

    let totalEncryptionMs = 0;
    const authStart = performance.now();
    try {
      // 1. Fetch Gateway Public Key
      const gwRes = await axios.get(`${API_URL}/gateway/key`);
      const gatewayPubPEM = gwRes.data.publicKey;

      // 2. Request authentication challenge (nonce) from the backend securely
      addLog(`Challenge requested for ${deviceId}`, 'info');
      const challengeRes = await securePost('auth/challenge', { deviceId }, gatewayPubPEM);
      totalEncryptionMs += challengeRes.encryptionMs;
      const nonce = challengeRes.data.nonce;

      // 3. Sign the nonce + timestamp with ECDSA SHA-256 using Web Crypto
      addLog(`${deviceId} signing challenge nonce (ECDSA secp256r1)`, 'info');
      const sigStart = performance.now();
      const deviceTimestampStr = new Date().toISOString(); // Added Timestamp
      const payloadString = nonce + deviceTimestampStr;
      const nonceBytes = new TextEncoder().encode(payloadString);
      const signatureP1363 = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        nonceBytes
      );

      // 4. Convert the IEEE P1363 signature to ASN.1 DER format (what Node's crypto.createVerify expects)
      const derSignature = ieeeP1363ToDer(signatureP1363);
      const signatureBase64 = arrayBufferToBase64(derSignature.buffer);
      const sigEnd = performance.now();
      const signingMs = Math.round(sigEnd - sigStart);

      // 5. Verify authentication on the blockchain securely
      const verifyRes = await securePost('auth/verify', {
        deviceId,
        timestamp: deviceTimestampStr, // Send timestamp to gateway
        signature: signatureBase64
      }, gatewayPubPEM);
      totalEncryptionMs += verifyRes.encryptionMs;

      const authEnd = performance.now();
      const latency = Math.round(authEnd - authStart);
      setAuthLatencies(prev => [...prev, latency]);
      // Persist to overall (cross-session) latencies
      setOverallLatencies(prev => {
        const updated = [...prev, latency];
        localStorage.setItem('overallAuthLatencies', JSON.stringify(updated));
        return updated;
      });
      setSessionEvents(prev => ({ ...prev, authentications: prev.authentications + 1 }));

      // Report latency to backend so it persists across page refreshes (same as Docker/QEMU)
      try {
        await axios.post(`${API_URL}/metrics/latency`, { deviceId, latencyMs: latency, signingMs, encryptionMs: totalEncryptionMs, source: 'browser' });
      } catch (_) { /* best-effort */ }

      addLog(`${deviceId} authenticated by Smart Contract ✓ (status: ACTIVE) — ${latency}ms`, 'success');

      // 6. Update local state to reflect the new status
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'active', lastAuth: new Date().toLocaleTimeString() } : d));

    } catch (error) {
      console.error(error);
      addLog(`Auth failed for ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
      actionGuardsRef.current.delete(deviceId);
      setAuthenticatingId(null);
    }
  };

  // Suspend a device — transitions status to 'suspended' on the blockchain.
  // The device can later be re-authenticated to return to 'active'.
  const suspendDevice = async (deviceId) => {
    if (actionGuardsRef.current.has(deviceId)) return;
    actionGuardsRef.current.add(deviceId);
    addLog(`Suspending device ${deviceId}...`, 'info');
    try {
      await axios.post(`${API_URL}/devices/suspend`, { deviceId }, { headers: { 'x-api-key': ADMIN_API_KEY } });
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'suspended' } : d));
      setSessionEvents(prev => ({ ...prev, suspensions: prev.suspensions + 1 }));
      addLog(`Device ${deviceId} suspended ⏸ (can be re-authenticated)`, 'warning');
    } catch (error) {
      console.error(error);
      addLog(`Failed to suspend ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
      actionGuardsRef.current.delete(deviceId);
    }
  };

  // Revoke a device — permanent termination on the blockchain.
  const revokeDevice = async (deviceId) => {
    if (actionGuardsRef.current.has(deviceId)) return;
    actionGuardsRef.current.add(deviceId);
    addLog(`Revoking device ${deviceId}...`, 'info');
    try {
      await axios.post(`${API_URL}/devices/revoke`, { deviceId }, { headers: { 'x-api-key': ADMIN_API_KEY } });
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'revoked' } : d));
      setSessionEvents(prev => ({ ...prev, revocations: prev.revocations + 1 }));
      addLog(`Device ${deviceId} has been revoked ✗ (permanent)`, 'error');
    } catch (error) {
      console.error(error);
      addLog(`Failed to revoke ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
      actionGuardsRef.current.delete(deviceId);
    }
  };

  // Status badge styling for the 4-state FSM
  const getStatusStyle = (status) => {
    switch (status) {
      case 'registered':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'active':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'suspended':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'revoked':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  // Card border styling per status
  const getCardBorderStyle = (status) => {
    switch (status) {
      case 'registered':
        return 'border-yellow-500/30';
      case 'active':
        return 'border-gray-700 hover:border-emerald-500/50';
      case 'suspended':
        return 'border-orange-500/30';
      case 'revoked':
        return 'border-red-500/30 opacity-60';
      default:
        return 'border-gray-700';
    }
  };

  // Icon color per status
  const getIconStyle = (status) => {
    switch (status) {
      case 'registered':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'active':
        return 'bg-blue-500/10 text-blue-400';
      case 'suspended':
        return 'bg-orange-500/10 text-orange-400';
      case 'revoked':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-gray-500/10 text-gray-400';
    }
  };

  const clearAllMetrics = async () => {
    try {
      // Clear metrics from both gateways
      await Promise.all([
        axios.delete(`${GATEWAYS.org1.url}/metrics/latency`).catch(() => {}),
        axios.delete(`${GATEWAYS.org2.url}/metrics/latency`).catch(() => {})
      ]);
      setAuthLatencies([]);
      setOverallLatencies([]);
      localStorage.removeItem('overallAuthLatencies');
      setSessionEvents(prev => ({ ...prev, authentications: 0, registrations: 0 }));
      setSimLatencyMetrics({ count: 0, avgMs: null, minMs: null, maxMs: null, latencies: [] });
      addLog('All latency metrics and session events cleared (both gateways)', 'info');
    } catch (err) {
      addLog(`Failed to clear metrics: ${err.message}`, 'error');
    }
  };

  // ── Derived metrics (recomputed on every render via useMemo) ──────────────
  const metrics = useMemo(() => {
    const total = devices.length;
    const active = devices.filter(d => d.status === 'active').length;
    const registered = devices.filter(d => d.status === 'registered').length;
    const suspended = devices.filter(d => d.status === 'suspended').length;
    const revoked = devices.filter(d => d.status === 'revoked').length;
    const lastLatency = authLatencies.length > 0 ? authLatencies[authLatencies.length - 1] : null;
    const browserAvgLatency = authLatencies.length > 0 ? Math.round(authLatencies.reduce((a, b) => a + b, 0) / authLatencies.length) : null;
    const overallAvgLatency = overallLatencies.length > 0 ? Math.round(overallLatencies.reduce((a, b) => a + b, 0) / overallLatencies.length) : null;
    const totalEvents = sessionEvents.registrations + sessionEvents.authentications + sessionEvents.suspensions + sessionEvents.revocations;
    return { total, active, registered, suspended, revoked, lastLatency, browserAvgLatency, overallAvgLatency, totalEvents };
  }, [devices, authLatencies, overallLatencies, sessionEvents]);

  // Calculate rolling average for the Docker Fleet chart — split by org
  const simChartDataOrg1 = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return [];
    const entries = simLatencyMetrics.latencies.filter(e => e.source === 'docker-simulator' && e.org === 'org1');
    let sum = 0;
    return entries.map((entry, index) => {
      sum += entry.latencyMs;
      return { authNumber: index + 1, latency: entry.latencyMs, rollingAvg: Math.round(sum / (index + 1)) };
    });
  }, [simLatencyMetrics.latencies]);

  const simChartDataOrg2 = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return [];
    const entries = simLatencyMetrics.latencies.filter(e => e.source === 'docker-simulator' && e.org === 'org2');
    let sum = 0;
    return entries.map((entry, index) => {
      sum += entry.latencyMs;
      return { authNumber: index + 1, latency: entry.latencyMs, rollingAvg: Math.round(sum / (index + 1)) };
    });
  }, [simLatencyMetrics.latencies]);

  // Combined simChartData for overall docker metrics (backwards compat)
  const simChartData = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return [];
    const dockerEntries = simLatencyMetrics.latencies.filter(e => e.source === 'docker-simulator');
    let sum = 0;
    return dockerEntries.map((entry, index) => {
      sum += entry.latencyMs;
      return { authNumber: index + 1, latency: entry.latencyMs, rollingAvg: Math.round(sum / (index + 1)) };
    });
  }, [simLatencyMetrics.latencies]);

  // Compute Docker-specific metrics from the latencies array
  const dockerMetrics = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0)
      return { count: 0, avgMs: null, minMs: null, maxMs: null };

    const dockerEntries = simLatencyMetrics.latencies.filter(e => e.source === 'docker-simulator');
    if (dockerEntries.length === 0) return { count: 0, avgMs: null, minMs: null, maxMs: null };

    const latencies = dockerEntries.map(e => e.latencyMs);
    return {
      count: dockerEntries.length,
      avgMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      minMs: Math.min(...latencies),
      maxMs: Math.max(...latencies)
    };
  }, [simLatencyMetrics.latencies]);

  // Compute QEMU-specific metrics from the same latencies array
  const qemuMetrics = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0)
      return { count: 0, avgMs: null, minMs: null, maxMs: null };

    const qemuEntries = simLatencyMetrics.latencies.filter(e => e.source === 'qemu');
    if (qemuEntries.length === 0) return { count: 0, avgMs: null, minMs: null, maxMs: null };

    const latencies = qemuEntries.map(e => e.latencyMs);
    return {
      count: qemuEntries.length,
      avgMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      minMs: Math.min(...latencies),
      maxMs: Math.max(...latencies)
    };
  }, [simLatencyMetrics.latencies]);

  // Calculate rolling average for the QEMU chart
  const qemuChartData = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return [];

    const qemuEntries = simLatencyMetrics.latencies.filter(e => e.source === 'qemu');
    let sum = 0;
    return qemuEntries.map((entry, index) => {
      sum += entry.latencyMs;
      return {
        authNumber: index + 1,
        latency: entry.latencyMs,
        rollingAvg: Math.round(sum / (index + 1))
      };
    });
  }, [simLatencyMetrics.latencies]);

  // Compute per-source phase averages for the comparison table
  const phaseComparison = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return null;

    const sources = ['browser', 'docker-simulator', 'qemu'];
    const labels = ['Browser (WebCrypto)', 'Docker Fleet (x86)', 'QEMU ARM Emulator'];
    const colors = ['text-gray-300', 'text-cyan-400', 'text-purple-400'];

    const result = sources.map((src, i) => {
      const entries = simLatencyMetrics.latencies.filter(e => e.source === src);
      if (entries.length === 0) return { label: labels[i], color: colors[i], count: 0 };

      const avg = (arr) => {
        const valid = arr.filter(v => v !== null && v !== undefined);
        return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
      };

      return {
        label: labels[i],
        color: colors[i],
        // For browser, we only count the auth entries (which have signingMs) to avoid double counting with registration entries
        count: src === 'browser' ? entries.filter(e => e.signingMs !== null).length : entries.length,
        keyGen: avg(entries.map(e => e.keyGenMs)),
        registration: avg(entries.map(e => e.registrationMs)),
        signing: avg(entries.map(e => e.signingMs)),
        encryption: avg(entries.map(e => e.encryptionMs)),
        // For browser, latencyMs on registration entries is the reg time, so we ignore it for authE2E
        authE2E: avg(entries.map(e => (src === 'browser' && e.signingMs === null) ? null : e.latencyMs)),
      };
    });

    // Only show if at least one source has data
    return result.some(r => r.count > 0) ? result : null;
  }, [simLatencyMetrics.latencies]);

  // Compute data for the Computational Cost bar chart (keyGen + signing by platform)
  const computationalCostData = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return null;

    const sourceConfig = [
      { key: 'docker-simulator', label: 'Docker Fleet (x86)', color: '#22D3EE' },
      { key: 'qemu',             label: 'QEMU ARM',          color: '#C084FC' },
      { key: 'browser',          label: 'Browser (WebCrypto)', color: '#94A3B8' },
    ];

    const avg = (arr) => {
      const valid = arr.filter(v => v !== null && v !== undefined);
      return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    };

    const rows = [];
    for (const src of sourceConfig) {
      const entries = simLatencyMetrics.latencies.filter(e => e.source === src.key);
      const keyGen = avg(entries.map(e => e.keyGenMs));
      const signing = avg(entries.map(e => e.signingMs));
      if (keyGen !== null || signing !== null) {
        const uniqueDevices = new Set(entries.map(e => e.deviceId)).size;
        rows.push({ name: src.label, color: src.color, keyGen: keyGen ?? 0, signing: signing ?? 0, count: uniqueDevices });
      }
    }

    return rows.length > 0 ? rows : null;
  }, [simLatencyMetrics.latencies]);

  // Compute data for Protocol Efficiency bar chart (payload size comparison)
  const protocolEfficiencyData = useMemo(() => {
    if (!simLatencyMetrics.latencies || simLatencyMetrics.latencies.length === 0) return null;

    const sourceConfig = [
      { key: 'docker-simulator', label: 'CoAP / CBOR (Docker Fleet)', color: '#22D3EE', protocol: 'CoAP/CBOR' },
      { key: 'qemu',             label: 'HTTP / JSON (QEMU ARM)',     color: '#C084FC', protocol: 'HTTP/JSON' },
    ];

    const avg = (arr) => {
      const valid = arr.filter(v => v !== null && v !== undefined);
      return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    };

    const rows = [];
    for (const src of sourceConfig) {
      let entries = simLatencyMetrics.latencies.filter(e => e.source === src.key && e.payloadBytes !== null && e.payloadBytes !== undefined);
      // For Docker Fleet (CoAP/CBOR comparison), only include CoAP protocol runs
      if (src.key === 'docker-simulator') {
        entries = entries.filter(e => e.protocol === 'coap');
      }
      const avgBytes = avg(entries.map(e => e.payloadBytes));
      if (avgBytes !== null) {
        rows.push({ name: src.label, protocol: src.protocol, color: src.color, avgBytes, count: entries.length });
      }
    }

    return rows.length >= 2 ? rows : null;
  }, [simLatencyMetrics.latencies]);

  // In a real implementation, we would fetch the list of registered devices from the backend API on component mount, and listen to blockchain events for real-time updates. 
  // For this prototype, we will just simulate device interactions through the "Run Simulation" button.
  // Disclaimer: Generative AI has been used for the UI bellow, thankfully the modern era saves us from writing that much Tailwind CSS by hand :D 
  
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8 font-sans">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 inline-flex items-center gap-3">
          <ShieldCheck size={40} className="text-emerald-400" />
          Decentralized IoT Auth
        </h1>
        <p className="text-gray-400 mt-2 text-lg">Blockchain-backed Identity Management</p>

        {/* ── Gateway Selector Toggle ────────────────────────── */}
        <div className="mt-5 inline-flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-full px-2 py-1.5 shadow-lg">
          {Object.entries(GATEWAYS).map(([key, gw]) => (
            <button
              key={key}
              onClick={() => {
                setActiveGateway(key);
                addLog(`Switched to ${gw.label} (${gw.msp} → ${gw.peer})`, 'info');
              }}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                activeGateway === key
                  ? 'text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              style={activeGateway === key ? { backgroundColor: gw.color } : {}}
            >
              <span className={`w-2 h-2 rounded-full ${
                activeGateway === key ? 'bg-white animate-pulse' : 'bg-gray-600'
              }`} />
              {gw.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Active: <span className="font-semibold" style={{ color: GATEWAYS[activeGateway].color }}>{GATEWAYS[activeGateway].msp}</span> → {GATEWAYS[activeGateway].peer}
        </p>
      </header>

      {/* ── Metrics Strip ────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">

        {/* Card 1 — Total Managed Devices */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-blue-500/40 transition-colors">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total Devices</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400"><Laptop size={16} /></div>
          </div>
          <p className="text-3xl font-extrabold text-gray-100 tabular-nums">{metrics.total}</p>
          <div className="mt-2 flex gap-3 text-[11px] font-medium">
            <span className="text-emerald-400">{metrics.active} active</span>
            <span className="text-yellow-400">{metrics.registered} reg</span>
            <span className="text-orange-400">{metrics.suspended} susp</span>
            <span className="text-red-400">{metrics.revoked} rev</span>
          </div>
        </div>

        {/* Card 2 — Device State Breakdown (visual bar) */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-emerald-500/40 transition-colors">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">State Breakdown</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400"><BarChart3 size={16} /></div>
          </div>
          {metrics.total > 0 ? (
            <>
              <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-800 mb-3">
                {metrics.active > 0 && <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${(metrics.active / metrics.total) * 100}%` }} />}
                {metrics.registered > 0 && <div className="bg-yellow-500 transition-all duration-500" style={{ width: `${(metrics.registered / metrics.total) * 100}%` }} />}
                {metrics.suspended > 0 && <div className="bg-orange-500 transition-all duration-500" style={{ width: `${(metrics.suspended / metrics.total) * 100}%` }} />}
                {metrics.revoked > 0 && <div className="bg-red-500 transition-all duration-500" style={{ width: `${(metrics.revoked / metrics.total) * 100}%` }} />}
              </div>
              <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-[11px]">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-gray-400">Active</span><span className="ml-auto text-gray-200 font-semibold">{metrics.active}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500" /><span className="text-gray-400">Registered</span><span className="ml-auto text-gray-200 font-semibold">{metrics.registered}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" /><span className="text-gray-400">Suspended</span><span className="ml-auto text-gray-200 font-semibold">{metrics.suspended}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-gray-400">Revoked</span><span className="ml-auto text-gray-200 font-semibold">{metrics.revoked}</span></div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600 mt-1">No devices yet</p>
          )}
        </div>

        {/* Card 4 — Session Security Events */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-violet-500/40 transition-colors">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-violet-500/5 rounded-full blur-2xl group-hover:bg-violet-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Browser Session Events</span>
            <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400"><Zap size={16} /></div>
          </div>
          <p className="text-3xl font-extrabold text-gray-100 tabular-nums">{metrics.totalEvents}</p>
          <div className="mt-2 grid grid-cols-2 gap-y-1 gap-x-4 text-[11px]">
            <span className="text-gray-400">Registrations <span className="text-gray-200 font-semibold">{sessionEvents.registrations}</span></span>
            <span className="text-gray-400">Auths <span className="text-gray-200 font-semibold">{sessionEvents.authentications}</span></span>
            <span className="text-gray-400">Suspensions <span className="text-gray-200 font-semibold">{sessionEvents.suspensions}</span></span>
            <span className="text-gray-400">Revocations <span className="text-gray-200 font-semibold">{sessionEvents.revocations}</span></span>
          </div>
        </div>

        {/* Card 5 — Blockchain Height */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-amber-500/40 transition-colors">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Block Height</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400"><Boxes size={16} /></div>
          </div>
          {blockHeight !== null ? (
            <>
              <p className="text-3xl font-extrabold text-gray-100 tabular-nums">{blockHeight}</p>
              <p className="mt-1 text-[11px] text-gray-500">Hyperledger Fabric ledger</p>
            </>
          ) : (
            <p className="text-sm text-gray-600 mt-1">Connecting…</p>
          )}
        </div>

        {/* Card 6 — Network Configuration */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-emerald-500/40 transition-colors md:col-span-2">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              <RefreshCw size={14} className={isConfiguring ? 'animate-spin text-emerald-400' : ''}/> 
              Network Configuration (Orderer)
            </span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400"><Boxes size={16} /></div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 items-center relative z-10">
            <div className="flex-1 w-full">
              <label className="text-[11px] text-gray-500 block mb-2">BatchTimeout (Time to Cut)</label>
              <div className="flex flex-wrap gap-2">
                {['2s', '1s', '500ms', '250ms'].map(t => (
                  <button
                    key={t}
                    disabled={isConfiguring}
                    onClick={() => updateOrdererConfig(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${ordererConfig?.batchTimeout === t ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-gray-500 disabled:opacity-50'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="w-full sm:w-32">
               <label className="text-[11px] text-gray-500 block mb-2">MaxMessageCount</label>
               <input 
                 type="number" 
                 value={tempMaxMsg} 
                 onChange={e => setTempMaxMsg(e.target.value)}
                 disabled={isConfiguring}
                 className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition-colors"
                 min="1"
                 max="100"
               />
            </div>
          </div>
          <p className="mt-4 text-[10px] text-gray-500 leading-tight relative z-10">
            <strong className="text-emerald-500/80 uppercase tracking-wider text-[9px] mr-1">Admin</strong>
            Live Channel Configuration Update: Modifies ordering node parameters on-the-fly. Lower timeouts reduce single-device auth latency but increase empty block generation overhead.
          </p>
        </div>
      </div>

      {/* ── Extended Metrics Panel: Auth Latency ────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl group hover:border-cyan-500/40 transition-colors">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl group-hover:bg-cyan-500/10 transition-colors" />

          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Clock size={20} /></div>
            <h2 className="text-xl font-semibold text-gray-100">Authentication Latency Analysis</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative z-10 mb-6">
            {/* Browser Session(WebCrypto) */}
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50 hover:border-gray-500/50 transition-colors">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2"><Laptop size={14} />Browser Session (WebCrypto)</span>
              <p className="text-4xl font-extrabold text-gray-100 tabular-nums mt-3">
                {metrics.browserAvgLatency ?? '—'}<span className="text-sm font-medium text-gray-500 ml-1">ms avg</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">{authLatencies.length} authentications</p>
            </div>

            {/* Docker Simulator (Node.js) */}
            <div className="bg-cyan-900/10 rounded-xl p-5 border border-cyan-800/30 hover:border-cyan-500/50 transition-colors">
              <span className="text-xs font-semibold uppercase tracking-wider text-cyan-500 flex items-center gap-2"><Boxes size={14} />Docker Fleet</span>
              <p className="text-4xl font-extrabold text-cyan-400 tabular-nums mt-3">
                {dockerMetrics.avgMs ?? '—'}<span className="text-sm font-medium text-cyan-700 ml-1">ms avg</span>
              </p>
              <p className="text-xs text-cyan-600/70 mt-2">
                {dockerMetrics.count > 0
                  ? `${dockerMetrics.count} authentications (min: ${dockerMetrics.minMs}ms, max: ${dockerMetrics.maxMs}ms)`
                  : 'Awaiting Docker run…'}
              </p>
            </div>

            {/* QEMU ARM Emulator */}
            <div className={`bg-purple-900/10 rounded-xl p-5 border ${qemuMetrics.count > 0 ? 'border-purple-800/30 hover:border-purple-500/50' : 'border-purple-800/30 border-dashed opacity-60 hover:opacity-100'} transition-all`}>
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-500 flex items-center gap-2"><Thermometer size={14} />QEMU ARM Emulator</span>
              <p className="text-4xl font-extrabold text-purple-300 tabular-nums mt-3">
                {qemuMetrics.avgMs ?? '—'}<span className="text-sm font-medium text-purple-700 ml-1">ms avg</span>
              </p>
              <p className="text-xs text-purple-600/70 mt-2">
                {qemuMetrics.count > 0
                  ? `${qemuMetrics.count} authentications (min: ${qemuMetrics.minMs}ms, max: ${qemuMetrics.maxMs}ms)`
                  : 'Awaiting QEMU run…'}
              </p>
            </div>

            {/* Browser Historical Average */}
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-500 flex items-center gap-2"><Activity size={14} />Browser Historical Avg</span>
              <p className="text-4xl font-extrabold text-emerald-400 tabular-nums mt-3">
                {metrics.overallAvgLatency ?? '—'}<span className="text-sm font-medium text-emerald-700 ml-1">ms avg</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">Aggregated across {overallLatencies.length} browser authentications</p>
            </div>
          </div>

          {/* ── Latency Graph (Docker Fleet + QEMU) ── */}
          {(simChartDataOrg1.length > 0 || simChartDataOrg2.length > 0 || qemuChartData.length > 0) && (
            <div className="relative z-10 bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 mt-2">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <BarChart3 size={16} className="text-cyan-400" /> Simulator Latency vs. Authentications
                </h3>
                <button
                  onClick={clearAllMetrics}
                  className="text-xs px-3 py-1.5 bg-red-900/30 text-red-400 border border-red-800/50 rounded hover:bg-red-900/50 transition-colors flex items-center gap-1"
                >
                  <Trash2 size={12} /> Clear Data
                </button>
              </div>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="authNumber"
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickLine={{ stroke: '#4B5563' }}
                      axisLine={{ stroke: '#4B5563' }}
                      allowDuplicatedCategory={false}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickLine={{ stroke: '#4B5563' }}
                      axisLine={{ stroke: '#4B5563' }}
                      tickFormatter={(value) => `${value}ms`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                      itemStyle={{ fontSize: '14px', fontWeight: '500' }}
                      labelStyle={{ color: '#9CA3AF', marginBottom: '4px' }}
                      formatter={(value, name) => [`${value} ms`, name]}
                      labelFormatter={(label) => `Auth #${label}`}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />

                    {/* Docker Fleet lines — Org1 (Blue) */}
                    {simChartDataOrg1.length > 0 && (
                      <Line
                        data={simChartDataOrg1}
                        type="monotone"
                        dataKey="rollingAvg"
                        name="Org1 Docker Avg"
                        stroke="#3B82F6"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: '#2563EB', stroke: '#3B82F6', strokeWidth: 2 }}
                      />
                    )}
                    {simChartDataOrg1.length > 0 && (
                      <Line
                        data={simChartDataOrg1}
                        type="monotone"
                        dataKey="latency"
                        name="Org1 Docker Individual"
                        stroke="#60A5FA"
                        strokeWidth={1}
                        dot={{ r: 2, fill: '#60A5FA' }}
                        activeDot={{ r: 4 }}
                      />
                    )}

                    {/* Docker Fleet lines — Org2 (Violet) */}
                    {simChartDataOrg2.length > 0 && (
                      <Line
                        data={simChartDataOrg2}
                        type="monotone"
                        dataKey="rollingAvg"
                        name="Org2 Docker Avg"
                        stroke="#8B5CF6"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: '#7C3AED', stroke: '#8B5CF6', strokeWidth: 2 }}
                      />
                    )}
                    {simChartDataOrg2.length > 0 && (
                      <Line
                        data={simChartDataOrg2}
                        type="monotone"
                        dataKey="latency"
                        name="Org2 Docker Individual"
                        stroke="#A78BFA"
                        strokeWidth={1}
                        dot={{ r: 2, fill: '#A78BFA' }}
                        activeDot={{ r: 4 }}
                      />
                    )}

                    {/* QEMU ARM lines */}
                    {qemuChartData.length > 0 && (
                      <Line
                        data={qemuChartData}
                        type="monotone"
                        dataKey="rollingAvg"
                        name="QEMU ARM Avg"
                        stroke="#C084FC"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: '#7C3AED', stroke: '#C084FC', strokeWidth: 2 }}
                      />
                    )}
                    {qemuChartData.length > 0 && (
                      <Line
                        data={qemuChartData}
                        type="monotone"
                        dataKey="latency"
                        name="QEMU Individual"
                        stroke="#6B21A8"
                        strokeWidth={1}
                        dot={{ r: 2, fill: '#6B21A8' }}
                        activeDot={{ r: 4 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-gray-500 text-center mt-3">
                Comparing authentication latency across x86 Docker containers and ARM-emulated QEMU environment.
              </p>
            </div>
          )}

          {/* ── Cross-Platform Performance Comparison ── */}
          {phaseComparison && (
            <div className="relative z-10 bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 mt-2">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Zap size={16} className="text-amber-400" /> Authentication Lifecycle — Cross-Platform Comparison
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Phase</th>
                      {phaseComparison.map((src) => (
                        <th key={src.label} className={`text-right py-3 px-4 font-medium ${src.color}`}>
                          {src.label}
                          {src.count > 0 && <span className="text-gray-500 font-normal text-xs ml-1">({src.count})</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { key: 'keyGen', label: 'Key Generation', icon: '🔑' },
                      { key: 'registration', label: 'Registration (Ledger Write)', icon: '📝' },
                      { key: 'signing', label: 'ECDSA Signing', icon: '✍️' },
                      { key: 'encryption', label: 'ECDH + AES Encryption', icon: '🔒' },
                      { key: 'authE2E', label: 'Auth End-to-End', icon: '⚡' },
                    ].map((phase, idx) => (
                      <tr key={phase.key} className={`border-b border-gray-800/50 ${idx % 2 === 0 ? 'bg-gray-900/20' : ''} hover:bg-gray-800/30 transition-colors`}>
                        <td className="py-3 px-4 text-gray-300 flex items-center gap-2">
                          <span>{phase.icon}</span> {phase.label}
                        </td>
                        {phaseComparison.map((src) => (
                          <td key={src.label} className={`text-right py-3 px-4 tabular-nums font-semibold ${src.count > 0 ? src.color : 'text-gray-600'}`}>
                            {src.count > 0 && src[phase.key] !== null
                              ? <>{src[phase.key]}<span className="text-gray-500 font-normal text-xs ml-1">ms</span></>
                              : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 text-center mt-3">
                Average values per phase across all recorded authentications. Sample sizes shown in parentheses.
              </p>
            </div>
          )}

          {/* ── Computational Cost Bar Chart (Key Gen + Signing) ── */}
          {computationalCostData && (
            <div className="relative z-10 bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 mt-2">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <BarChart3 size={16} className="text-amber-400" /> Computational Cost — Key Generation & ECDSA Signing
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Average cryptographic operation time per platform. Lower values indicate faster hardware / more optimized runtime.
              </p>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={computationalCostData}
                    margin={{ top: 10, right: 30, bottom: 10, left: 0 }}
                    barCategoryGap="25%"
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickLine={{ stroke: '#4B5563' }}
                      axisLine={{ stroke: '#4B5563' }}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickLine={{ stroke: '#4B5563' }}
                      axisLine={{ stroke: '#4B5563' }}
                      tickFormatter={(value) => `${value}ms`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                      itemStyle={{ fontSize: '14px', fontWeight: '500' }}
                      labelStyle={{ color: '#D1D5DB', marginBottom: '4px', fontWeight: '600' }}
                      formatter={(value, name) => [`${value} ms`, name]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="keyGen" name="Key Generation (ECDSA P-256)" radius={[6, 6, 0, 0]}>
                      {computationalCostData.map((entry, index) => (
                        <Cell key={`kg-${index}`} fill={entry.color} fillOpacity={0.85} />
                      ))}
                    </Bar>
                    <Bar dataKey="signing" name="ECDSA Signing (SHA-256)" radius={[6, 6, 0, 0]}>
                      {computationalCostData.map((entry, index) => (
                        <Cell key={`sg-${index}`} fill={entry.color} fillOpacity={0.45} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-3">
                {computationalCostData.map((entry) => (
                  <div key={entry.name} className="text-xs text-gray-400 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                    {entry.name}
                    <span className="text-gray-600">({entry.count} samples)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Protocol Efficiency Bar Chart (Payload Size) ── */}
          {protocolEfficiencyData && (
            <div className="relative z-10 bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 mt-2">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Zap size={16} className="text-emerald-400" /> Protocol Efficiency — Payload Size Comparison
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Average total bytes sent per full authentication lifecycle (Register + Challenge + Verify). CBOR binary encoding produces significantly smaller payloads than JSON text encoding.
              </p>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={protocolEfficiencyData}
                    margin={{ top: 10, right: 30, bottom: 10, left: 10 }}
                    barCategoryGap="35%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickLine={{ stroke: '#4B5563' }}
                      axisLine={{ stroke: '#4B5563' }}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickLine={{ stroke: '#4B5563' }}
                      axisLine={{ stroke: '#4B5563' }}
                      tickFormatter={(value) => `${value} B`}
                      label={{ value: 'Bytes', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                      itemStyle={{ fontSize: '14px', fontWeight: '500' }}
                      labelStyle={{ color: '#D1D5DB', marginBottom: '4px', fontWeight: '600' }}
                      formatter={(value, name) => [`${value} bytes`, name]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="avgBytes" name="Total Payload (bytes)" radius={[6, 6, 0, 0]}>
                      {protocolEfficiencyData.map((entry, index) => (
                        <Cell key={`pe-${index}`} fill={entry.color} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Savings callout */}
              {protocolEfficiencyData.length >= 2 && (() => {
                const coapEntry = protocolEfficiencyData.find(e => e.protocol === 'CoAP/CBOR');
                const httpEntry = protocolEfficiencyData.find(e => e.protocol === 'HTTP/JSON');
                if (coapEntry && httpEntry && httpEntry.avgBytes > 0) {
                  const savings = Math.round((1 - coapEntry.avgBytes / httpEntry.avgBytes) * 100);
                  return (
                    <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-800/30 rounded-lg text-center">
                      <p className="text-sm text-emerald-400 font-semibold">
                        CoAP/CBOR reduces payload size by ~{savings}% compared to HTTP/JSON
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {coapEntry.avgBytes} bytes vs {httpEntry.avgBytes} bytes per authentication lifecycle ({coapEntry.count} / {httpEntry.count} samples)
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">

        {/* Devices Panel */}
        <div className="col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Laptop className="text-blue-400" />
              Device Registry
            </h2>
            <button
              onClick={simulateDevice}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {loading ? <RefreshCw className="animate-spin" size={18} /> : <Activity size={18} />}
              Simulate Device
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {devices.length === 0 ? (
              <div className="col-span-full p-8 text-center text-gray-500 border border-dashed border-gray-700 rounded-xl">
                No devices registered. Run a simulation to create one.
              </div>
            ) : (
              devices.map(device => (
                <div key={device.id} className={`bg-gray-800 border rounded-xl p-5 transition-colors ${getCardBorderStyle(device.status)}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-lg ${getIconStyle(device.status)}`}>
                      <Thermometer size={24} />
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${getStatusStyle(device.status)}`}>
                      {device.status.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-200">{device.id}</h3>
                  <p className="text-sm text-gray-400 mb-4">{device.type}</p>
                  <div className="flex justify-between items-center">
                    <div className="text-xs text-gray-500">
                      <span>Last Auth: </span>
                      <span className="text-gray-300">{device.lastAuth}</span>
                    </div>
                    <div className="flex gap-2">
                      {/* Authenticate button: available for 'registered' and 'suspended' devices */}
                      {(device.status === 'registered' || device.status === 'suspended') && (
                        <button
                          onClick={() => authenticateDevice(device.id)}
                          disabled={authenticatingId === device.id}
                          className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 border border-emerald-500/20 disabled:opacity-50"
                        >
                          {authenticatingId === device.id ? <RefreshCw className="animate-spin" size={14} /> : <KeyRound size={14} />}
                          Authenticate
                        </button>
                      )}
                      {/* Suspend button: available for 'active' devices */}
                      {device.status === 'active' && (
                        <button
                          onClick={() => suspendDevice(device.id)}
                          className="px-3 py-1.5 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 border border-orange-500/20"
                        >
                          <Pause size={14} />
                          Suspend
                        </button>
                      )}
                      {/* Revoke button: available for all non-revoked devices */}
                      {device.status !== 'revoked' && (
                        <button
                          onClick={() => revokeDevice(device.id)}
                          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 border border-red-500/20"
                        >
                          <ShieldOff size={14} />
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Audit Logs Panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            <Activity className="text-emerald-400" />
            Audit Logs
          </h2>

          <div className="flex-1 overflow-y-auto pr-2 space-y-3">
            {logs.map(log => (
              <div key={log.id} className={`p-4 rounded-xl border ${log.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300' :
                log.type === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-300' :
                  log.type === 'warning' ? 'bg-orange-500/5 border-orange-500/20 text-orange-300' :
                    'bg-gray-800/50 border-gray-700/50 text-gray-300'
                }`}>
                <div className="text-xs opacity-70 mb-1">{log.time}</div>
                <div className="text-sm font-medium">{log.message}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
