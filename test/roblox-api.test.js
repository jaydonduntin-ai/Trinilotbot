import test from "node:test";
import assert from "node:assert/strict";
import {
  getAssetOwners,
  getRobloxUserById,
  getRobloxUsersByIds,
} from "../src/roblox/api.js";

test("asset-owner lookup accepts arbitrary command limits while using a valid page size", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: Array.from({ length: 10 }, (_, index) => ({
            id: 1000 + index,
            owner: { id: 2000 + index },
            serialNumber: index + 1,
          })),
          nextPageCursor: "next",
        });
      },
    };
  };

  try {
    const result = await getAssetOwners(123, { limit: 7 });
    assert.match(requestedUrl, /limit=10/);
    assert.equal(result.owners.length, 7);
    assert.equal(result.owners[0].userId, 2000);
    assert.equal(result.hasMore, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Roblox user profile resolution batches IDs through POST /v1/users", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  let requestedBody = null;
  let requestedMethod = null;

  globalThis.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    requestedMethod = options.method ?? "GET";
    requestedBody = JSON.parse(options.body ?? "{}");

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [
            { id: 101, name: "Alpha", displayName: "Alpha D" },
            { id: 202, name: "Bravo", displayName: "Bravo D" },
          ],
        });
      },
    };
  };

  try {
    const users = await getRobloxUsersByIds([101, 202, 101]);
    assert.equal(requestedUrl, "https://users.roblox.com/v1/users");
    assert.equal(requestedMethod, "POST");
    assert.deepEqual(requestedBody.userIds, [101, 202]);
    assert.equal(users.length, 2);
    assert.equal(users[0].name, "Alpha");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("single Roblox user lookup also uses the batch endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [{ id: 303, name: "Charlie", displayName: "Charlie D" }],
        });
      },
    };
  };

  try {
    const user = await getRobloxUserById(303);
    assert.equal(requestedUrl, "https://users.roblox.com/v1/users");
    assert.equal(user.name, "Charlie");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
