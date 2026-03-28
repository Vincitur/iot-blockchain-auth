import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Activity, ShieldCheck, ShieldOff, Thermometer, Laptop, RefreshCw } from 'lucide-react';
import './index.css';

// the API_URL should match the backend server's address and port defined in server.js (3000) and routes.js (/api/v1)
const API_URL = 'http://localhost:3000/api/v1';

function App() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);

  // In a real scenario we'd query /api/v1/network/devices to get all devices,
  // but since our chaincode doesn't currently emit a "getAll" function easily without CouchDB,
  // we will just mock a dashboard display for demonstration, and in reality, a backend would
  // persist registered devices in a local DB (like MongoDB) listening to `DeviceRegistered` events.
  
  // For the sake of this prototype, we'll simulate the state fetching or use static logs.
  const [logs, setLogs] = useState([
    { id: '1', time: new Date().toLocaleTimeString(), message: 'System Initialized', type: 'info' }
  ]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [{ id: Date.now().toString(), time: new Date().toLocaleTimeString(), message, type }, ...prev]);
  };

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

  // Uses the browser-native Web Crypto API (SubtleCrypto) for ECDSA P-256 key generation and signing.
  // This avoids all Node.js polyfill issues (Buffer, crypto, stream, etc.)
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

      addLog(`Device ${deviceId} registered successfully`, 'success');
      setDevices(prev => [...prev, { id: deviceId, type: sensor.label, status: 'active', lastAuth: new Date().toLocaleTimeString() }]);
      
      // 4. Request authentication challenge
      addLog(`Challenge requested for ${deviceId}`, 'info');
      const challengeRes = await axios.post(`${API_URL}/auth/challenge`, { deviceId });
      const nonce = challengeRes.data.nonce;
      
      // 5. Sign the nonce with ECDSA SHA-256 using Web Crypto
      addLog(`${deviceId} signing challenge nonce (ECDSA secp256r1)`, 'info');
      const nonceBytes = new TextEncoder().encode(nonce);
      const signatureP1363 = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        nonceBytes
      );

      // 6. Convert the IEEE P1363 signature to ASN.1 DER format (what Node's crypto.createVerify expects)
      const derSignature = ieeeP1363ToDer(signatureP1363);
      const signatureBase64 = arrayBufferToBase64(derSignature.buffer);

      // 7. Verify authentication on the blockchain
      await axios.post(`${API_URL}/auth/verify`, {
        deviceId,
        signature: signatureBase64
      });

      addLog(`${deviceId} authenticated by Smart Contract ✓`, 'success');
    } catch (error) {
       console.error(error);
       addLog(`Error: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    } finally {
       setLoading(false);
    }
  };

  const revokeDevice = async (deviceId) => {
    addLog(`Revoking device ${deviceId}...`, 'info');
    try {
      await axios.post(`${API_URL}/devices/revoke`, { deviceId });
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'revoked' } : d));
      addLog(`Device ${deviceId} has been revoked ✗`, 'error');
    } catch (error) {
      console.error(error);
      addLog(`Failed to revoke ${deviceId}: ${error.response ? JSON.stringify(error.response.data) : error.message}`, 'error');
    }
  };

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

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Devices Panel */}
        <div className="col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Laptop className="text-blue-400" />
              Active Devices
            </h2>
            <button 
              onClick={simulateDevice}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {loading ? <RefreshCw className="animate-spin" size={18} /> : <Activity size={18} />}
              Run Simulation
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {devices.length === 0 ? (
              <div className="col-span-full p-8 text-center text-gray-500 border border-dashed border-gray-700 rounded-xl">
                No active devices. Run a simulation.
              </div>
            ) : (
              devices.map(device => (
                <div key={device.id} className={`bg-gray-800 border rounded-xl p-5 transition-colors ${
                  device.status === 'revoked' 
                    ? 'border-red-500/30 opacity-60' 
                    : 'border-gray-700 hover:border-emerald-500/50'
                }`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-lg ${
                      device.status === 'revoked' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                    }`}>
                      <Thermometer size={24} />
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                      device.status === 'revoked'
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}>
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
                    {device.status === 'active' && (
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
