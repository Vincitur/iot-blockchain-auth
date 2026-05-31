## Docker Fleet (x86) CoAP concurrent stress testing

BatchTimeout (Time to Cut) = 2s, MaxMessageCount = 10.
Number of devices | Latency (ms) | TPS | BH | Fails
	10 | 332 | 0.63 | 2 | 0
	50 | 1718 | 1.59 | 13 | 0 
	100 | 1929 | 1.51 | 26 | 0
	200 | 1831 | 1.39 | 49 | 1
	500 | 2248 | 0.96 | 126 | 83

# For 500 devices the Docker CPU reached values of 75% ussage
