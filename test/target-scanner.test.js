import test from "node:test";
import assert from "node:assert/strict";
import { getPresenceBatched } from "../src/monitoring/target-scanner.js";

test("presence batches only mark IDs actually returned by Roblox as checked", async () => {
  const result = await getPresenceBatched([101, 202], async () => [
    { userId: 101, userPresenceType: 2 },
  ]);

  assert.deepEqual(result.checkedIds, [101]);
});

test("presence batches retry transient failures", async () => {
  let attempts = 0;
  const result = await getPresenceBatched([303], async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("temporary outage");
      error.status = 503;
      throw error;
    }
    return [{ userId: 303, userPresenceType: 2 }];
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result.checkedIds, [303]);
});
