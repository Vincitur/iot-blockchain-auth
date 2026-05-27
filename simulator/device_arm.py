#!/usr/bin/env python3
"""
Marius-Remus Dumitrel: QEMU ARM Device Simulator — Python version for resource-constrained ARM emulation.

Due to QEMU SLIRP UDP NAT timeouts dropping CoAP responses, this QEMU  simulator utilizes the HTTP/REST gateway endpoint, 
while the Docker fleet utilizes the CoAP/UDP gateway endpoint. This perfectly demonstrates the dual-protocol architecture of the Edge Gateway.
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

API_URL = os.environ.get('API_URL', 'http://10.0.2.2:3000/api/v1')

# Pre-Shared Key for device registration authorization (Sybil attack prevention), it should match backend's REGISTRATION_PSK
REGISTRATION_PSK = os.environ.get('REGISTRATION_PSK', 'iot-device-psk-2024')
SOURCE  = os.environ.get('SOURCE', 'qemu')

SENSOR_TYPES = [
    'temperature_sensor', 'humidity_sensor', 'motion_detector',
    'pressure_sensor', 'gas_sensor', 'light_sensor', 'vibration_sensor',
]

# HTTP GET helper with retry logic and error handling
def http_get(endpoint, retries=3):
    # GET request to the backend API with retry logic.
    url = f"{API_URL}/{endpoint}"
    req = urllib.request.Request(url, method='GET')
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                resp_body = response.read().decode('utf-8')
                return json.loads(resp_body) if resp_body else {}
        except urllib.error.HTTPError as e:
            resp_body = e.read().decode('utf-8')
            print(f"    HTTP Error {e.code}: {resp_body}")
            raise Exception(resp_body)
        except Exception as e:
            if attempt < retries:
                delay = 2 ** attempt
                print(f"    Request failed (attempt {attempt}/{retries}): {e} — retrying in {delay}s...")
                time.sleep(delay)
            else:
                print(f"    Request Failed after {retries} attempts: {e}")
                raise

# HTTP POST helper with retry logic, returns (response_data, payload_bytes)
def http_post(endpoint, data, retries=3):
    # POST JSON to the backend API with retry logic.
    url = f"{API_URL}/{endpoint}"
    payload = json.dumps(data).encode('utf-8')
    payload_bytes = len(payload)
    for attempt in range(1, retries + 1):
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
            if attempt < retries:
                delay = 2 ** attempt
                print(f"    Request failed (attempt {attempt}/{retries}): {e} — retrying in {delay}s...")
                time.sleep(delay)
            else:
                print(f"    Request Failed after {retries} attempts: {e}")
                raise

# Application-layer security: ECDH key exchange + AES-256-CBC encryption for secure communication with the gateway, even over HTTP.
def secure_http_post(endpoint, payload_obj, gateway_pub_pem):
    # Encrypts the payload using ECDH key exchange and AES-256-CBC before sending it to the gateway, then decrypts the response.
    import tempfile
    import os
    import subprocess
    import json
    import binascii

    # Create temporary files
    with tempfile.NamedTemporaryFile(suffix='.pem', delete=False) as eph_kf, \
         tempfile.NamedTemporaryFile(suffix='.pem', delete=False) as eph_pf, \
         tempfile.NamedTemporaryFile(suffix='.pem', delete=False, mode='w') as gw_pf, \
         tempfile.NamedTemporaryFile(suffix='.bin', delete=False) as sec_f, \
         tempfile.NamedTemporaryFile(suffix='.json', delete=False, mode='w') as pl_f, \
         tempfile.NamedTemporaryFile(suffix='.enc', delete=False) as enc_f:
        
        # Store file paths for cleanup
        eph_key_file = eph_kf.name
        eph_pub_file = eph_pf.name
        gw_pub_file = gw_pf.name
        secret_file = sec_f.name
        payload_file = pl_f.name
        encrypted_file = enc_f.name
        
        gw_pf.write(gateway_pub_pem)
        pl_f.write(json.dumps(payload_obj))

    try:
        enc_start = time.time()
        # 1. Generate ECDH key pair using openssl CLI
        subprocess.check_call(['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', eph_key_file], stderr=subprocess.DEVNULL)
        subprocess.check_call(['openssl', 'ec', '-in', eph_key_file, '-pubout', '-out', eph_pub_file], stderr=subprocess.DEVNULL)
        
        with open(eph_pub_file, 'r') as f:
            eph_pub_pem = f.read()

        # 2. Derive shared secret
        subprocess.check_call(['openssl', 'pkeyutl', '-derive', '-inkey', eph_key_file, '-peerkey', gw_pub_file, '-out', secret_file], stderr=subprocess.DEVNULL)
        
        with open(secret_file, 'rb') as f:
            secret = f.read()

        # 3. Hash secret to get AES key
        import hashlib
        aes_key = hashlib.sha256(secret).digest()
        aes_key_hex = binascii.hexlify(aes_key).decode('utf-8')

        # 4. Generate IV and Encrypt
        iv = os.urandom(16)
        iv_hex = binascii.hexlify(iv).decode('utf-8')

        subprocess.check_call(['openssl', 'enc', '-aes-256-cbc', '-K', aes_key_hex, '-iv', iv_hex, '-in', payload_file, '-out', encrypted_file], stderr=subprocess.DEVNULL)
        
        with open(encrypted_file, 'rb') as f:
            ciphertext = binascii.hexlify(f.read()).decode('utf-8')
        enc_end = time.time()
        encryption_ms = int((enc_end - enc_start) * 1000)

        # 5. Send Request
        req_data = {
            'ephemeralPublicKey': eph_pub_pem,
            'iv': iv_hex,
            'ciphertext': ciphertext
        }
        resp_data, payload_bytes = http_post(endpoint, req_data)

        # 6. Decrypt Response
        if resp_data and 'ciphertext' in resp_data:
            with tempfile.NamedTemporaryFile(suffix='.enc', delete=False) as resp_enc_f, \
                 tempfile.NamedTemporaryFile(suffix='.json', delete=False) as resp_dec_f:
                resp_enc_file = resp_enc_f.name
                resp_dec_file = resp_dec_f.name
                
                resp_enc_f.write(binascii.unhexlify(resp_data['ciphertext']))
            
            try:
                subprocess.check_call(['openssl', 'enc', '-d', '-aes-256-cbc', '-K', aes_key_hex, '-iv', resp_data['iv'], '-in', resp_enc_file, '-out', resp_dec_file], stderr=subprocess.DEVNULL)
                with open(resp_dec_file, 'r') as f:
                    resp_data = json.loads(f.read())
            finally:
                os.unlink(resp_enc_file)
                os.unlink(resp_dec_file)

        return resp_data, payload_bytes, encryption_ms

    finally:
        for f in [eph_key_file, eph_pub_file, gw_pub_file, secret_file, payload_file, encrypted_file]:
            try:
                os.unlink(f)
            except OSError:
                pass

def main():
    # Stagger startup (0-3s) like the Docker fleet
    time.sleep(random.random() * 3)

    # Generate a unique device ID and randomly select a device type for this simulated device instance. 
    # The device ID is prefixed with "qemu" to distinguish it from Docker-based devices in the backend.
    hostname = socket.gethostname()[:6]
    device_id = os.environ.get('DEVICE_ID', f"qemu-{hostname}-{random.randint(1000, 9999)}")
    device_type = os.environ.get('DEVICE_TYPE', random.choice(SENSOR_TYPES))

    print(f"[+] Initializing QEMU ARM Simulator for {device_id} ({device_type})")

    # 0. Generate ECDSA key pair using openssl CLI
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

    # 1. Fetch Gateway Public Key
    print('[+] Fetching Gateway Public Key...')
    try:
        gw_resp = http_get('gateway/key')
        gateway_pub_pem = gw_resp.get('publicKey')
        print('    Gateway public key received.\n')
    except Exception as e:
        print(f"    Failed to fetch Gateway public key: {e}")
        return

    # Track total payload bytes sent across all operations
    total_payload_bytes = 0

    # 2. Register Device
    print('[+] Registering device on Decentralized Framework (via HTTP/REST)...')
    reg_start = time.time()
    try:
        _, reg_bytes, _ = secure_http_post('devices/register', {
            'deviceId': device_id,
            'deviceType': device_type,
            'publicKey': public_key_pem,
            'psk': REGISTRATION_PSK,
        }, gateway_pub_pem)
        total_payload_bytes += reg_bytes
        reg_end = time.time()
        registration_ms = int((reg_end - reg_start) * 1000)
        print(f"    Registration Successful! ({registration_ms} ms, {reg_bytes} bytes)\n")
    except Exception as e:
        print(f"    Registration Failed: {e}")
        return

    # 3. Request Challenge
    print('[+] Requesting Authentication Challenge...')
    total_encryption_ms = 0
    auth_start = time.time()
    try:
        resp, ch_bytes, ch_enc_ms = secure_http_post('auth/challenge', {'deviceId': device_id}, gateway_pub_pem)
        total_payload_bytes += ch_bytes
        total_encryption_ms += ch_enc_ms
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
        resp, ver_bytes, ver_enc_ms = secure_http_post('auth/verify', {
            'deviceId': device_id,
            'timestamp': device_timestamp,
            'signature': signature_b64,
        }, gateway_pub_pem)
        total_payload_bytes += ver_bytes
        total_encryption_ms += ver_enc_ms
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
                'encryptionMs': total_encryption_ms,
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
