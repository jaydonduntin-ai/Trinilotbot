import test from "node:test";
import assert from "node:assert/strict";
import {
  findRolimonsItem,
  searchRolimonsItems,
} from "../src/sources/rolimons-items.js";

test("Rolimon's catalog lookup resolves names, acronyms, ids, and value", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        success: true,
        items: {
          "1125510": ["The Void Star", "VS", 400000, 450000, 450000, 3, 2, -1, -1, 1],
          "4390891467": ["Silver King of the Night", "SKOTN", 405000, 440000, 440000, 3, 2, -1, -1, 1],
        },
      };
    },
  });

  try {
    const byName = await findRolimonsItem("The Void Star");
    const byAcronym = await findRolimonsItem("SKOTN");
    const byId = await findRolimonsItem("1125510");
    const search = await searchRolimonsItems("silver", 10);

    assert.equal(byName?.id, 1125510);
    assert.equal(byName?.value, 450000);
    assert.equal(byAcronym?.name, "Silver King of the Night");
    assert.equal(byId?.acronym, "VS");
    assert.equal(search[0]?.id, 4390891467);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
