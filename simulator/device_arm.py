#!/usr/bin/env python3
"""
QEMU ARM Device Simulator — Python version for resource-constrained ARM emulation.

Due to QEMU SLIRP UDP NAT timeouts dropping CoAP responses, this QEMU 
simulator utilizes the HTTP/REST gateway endpoint, while the Docker fleet
utilizes the CoAP/UDP gateway endpoint. This perfectly demonstrates the 
dual-protocol architecture of the Edge Gateway.
"""

import os
import sys
import time
import socket
import random
import hashlib
from datetime import datetime, timezone
import subprocess
import tempfile
import urllib.request
import json

API_URL = os.environ.get('API_URL', 'http://127.0.0.1:3000/api/v1')
SOURCE  = os.environ.get('SOURCE', 'qemu')

SENSOR_TYPES = [
    'temperature_sensor', 'humidity_sensor', 'motion_detector',
    'pressure_sensor', 'gas_sensor', 'light_sensor', 'vibration_sensor',
]

def http_post(endpoint, data):
    """POST JSON to the backend API and return (parsed_response, payload_bytes)."""
    url = f"{API_URL}/{endpoint}"
    payload = json.dumps(data).encode('utf-8')
    payload_bytes = len(payload)
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            resp_body = response.read().decode('utf-8')
            parsed = json.loads(resp_body) if resp_body else {}
            return parsed, payload_bytes
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode('utf-8')
        print(f"    HTTP Error {e.code}: {resp_body}")
        raise Exception(resp_body)
    except Exception as e:
        print(f"    Request Failed: {e}")
        raise

def main():
    # Stagger startup (0-3s) like the Docker fleet
    time.sleep(random.random() * 3)

    hostname = socket.gethostname()[:6]
    device_id = os.environ.get('DEVICE_ID', f"qemu-{hostname}-{random.randint(1000, 9999)}")
    device_type = os.environ.get('DEVICE_TYPE', random.choice(SENSOR_TYPES))

    print(f"[+] Initializing QEMU ARM Simulator for {device_id} ({device_type})")

    # 1. Generate ECDSA key pair using openssl CLI
    print('[+] Generating secp256r1 ECDSA key pair (via openssl)...')
    t0 = time.time()

    with tempfile.NamedTemporaryFile(suffix='.pem', delete=False) as kf:
        key_file = kf.name
    with tempfile.NamedTemporaryFile(suffix='.pem', delete=False) as pf:
        pub_file = pf.name

    # Generate EC private key
    subprocess.check_call(
        ['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key_file],
        stderr=subprocess.DEVNULL
    )
    # Extract public key in SPKI/PEM format
    subprocess.check_call(
        ['openssl', 'ec', '-in', key_file, '-pubout', '-out', pub_file],
        stderr=subprocess.DEVNULL
    )

    with open(pub_file, 'r') as f:
        public_key_pem = f.read()

    t1 = time.time()
    key_gen_ms = int((t1 - t0) * 1000)
    print(f"    Key Generation took: {key_gen_ms:.2f} ms\n")

    # Track total payload bytes sent across all operations (for protocol efficiency comparison)
    total_payload_bytes = 0

    # 2. Register Device
    print('[+] Registering device on Decentralized Framework (via HTTP/REST)...')
    reg_start = time.time()
    try:
        _, reg_bytes = http_post('devices/register', {
            'deviceId': device_id,
            'deviceType': device_type,
            'publicKey': public_key_pem,
        })
        total_payload_bytes += reg_bytes
        reg_end = time.time()
        registration_ms = int((reg_end - reg_start) * 1000)
        print(f"    Registration Successful! ({registration_ms} ms, {reg_bytes} bytes)\n")
    except Exception as e:
        print(f"    Registration Failed: {e}")
        return

    # 3. Request Challenge
    print('[+] Requesting Authentication Challenge...')
    auth_start = time.time()
    try:
        resp, ch_bytes = http_post('auth/challenge', {'deviceId': device_id})
        total_payload_bytes += ch_bytes
        nonce = resp.get('nonce')
        if not nonce:
            print(f"    Error: No nonce received. Response was: {resp}")
            return
        print(f"    Received Nonce: {nonce}\n")
    except Exception as e:
        print(f"    Challenge Request Failed: {e}")
        return

    # 4. Sign Challenge using openssl
    print('[+] Signing Nonce...')
    t2 = time.time()

    # Write nonce + timestamp to a temp file for openssl to sign
    device_timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False, mode='w') as nf:
        nonce_file = nf.name
        nf.write(nonce + device_timestamp)
    with tempfile.NamedTemporaryFile(suffix='.sig', delete=False) as sf:
        sig_file = sf.name

    # Sign with SHA256
    subprocess.check_call(
        ['openssl', 'dgst', '-sha256', '-sign', key_file, '-out', sig_file, nonce_file],
        stderr=subprocess.DEVNULL
    )

    # Read raw DER signature and base64 encode it
    with open(sig_file, 'rb') as f:
        sig_der = f.read()

    import base64
    signature_b64 = base64.b64encode(sig_der).decode('utf-8')

    t3 = time.time()
    signing_ms = int((t3 - t2) * 1000)
    print(f"    Cryptographic Signature generation took: {signing_ms:.2f} ms\n")

    # 5. Verify Authentication
    print('[+] Authenticating Response (Blockchain Verification)...')
    try:
        resp, ver_bytes = http_post('auth/verify', {
            'deviceId': device_id,
            'timestamp': device_timestamp,
            'signature': signature_b64,
        })
        total_payload_bytes += ver_bytes
        auth_end = time.time()
        auth_latency = int((auth_end - auth_start) * 1000)
        token = resp.get('token', 'N/A')
        print(f"    Authentication Successful! Received Token: {token}")
        print(f"    End-to-end Auth Latency: {auth_latency} ms")
        print(f"    Total JSON payload sent: {total_payload_bytes} bytes\n")

        # 6. Report latency to backend
        try:
            http_post('metrics/latency', {
                'deviceId': device_id,
                'latencyMs': auth_latency,
                'keyGenMs': key_gen_ms,
                'registrationMs': registration_ms,
                'signingMs': signing_ms,
                'payloadBytes': total_payload_bytes,
                'source': SOURCE,
            })
            print('    Latency reported to backend ✓\n')
        except Exception as e:
            print(f"    Warning: Could not report latency: {e}")

    except Exception as e:
        print(f"    Authentication Failed: {e}")

    # Cleanup temp files
    for f in [key_file, pub_file, nonce_file, sig_file]:
        try:
            os.unlink(f)
        except OSError:
            pass

if __name__ == '__main__':
    main()
