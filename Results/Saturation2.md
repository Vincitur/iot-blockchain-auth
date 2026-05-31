## Docker Fleet (x86) CoAP concurrent stress testing

BatchTimeout (Time to Cut) = 2s, MaxMessageCount = 10.
Number of devices | Latency (ms) | TPS | BH | Fails
	10 | 2726 | 0.96 | 3 | 0
	20 | 1837 | 1.33 | 5 | 0
	50 | 1751 | 1.38 | 13 | 0 
	100 | 2276 | 1.35 | 25 | 0
	200 | 1819 | 1.33 | 50 | 5
	500 | 1956 | 1.14 | 123 | 0
	1000 | 2064 | 0.74 | 280 | 0

# For 500 concurrent devices the Docker CPU reached values of 78% usage
# For 1000 concurrent devices the Docker CPU reached values of 92% usage
