/** Small single-flight cache: successful weather data only, never vehicle commands. */
export class ForecastCache<T> {
  private entries = new Map<string, { pending: Promise<T>; expires: number }>();
  constructor(
    private ttlMs = 300_000,
    private limit = 4,
    private now = () => Date.now(),
  ) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (
      existing &&
      (existing.expires === Infinity ||
        (this.now() < existing.expires &&
          this.now() >= existing.expires - this.ttlMs))
    ) return existing.pending;
    this.entries.delete(key);
    if (this.entries.size >= this.limit) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    const entry = { pending: Promise.resolve().then(load), expires: Infinity };
    this.entries.set(key, entry);
    entry.pending = entry.pending.then((value) => {
      entry.expires = this.now() + this.ttlMs;
      return value;
    }, (error) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    return entry.pending;
  }
}
