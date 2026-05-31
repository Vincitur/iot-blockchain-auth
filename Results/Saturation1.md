## Docker Fleet (x86) CoAP stress testing
BatchTimeout (Time to Cut) = 2s & Number of devices = 100
MaxMessageCount | Latency (ms) | BH | Fails (Register devices that did not Authenticate)
5 | 1645 | 48 | 6
10 | 2276 | 27 | 0
15 | 2511 | 24 | 5
20 | 3704 | 25 | 0

BatchTimeout (Time to Cut) = 1s & Number of devices = 100
MaxMessageCount | Latency (ms) | BH | Fails (Register devices that did not Authenticate)
5 | 1148 | 55 | 3
10 | 1977 | 34 | 10

* In all cases the BH was computed considering the initial 6 Configuration blocks & the extra block for each configuration change.