import test from "node:test";
import assert from "node:assert/strict";
import { resolveHealthStatus } from "../src/web/join-bridge.js";

test("health status defaults healthy when no probe is supplied", () => {
  assert.equal(resolveHealthStatus(), true);
});

test("health status follows the supplied readiness probe", () => {
  assert.equal(resolveHealthStatus(() => true), true);
  assert.equal(resolveHealthStatus(() => false), false);
});

test("health status fails closed when the readiness probe throws", () => {
  assert.equal(
    resolveHealthStatus(() => {
      throw new Error("probe failed");
    }),
    false,
  );
});
