import test from "node:test";
import assert from "node:assert/strict";
import {
  getPresenceBatched,
  getPriorityGameKey,
} from "../src/monitoring/target-scanner.js";

test("presence batches retry IDs omitted from a partial response", async () => {
  let calls = 0;
  const result = await getPresenceBatched(
    [101, 202],
    {
      maxAttempts: 2,
      presenceFetcher: async (ids) => {
        calls += 1;
        if (calls === 1) {
          return [{ userId: 101, userPresenceType: 2 }];
        }
        assert.deepEqual(ids, [202]);
        return [{ userId: 202, userPresenceType: 0 }];
      },
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(result.checkedIds.sort((a, b) => a - b), [101, 202]);
});

test("presence batches retry successful empty responses", async () => {
  let calls = 0;
  const result = await getPresenceBatched(
    [303],
    {
      maxAttempts: 2,
      presenceFetcher: async () => {
        calls += 1;
        return calls === 1
          ? []
          : [{ userId: 303, userPresenceType: 2 }];
      },
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(result.checkedIds, [303]);
});

test("presence batches retry transient HTTP failures", async () => {
  let attempts = 0;
  const result = await getPresenceBatched([404], async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("temporary outage");
      error.status = 503;
      throw error;
    }
    return [{ userId: 404, userPresenceType: 2 }];
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result.checkedIds, [404]);
});

test("presence batches use secondary presence source for unresolved IDs", async () => {
  const result = await getPresenceBatched(
    [505],
    {
      maxAttempts: 1,
      presenceFetcher: async () => [],
      fallbackFetcher: async (ids) => {
        assert.deepEqual(ids, [505]);
        return [{ userId: 505, userPresenceType: 2 }];
      },
    },
  );

  assert.deepEqual(result.checkedIds, [505]);
  assert.equal(result.presences[0].userPresenceType, 2);
});


test("game instance join helper builds exact JobId bridge URLs", async () => {
  const previousBridge = process.env.ROBLOX_JOIN_BRIDGE_BASE_URL;
  process.env.ROBLOX_JOIN_BRIDGE_BASE_URL = "https://example.test";

  try {
    const { getGameInstanceJoinUrl } = await import(
      "../src/roblox/game-session.js"
    );
    assert.equal(
      getGameInstanceJoinUrl(123456, "abc-123"),
      "https://example.test/join/server/123456/abc-123",
    );
    assert.equal(getGameInstanceJoinUrl(null, "abc-123"), null);
    assert.equal(getGameInstanceJoinUrl(123456, ""), null);
  } finally {
    if (previousBridge === undefined) {
      delete process.env.ROBLOX_JOIN_BRIDGE_BASE_URL;
    } else {
      process.env.ROBLOX_JOIN_BRIDGE_BASE_URL = previousBridge;
    }
  }
});


test("priority games recognize MM2, Adopt Me, Blade Ball, and PS99", () => {
  assert.equal(
    getPriorityGameKey({ userPresenceType: 2, universeId: 66654135 }),
    "mm2",
  );
  assert.equal(
    getPriorityGameKey({ userPresenceType: 2, universeId: 383310974 }),
    "adopt-me",
  );
  assert.equal(
    getPriorityGameKey({ userPresenceType: 2, universeId: 4777817887 }),
    "blade-ball",
  );
  assert.equal(
    getPriorityGameKey({ userPresenceType: 2, universeId: 3317771874 }),
    "ps99",
  );
  assert.equal(
    getPriorityGameKey({
      userPresenceType: 2,
      universeId: 999,
      lastLocation: "Pet Simulator 99!",
    }),
    "ps99",
  );
  assert.equal(
    getPriorityGameKey({
      userPresenceType: 2,
      universeId: 999,
      lastLocation: "Blox Fruits",
    }),
    null,
  );
});


test("verified player join helper builds click-time verification URL", async () => {
  const previousBridge = process.env.ROBLOX_JOIN_BRIDGE_BASE_URL;
  process.env.ROBLOX_JOIN_BRIDGE_BASE_URL = "https://example.test";

  try {
    const { getVerifiedPlayerJoinUrl } = await import(
      "../src/roblox/game-session.js"
    );
    assert.equal(
      getVerifiedPlayerJoinUrl(123456),
      "https://example.test/join/verified-user/123456",
    );
    assert.equal(getVerifiedPlayerJoinUrl(0), null);
  } finally {
    if (previousBridge === undefined) {
      delete process.env.ROBLOX_JOIN_BRIDGE_BASE_URL;
    } else {
      process.env.ROBLOX_JOIN_BRIDGE_BASE_URL = previousBridge;
    }
  }
});
