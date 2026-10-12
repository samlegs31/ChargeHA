/** Bounded, local measurements. No vehicle identifiers, credentials or exporters. */
export class RuntimeMetrics {
  private samples: number[] = [];
  private cursor = 0;
  private count = 0;
  private failures = 0;
  private lastAt: string | null = null;

  record(durationMs: number, success: boolean): void {
    this.samples[this.cursor] = Math.max(0, durationMs);
    this.cursor = (this.cursor + 1) % 128;
    this.count++;
    if (!success) this.failures++;
    this.lastAt = new Date().toISOString();
  }

  snapshot() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count: this.count,
      failures: this.failures,
      samples: sorted.length,
      p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
      lastAt: this.lastAt,
    };
  }
}

export const controllerMetrics = new RuntimeMetrics();
export const commandMetrics = new RuntimeMetrics();
