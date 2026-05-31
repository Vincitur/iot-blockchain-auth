# Marius-Remus Dumitrel - Graphic script to plot latency and TPS from the Saturation2.md data
import matplotlib.pyplot as plt
import os
import os

# Data from Saturation2.md
devices = [10, 20, 50, 100, 200, 500, 1000]
latency = [2726, 1837, 1751, 2276, 1819, 1956, 2064]
tps = [0.96, 1.33, 1.38, 1.35, 1.33, 1.14, 0.74]

# Create figure with 2 subplots (stacked under each other)
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 11), facecolor='#f8f9fa')

# Top Plot: Latency vs Concurrent Devices
ax1.set_facecolor('#ffffff')
ax1.plot(devices, latency, marker='o', linestyle='-', color='#e74c3c', label='End-to-End Latency', linewidth=2.5, markersize=8)
ax1.set_title('Authentication Latency vs. Concurrent Devices', fontsize=16, fontweight='bold', pad=15)
ax1.set_ylabel('Latency (ms)', fontsize=14, labelpad=10)
ax1.set_xticks(devices)
ax1.tick_params(axis='x', labelsize=11, rotation=45)
ax1.tick_params(axis='y', labelsize=12)
ax1.grid(True, linestyle=':', alpha=0.7, color='#95a5a6')
ax1.legend(fontsize=12, loc='upper right', frameon=True, shadow=True)

# Bottom Plot: TPS vs Concurrent Devices
ax2.set_facecolor('#ffffff')
ax2.plot(devices, tps, marker='s', linestyle='-', color='#2ecc71', label='Throughput (TPS)', linewidth=2.5, markersize=8)
ax2.set_title('Network Throughput vs. Concurrent Devices', fontsize=16, fontweight='bold', pad=15)
ax2.set_xlabel('Number of Concurrent Devices', fontsize=14, labelpad=10)
ax2.set_ylabel('Transactions Per Second (TPS)', fontsize=14, labelpad=10)
ax2.set_xticks(devices)
ax2.tick_params(axis='x', labelsize=11, rotation=45)
ax2.tick_params(axis='y', labelsize=12)
ax2.grid(True, linestyle=':', alpha=0.7, color='#95a5a6')
ax2.legend(fontsize=12, loc='upper right', frameon=True, shadow=True)

# Annotate the TPS peak
ax2.annotate('Peak TPS (1.38)', xy=(50, 1.38), xytext=(100, 1.37),
             arrowprops=dict(facecolor='black', shrink=0.05, width=1.5, headwidth=6),
             fontsize=11, fontweight='bold')

# Annotate the CPU saturation
ax2.annotate('CPU hits 92%', xy=(1000, 0.74), xytext=(600, 0.85),
             arrowprops=dict(facecolor='black', shrink=0.05, width=1.5, headwidth=6),
             fontsize=11, fontweight='bold', color='#e74c3c')

# Layout adjustment
plt.tight_layout()

# Save the plot in the same directory as the script
output_path = os.path.join(os.path.dirname(__file__), 'concurrent_stress_test_plot.png')
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"Plot successfully saved to: {output_path}")
