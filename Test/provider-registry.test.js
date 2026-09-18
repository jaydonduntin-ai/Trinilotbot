import test from "node:test";
import assert from "node:assert/strict";
import {
  clearProvidersForTests,
  getProviders,
  registerProvider,
  queryProviders,
} from "../src/providers/provider-registry.js";

test("provider registry supports capability-based modular providers", async () => {
  clearProvidersForTests();
  registerProvider({
    name: "test-mm2",
    capabilities: ["mm2-value"],
    query: async () => ({
      status: "verified",
      value: 123,
    }),
  });

  assert.equal(getProviders("mm2-value").length, 1);
  assert.deepEqual(await queryProviders("mm2-value", {}), [
    { provider: "test-mm2", status: "verified", value: 123 },
  ]);
  clearProvidersForTests();
});
