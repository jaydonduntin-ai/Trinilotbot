import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimiter } from "../src/security/rate-limit.js";

test("rate limiter permits the configured number and returns retry time", () => {
  const limiter = new SlidingWindowRateLimiter({
    windowMs: 1_000,
    maxRequests: 2,
  });

  assert.equal(limiter.check("user:command", 0).allowed, true);
  assert.equal(limiter.check("user:command", 100).allowed, true);
  const blocked = limiter.check("user:command", 200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 800);
  assert.equal(limiter.check("other-user:command", 200).allowed, true);
  assert.equal(limiter.check("user:command", 1_001).allowed, true);
});
