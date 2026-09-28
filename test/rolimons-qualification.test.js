import assert from "node:assert/strict";
import test from "node:test";
import {
  hasRolimonsDiscoverySource,
  hasVerifiedRolimonsRap,
  qualifiesForRolimonsDiscovery,
} from "../src/monitoring/rolimons-qualification.js";

test("accepts a 5K+ candidate discovered and RAP-verified through Rolimon's", () => {
  const candidate = {
    sources: new Set(["Rolimon's player search"]),
    lastKnownRap: 12_345,
    lastKnownRapSource: "Rolimon's public player info",
  };
  assert.equal(qualifiesForRolimonsDiscovery(candidate), true);
});

test("rejects high RAP from a non-Rolimon's RAP source", () => {
  const candidate = {
    sources: new Set(["Rolimon's player search"]),
    lastKnownRap: 50_000,
    lastKnownRapSource: "Roblox public inventory",
  };
  assert.equal(hasRolimonsDiscoverySource(candidate), true);
  assert.equal(hasVerifiedRolimonsRap(candidate), false);
  assert.equal(qualifiesForRolimonsDiscovery(candidate), false);
});

test("rejects a Rolimon's value seed whose ownership was discovered elsewhere", () => {
  const candidate = {
    sources: new Set(["Rolimon's limited catalog + Roblox public asset owners"]),
    lastKnownRap: 50_000,
    lastKnownRapSource: "Rolimon's public player info",
  };
  assert.equal(qualifiesForRolimonsDiscovery(candidate), false);
});

test("rejects Rolimon's candidates below the configured RAP floor", () => {
  const candidate = {
    sources: new Set(["Rolimon's recent trade ads"]),
    lastKnownRap: 4_999,
    lastKnownRapSource: "Rolimon's value leaderboard",
  };
  assert.equal(qualifiesForRolimonsDiscovery(candidate), false);
});
