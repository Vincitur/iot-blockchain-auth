#!/bin/bash
# stress-test.sh
# Marius-Remus Dumitrel

NUMBER_of_DEVICES=$1
if [ -z "$NUMBER_of_DEVICES" ]; then
    echo "Using: bash stress-test.sh <number_of_devices>"
    exit 1
fi
echo "Starting stress test with $NUMBER_of_DEVICES concurrent devices..."
# Record start time in seconds (with nanosecond precision)
START_TIME=$(date +%s.%N)
# Spin up N containers concurrently using docker-compose
docker-compose -f docker-compose.coap.yml up -d --scale sensor=$NUMBER_of_DEVICES
# Wait for all simulating devices containers to exit (meaning they finished authentication or failed)
# device.js exits after it finishes the authentication process, so we can use that as a signal to know when all devices are done.
while [ $(docker ps -q --filter "name=sensor" | wc -l) -gt 0 ]; do
    sleep 1
done
# Record end time
END_TIME=$(date +%s.%N)
# Calculate duration and TPS using awk (good for Windows compatibility)
DURATION=$(awk "BEGIN {print $END_TIME - $START_TIME}")
TPS=$(awk "BEGIN {printf \"%.2f\", $NUMBER_of_DEVICES / $DURATION}")
echo "=========================================="
echo "Stress Test Complete!"
echo "Total Devices: $NUMBER_of_DEVICES"
echo "Time Elapsed:  $DURATION seconds"
echo "Throughput:    $TPS Transactions Per Second (TPS)"
echo "=========================================="
# Cleanup the containers for the next run
docker-compose -f docker-compose.coap.yml down