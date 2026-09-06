"""Render the CC0 synthetic evaluation figure; optional matplotlib dependency."""
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

figure, axis = plt.subplots(figsize=(7, 4.5), dpi=150)
axis.errorbar([0.1, 0.5, 1.0], [0.9, 0.7, 0.4], yerr=[0.05, 0.08, 0.1], marker="o", capsize=6)
for x, y, error in [(0.1, 0.9, 0.05), (0.5, 0.7, 0.08), (1.0, 0.4, 0.1)]:
    axis.annotate(f"{y:.2f} +/- {error:.2f}", (x, y), xytext=(5, 12), textcoords="offset points")
axis.set(xlabel="Temperature", ylabel="Acceptance rate", title="Figure 2 — synthetic CC0 fixture", xlim=(0, 1.15), ylim=(0.2, 1.1))
axis.grid(alpha=0.2)
figure.tight_layout()
figure.savefig(Path(__file__).resolve().parents[1] / "test/fixtures/chat-evaluation/figure-2.png")
