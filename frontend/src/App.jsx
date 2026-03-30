import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Activity, ShieldCheck, ShieldOff, ShieldAlert, Thermometer, Laptop, RefreshCw, KeyRound, Pause, BarChart3, Clock, Zap, Shield, Boxes } from 'lucide-react';
import './index.css';

// the API_URL should match the backend server's address and port defined in server.js (3000) and routes.js (/api/v1)
const API_URL = 'http://localhost:3000/api/v1';

function App() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
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

  // Overall latencies persisted across sessions via localStorage
  const [overallLatencies, setOverallLatencies] = useState(() => {
    try {
      const stored = localStorage.getItem('overallAuthLatencies');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

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
          addLog(`Restored ${Object.keys(restoredKeys).length} private key(s) from local storage`, 'info');
        }
      } catch (error) {
        console.error('Failed to fetch devices from ledger:', error);
        addLog('Warning: Could not connect to backend. Is the Fabric network running?', 'error');
      }
    };
    fetchDevices();
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

  // PHASE 1: Simulate Device Registration only.
  // Uses the browser-native Web Crypto API (SubtleCrypto) for ECDSA P-256 key generation.
  // The device starts in the 'registered' state and is NOT yet authenticated.
  const simulateDevice = async () => {
    setLoading(true);
    const sensor = sensorTypes[Math.floor(Math.random() * sensorTypes.length)];
    const deviceId = `${sensor.prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    
    addLog(`Simulating ${sensor.label} → ${deviceId}`, 'info');

    try {
      // 1. Generate ECDSA P-256 key pair using the browser's native Web Crypto API
      const keyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true, // extractable so we can export the public key
        ['sign', 'verify']
      );

      // 2. Export public key as SPKI → PEM (the format Node's crypto.createVerify expects)
      const spkiBuffer = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
      const publicKeyPEM = spkiToPem(spkiBuffer);

      // 3. Register device on the blockchain via backend API
      await axios.post(`${API_URL}/devices/register`, {
        deviceId,
        deviceType: sensor.type,
        publicKey: publicKeyPEM
      });

      addLog(`Device ${deviceId} registered on ledger (status: REGISTERED)`, 'success');
      setSessionEvents(prev => ({ ...prev, registrations: prev.registrations + 1 }));

      // 4. Store the private key in-memory and persist to localStorage as JWK
      //    so the key survives page refreshes (simulates the key living on the physical device)
      setDeviceKeys(prev => ({ ...prev, [deviceId]: keyPair.privateKey }));
      const jwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
      localStorage.setItem(`deviceKey_${deviceId}`, JSON.stringify(jwk));

      // 5. Add the device to the dashboard with 'registered' status
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
    setAuthenticatingId(deviceId);
    addLog(`Starting authentication for ${deviceId}...`, 'info');

    const privateKey = deviceKeys[deviceId];
    if (!privateKey) {
      addLog(`Error: No private key found for ${deviceId}. Cannot authenticate.`, 'error');
      setAuthenticatingId(null);
      return;
    }

    const authStart = performance.now();
    try {
      // 1. Request authentication challenge (nonce) from the backend
      addLog(`Challenge requested for ${deviceId}`, 'info');
      const challengeRes = await axios.post(`${API_URL}/auth/challenge`, { deviceId });
      const nonce = challengeRes.data.nonce;
      
      // 2. Sign the nonce with ECDSA SHA-256 using Web Crypto
      addLog(`${deviceId} signing challenge nonce (ECDSA secp256r1)`, 'info');
      const nonceBytes = new TextEncoder().encode(nonce);
      const signatureP1363 = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        nonceBytes
      );

      // 3. Convert the IEEE P1363 signature to ASN.1 DER format (what Node's crypto.createVerify expects)
      const derSignature = ieeeP1363ToDer(signatureP1363);
      const signatureBase64 = arrayBufferToBase64(derSignature.buffer);

      // 4. Verify authentication on the blockchain — this transitions the device to 'active'
      await axios.post(`${API_URL}/auth/verify`, {
        deviceId,
        signature: signatureBase64
      });

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

      addLog(`${deviceId} authenticated by Smart Contract ✓ (status: ACTIVE) — ${latency}ms`, 'success');

      // 5. Update local state to reflect the new status
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'active', lastAuth: new Date().toLocaleTimeString() } : d));

    } catch (error) {
      console.error(error);
      addLog(`Auth failed for ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
      setAuthenticatingId(null);
    }
  };

  // Suspend a device — transitions status to 'suspended' on the blockchain.
  // The device can later be re-authenticated to return to 'active'.
  const suspendDevice = async (deviceId) => {
    addLog(`Suspending device ${deviceId}...`, 'info');
    try {
      await axios.post(`${API_URL}/devices/suspend`, { deviceId });
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'suspended' } : d));
      setSessionEvents(prev => ({ ...prev, suspensions: prev.suspensions + 1 }));
      addLog(`Device ${deviceId} suspended ⏸ (can be re-authenticated)`, 'warning');
    } catch (error) {
      console.error(error);
      addLog(`Failed to suspend ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    }
  };

  // Revoke a device — permanent termination on the blockchain.
  const revokeDevice = async (deviceId) => {
    addLog(`Revoking device ${deviceId}...`, 'info');
    try {
      await axios.post(`${API_URL}/devices/revoke`, { deviceId });
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'revoked' } : d));
      setSessionEvents(prev => ({ ...prev, revocations: prev.revocations + 1 }));
      addLog(`Device ${deviceId} has been revoked ✗ (permanent)`, 'error');
    } catch (error) {
      console.error(error);
      addLog(`Failed to revoke ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
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

  // ── Derived metrics (recomputed on every render via useMemo) ──────────────
  const metrics = useMemo(() => {
    const total = devices.length;
    const active = devices.filter(d => d.status === 'active').length;
    const registered = devices.filter(d => d.status === 'registered').length;
    const suspended = devices.filter(d => d.status === 'suspended').length;
    const revoked = devices.filter(d => d.status === 'revoked').length;
    const lastLatency = authLatencies.length > 0 ? authLatencies[authLatencies.length - 1] : null;
    const sessionAvgLatency = authLatencies.length > 0 ? Math.round(authLatencies.reduce((a, b) => a + b, 0) / authLatencies.length) : null;
    const overallAvgLatency = overallLatencies.length > 0 ? Math.round(overallLatencies.reduce((a, b) => a + b, 0) / overallLatencies.length) : null;
    const totalEvents = sessionEvents.registrations + sessionEvents.authentications + sessionEvents.suspensions + sessionEvents.revocations;
    return { total, active, registered, suspended, revoked, lastLatency, sessionAvgLatency, overallAvgLatency, totalEvents };
  }, [devices, authLatencies, overallLatencies, sessionEvents]);

  // In a real implementation, we would fetch the list of registered devices from the backend API on component mount, and listen to blockchain events for real-time updates. 
  // For this prototype, we will just simulate device interactions through the "Run Simulation" button.
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8 font-sans">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 inline-flex items-center gap-3">
          <ShieldCheck size={40} className="text-emerald-400" />
          Decentralized IoT Auth
        </h1>
        <p className="text-gray-400 mt-2 text-lg">Blockchain-backed Identity Management</p>
      </header>

      {/* ── Metrics Strip ────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">

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

        {/* Card 3 — Authentication Latency (Session Avg + Overall Avg) */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-cyan-500/40 transition-colors">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl group-hover:bg-cyan-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Auth Latency</span>
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Clock size={16} /></div>
          </div>
          {metrics.sessionAvgLatency !== null || metrics.overallAvgLatency !== null ? (
            <>
              <div className="flex items-baseline gap-3">
                <div>
                  <p className="text-2xl font-extrabold text-gray-100 tabular-nums">{metrics.sessionAvgLatency ?? '—'}<span className="text-xs font-medium text-gray-500 ml-0.5">ms</span></p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Session Avg</p>
                </div>
                <div className="w-px h-8 bg-gray-700" />
                <div>
                  <p className="text-2xl font-extrabold text-gray-100 tabular-nums">{metrics.overallAvgLatency ?? '—'}<span className="text-xs font-medium text-gray-500 ml-0.5">ms</span></p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Overall Avg</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">{authLatencies.length} this session · {overallLatencies.length} total</p>
            </>
          ) : (
            <p className="text-sm text-gray-600 mt-1">Awaiting first auth…</p>
          )}
        </div>

        {/* Card 4 — Session Security Events */}
        <div className="relative overflow-hidden bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl group hover:border-violet-500/40 transition-colors">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-violet-500/5 rounded-full blur-2xl group-hover:bg-violet-500/10 transition-colors" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Session Events</span>
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
              <div key={log.id} className={`p-4 rounded-xl border ${
                log.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300' :
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
