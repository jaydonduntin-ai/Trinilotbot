const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 8;

export class SlidingWindowRateLimiter {
  #entries = new Map();
  #checks = 0;

  constructor({
    windowMs = DEFAULT_WINDOW_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
  } = {}) {
    this.windowMs = readPositiveInteger(windowMs, DEFAULT_WINDOW_MS);
    this.maxRequests = readPositiveInteger(maxRequests, DEFAULT_MAX_REQUESTS);
  }

  check(key, now = Date.now()) {
    this.#checks += 1;
    if (this.#checks % 100 === 0) {
      this.#prune(now);
    }

    const timestamps = (this.#entries.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    if (timestamps.length >= this.maxRequests) {
      this.#entries.set(key, timestamps);
      return {
        allowed: false,
        retryAfterMs: Math.max(1, this.windowMs - (now - timestamps[0])),
      };
    }

    timestamps.push(now);
    this.#entries.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear() {
    this.#entries.clear();
    this.#checks = 0;
  }

  #prune(now) {
    for (const [key, timestamps] of this.#entries) {
      const fresh = timestamps.filter(
        (timestamp) => now - timestamp < this.windowMs,
      );
      if (fresh.length === 0) this.#entries.delete(key);
      else this.#entries.set(key, fresh);
    }
  }
}

export const commandRateLimiter = new SlidingWindowRateLimiter({
  windowMs: process.env.DISCORD_RATE_LIMIT_WINDOW_MS,
  maxRequests: process.env.DISCORD_RATE_LIMIT_MAX_REQUESTS,
});

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
