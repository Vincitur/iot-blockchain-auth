# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 5
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 493 ms | 316 ms | 779 ms |
| **Auth End-to-End** | 900 ms | 405 ms | 1527 ms |

# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 10
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 445 ms | 414 ms | 1379 ms |
| **Auth End-to-End** | 585 ms | 565 ms | 1580 ms |

# BatchTimeout (Time to Cut) = 0.25s, MaxMessageCount = 15
| Phase | Browser (WebCrypto) | Docker Fleet (x86) | QEMU ARM Emulator |
| **Registration (Ledger Write)** | 447 ms | 464 ms | 866 ms |
| **Auth End-to-End** | 898 ms | 865 ms | 1945 ms |

