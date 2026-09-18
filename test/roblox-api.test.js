import test from "node:test";
import assert from "node:assert/strict";
import { getAssetOwners } from "../src/roblox/api.js";

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
