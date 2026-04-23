#!/usr/bin/env python3
"""
QEMU ARM Device Simulator — Python version for resource-constrained ARM emulation.

This script performs the same registration + authentication flow as device.js
but uses only Python standard library + openssl CLI, so it runs on the
Raspbian Buster ARM image without needing Node.js or pip packages.
"""

import os
import sys
import json
import time
import socket
import random
import hashlib
import subprocess
import tempfile

# Python 2/3 compat for urllib
try:
    from urllib.request import Request, urlopen
    from urllib.error import URLError, HTTPError
except ImportError:
    from urllib2 import Request, urlopen, URLError, HTTPError

API_URL = os.environ.get('API_URL', 'http://127.0.0.1:3000/api/v1')
SOURCE  = os.environ.get('SOURCE', 'qemu')

SENSOR_TYPES = [
    'temperature_sensor', 'humidity_sensor', 'motion_detector',
    'pressure_sensor', 'gas_sensor', 'light_sensor', 'vibration_sensor',
]

def api_post(endpoint, data):
    """POST JSON to the backend API and return the parsed response."""
    url = '{}/{}'.format(API_URL, endpoint)
    payload = json.dumps(data).encode('utf-8')
    req = Request(url, data=payload, headers={'Content-Type': 'application/json'})
    try:
        resp = urlopen(req, timeout=30)
        return json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body = e.read().decode('utf-8')
        print('    HTTP Error {}: {}'.format(e.code, body))
        raise
    except URLError as e:
        print('    Connection Error: {}'.format(e.reason))
        raise

def main():
    # Stagger startup (0-3s) like the Docker fleet
    time.sleep(random.random() * 3)

    hostname = socket.gethostname()[:6]
    device_id = os.environ.get('DEVICE_ID', 'qemu-{}-{}'.format(hostname, random.randint(1000, 9999)))
    device_type = os.environ.get('DEVICE_TYPE', random.choice(SENSOR_TYPES))

    print('[+] Initializing QEMU ARM Simulator for {} ({})'.format(device_id, device_type))

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
    print('    Key Generation took: {:.2f} ms\n'.format((t1 - t0) * 1000))

    # 2. Register Device
    print('[+] Registering device on Decentralized Framework (via API)...')
    reg_start = time.time()
    try:
        api_post('devices/register', {
            'deviceId': device_id,
            'deviceType': device_type,
            'publicKey': public_key_pem,
        })
        reg_end = time.time()
        registration_ms = int((reg_end - reg_start) * 1000)
        print('    Registration Successful! ({} ms)\n'.format(registration_ms))
    except Exception as e:
        print('    Registration Failed: {}'.format(e))
        return

    # 3. Request Challenge
    print('[+] Requesting Authentication Challenge...')
    auth_start = time.time()
    try:
        resp = api_post('auth/challenge', {'deviceId': device_id})
        nonce = resp['nonce']
        print('    Received Nonce: {}\n'.format(nonce))
    except Exception as e:
        print('    Challenge Request Failed: {}'.format(e))
        return

    # 4. Sign Challenge using openssl
    print('[+] Signing Nonce...')
    t2 = time.time()

    # Write nonce to a temp file for openssl to sign
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False, mode='w') as nf:
        nonce_file = nf.name
        nf.write(nonce)
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
    print('    Cryptographic Signature generation took: {:.2f} ms\n'.format((t3 - t2) * 1000))

    # 5. Verify Authentication
    print('[+] Authenticating Response (Blockchain Verification)...')
    try:
        resp = api_post('auth/verify', {
            'deviceId': device_id,
            'signature': signature_b64,
        })
        auth_end = time.time()
        auth_latency = int((auth_end - auth_start) * 1000)
        print('    Authentication Successful! Received Token: {}'.format(resp.get('token', 'N/A')))
        print('    End-to-end Auth Latency: {} ms\n'.format(auth_latency))

        # 6. Report latency to backend
        try:
            api_post('metrics/latency', {
                'deviceId': device_id,
                'latencyMs': auth_latency,
                'keyGenMs': key_gen_ms,
                'registrationMs': registration_ms,
                'signingMs': signing_ms,
                'source': SOURCE,
            })
            print('    Latency reported to backend ✓\n')
        except Exception as e:
            print('    Warning: Could not report latency: {}'.format(e))

    except Exception as e:
        print('    Authentication Failed: {}'.format(e))

    # Cleanup temp files
    for f in [key_file, pub_file, nonce_file, sig_file]:
        try:
            os.unlink(f)
        except OSError:
            pass

if __name__ == '__main__':
    main()
