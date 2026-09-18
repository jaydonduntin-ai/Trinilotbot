export class TtlCache {
  #entries = new Map();

  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key, now = Date.now()) {
    const entry = this.#entries.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs, now = Date.now()) {
    this.#entries.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
    return value;
  }

  async getOrSet(key, loader, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await loader();
    return this.set(key, value, ttlMs);
  }

  clear() {
    this.#entries.clear();
  }
}

export const providerCache = new TtlCache();
