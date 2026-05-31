## Authentication Lifecycle — Average Cross-Platform Comparison

## No ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 2s, MaxMessageCount = 10

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 10 | 50 | 10 |
| **Key Generation** | 74 ms | 4 ms | 215 ms |
| **Registration (Ledger Write)** | 2489 ms | 844 ms | 2179 ms |
| **ECDSA Signing** | 0 ms* | 10 ms | 112 ms |
| **Auth End-to-End** | 2184 ms | 1908 ms | 2292 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 2s, MaxMessageCount = 10

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 10 | 50 | 10 |
| **Key Generation** | 29 ms | 2 ms | 182 ms |
| **Registration (Ledger Write)** | 2093 ms | 966 ms | 2563 ms |
| **ECDSA Signing** | 0 ms* | 5 ms | 103 ms |
| **Auth End-to-End** | 1751 ms | 1434 ms | 3126 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 2s, MaxMessageCount = 10

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 15 | 50 | 10 |
| **Key Generation** | 44 ms | 3 ms | 185 ms |
| **Registration (Ledger Write)** | 2077 ms | 925 ms | 2664 ms |
| **ECDSA Signing** | 0 ms* | 6 ms | 109 ms |
| **ECDH + AES Encryption** | 0 ms* | 3 ms | 633 ms |
| **Auth End-to-End** | 2054 ms | 1840 ms | 3136 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 1s, MaxMessageCount = 10

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 5 | 20 | 10 |
| **Key Generation** | 53 ms | 3 ms | 206 ms |
| **Registration (Ledger Write)** | 1063 ms | 1023 ms | 1794 ms |
| **ECDSA Signing** | 0 ms* | 4 ms | 96 ms |
| **ECDH + AES Encryption** | 0 ms* | 2 ms | 637 ms |
| **Auth End-to-End** | 1624 ms | 1339 ms | 2396 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 0.5s, MaxMessageCount = 10

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 10 | 20 | 10 |
| **Key Generation** | 40 ms | 6 ms | 120 ms |
| **Registration (Ledger Write)** | 750 ms | 927 ms | 1155 ms |
| **ECDSA Signing** | 1 ms | 6 ms | 96 ms |
| **ECDH + AES Encryption** | 1 ms | 3 ms | 522 ms |
| **Auth End-to-End** | 1146 ms | 639 ms | 1676 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 0.5s, MaxMessageCount = 5

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 15 | 20 | 10 |
| **Key Generation** | 61 ms | 6 ms | 149 ms |
| **Registration (Ledger Write)** | 655 ms | 583 ms | 960 ms |
| **ECDSA Signing** | 0 ms | 5 ms | 97 ms |
| **ECDH + AES Encryption** | 0 ms | 3 ms | 589 ms |
| **Auth End-to-End** | 1076 ms | 1156 ms | 1745 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 10

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 15 | 20 | 10 |
| **Key Generation** | 75 ms | 5 ms | 218 ms |
| **Registration (Ledger Write)** | 445 ms | 414 ms | 1379 ms |
| **ECDSA Signing** | 0 ms | 6 ms | 110 ms |
| **ECDH + AES Encryption** | 0 ms | 3 ms | 763 ms |
| **Auth End-to-End** | 585 ms | 565 ms | 1580 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 15

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 15 | 20 | 10 |
| **Key Generation** | 88 ms | 6 ms | 168 ms |
| **Registration (Ledger Write)** | 447 ms | 464 ms | 866 ms |
| **ECDSA Signing** | 0 ms | 5 ms | 126 ms |
| **ECDH + AES Encryption** | 1 ms | 3 ms | 752 ms |
| **Auth End-to-End** | 898 ms | 865 ms | 1945 ms |

## With ECDH + AES Application Security:
# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 5

| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| Nr. of tests | 15 | 20 | 10 |
| **Key Generation** | 83 ms | 4 ms | 191 ms |
| **Registration (Ledger Write)** | 493 ms | 316 ms | 779 ms |
| **ECDSA Signing** | 0 ms | 5 ms | 123 ms |
| **ECDH + AES Encryption** | 1 ms | 3 ms | 582 ms |
| **Auth End-to-End** | 900 ms | 405 ms | 1527 ms |