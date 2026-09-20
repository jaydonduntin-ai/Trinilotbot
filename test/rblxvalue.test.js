import test from "node:test";
import assert from "node:assert/strict";
import { getRblxValueProfile } from "../src/providers/rblxvalue.js";

test("RBLXValue profile lookup prefers Roblox username over numeric user ID", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ROBLOX_RBLXVALUE_API_KEY;
  let requestedUrl = null;

  process.env.ROBLOX_RBLXVALUE_API_KEY = "test-key";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          profile: {
            username: "ExampleUser",
            total_value: 65000,
            item_count: 12,
          },
        };
      },
    };
  };

  try {
    const result = await getRblxValueProfile({
      username: "ExampleUser",
      userId: 123456,
      requestTimeoutMs: 1000,
      maxRetries: 0,
    });

    assert.match(requestedUrl, /\/v2\/profile\/ExampleUser$/);
    assert.equal(result.status, "verified");
    assert.equal(result.totalValue, 65000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.ROBLOX_RBLXVALUE_API_KEY;
    } else {
      process.env.ROBLOX_RBLXVALUE_API_KEY = originalKey;
    }
  }
});

test("RBLXValue profile 404 is treated as unavailable instead of throwing", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ROBLOX_RBLXVALUE_API_KEY;

  process.env.ROBLOX_RBLXVALUE_API_KEY = "test-key";
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    headers: {
      get() {
        return null;
      },
    },
  });

  try {
    const result = await getRblxValueProfile({
      username: "NoPublicProfile_Test_404",
      requestTimeoutMs: 1000,
      maxRetries: 0,
    });

    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /no public profile/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.ROBLOX_RBLXVALUE_API_KEY;
    } else {
      process.env.ROBLOX_RBLXVALUE_API_KEY = originalKey;
    }
  }
});
