import test from "node:test";
import assert from "node:assert/strict";
import { getPresenceBatched } from "../src/monitoring/target-scanner.js";

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
