## Authentication Lifecycle — Average Cross-Platform Comparison

# BatchTimeout (Time to Cut) = 2s, MaxMessageCount = 10
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 2077 ms | 925 ms | 2664 ms |
| **Auth End-to-End** | 2054 ms | 1840 ms | 3136 ms |

# BatchTimeout (Time to Cut) = 1s, MaxMessageCount = 10
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 1063 ms | 1023 ms | 1794 ms |
| **Auth End-to-End** | 1624 ms | 1339 ms | 2396 ms |

# BatchTimeout (Time to Cut) = 0.5s, MaxMessageCount = 10
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 750 ms | 927 ms | 1155 ms |
| **Auth End-to-End** | 1146 ms | 639 ms | 1676 ms |

# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 10
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 445 ms | 414 ms | 1379 ms |
| **Auth End-to-End** | 585 ms | 565 ms | 1580 ms |
