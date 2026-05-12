import matplotlib.pyplot as plt
import numpy as np
import os

# Data
devices = [5, 10, 50, 100, 200]
e2e_latency = [2113, 1981, 1825, 1802, 1917]
reg_latency = [1394, 996, 950, 1068, 1084]

# Create figure and axis
plt.figure(figsize=(10, 6), facecolor='#f8f9fa')
ax = plt.axes()
ax.set_facecolor('#ffffff')

# Plot lines
plt.plot(devices, e2e_latency, marker='o', linestyle='-', color='#e74c3c', label='End-to-End Latency', linewidth=2.5, markersize=8)
plt.plot(devices, reg_latency, marker='s', linestyle='--', color='#3498db', label='Registration Latency', linewidth=2.5, markersize=8)

# Titles and Labels
plt.title('Concurrent Authentication Latency vs. Number of Devices', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Number of Concurrent Devices', fontsize=14, labelpad=10)
plt.ylabel('Latency (ms)', fontsize=14, labelpad=10)

# Axes formatting
plt.xticks(devices, fontsize=12)
plt.yticks(fontsize=12)

# Grid and Legend
plt.grid(True, linestyle=':', alpha=0.7, color='#95a5a6')
plt.legend(fontsize=12, loc='upper right', frameon=True, shadow=True)

# Layout adjustment
plt.tight_layout()

# Save the plot in the same directory as the script
output_path = os.path.join(os.path.dirname(__file__), 'concurrent_latency_plot.png')
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"Plot successfully saved to: {output_path}")

# Display the plot if running interactively
# plt.show()
