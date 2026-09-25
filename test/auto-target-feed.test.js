import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("automatic target feed runs discovery directly with no RAP minimum", async () => {
  const source = await readFile(
    new URL("../src/monitoring/scan-watcher.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("scanDiscoveredTargets({"), true);
  assert.equal(source.includes("minimumRap: null"), true);
  assert.equal(source.includes("getFreshLiveTargetPresences"), false);
  assert.equal(source.includes("ROBLOX_AUTO_TARGET_MIN_RAP"), false);
  assert.match(source, /all Roblox games · no RAP minimum/);
});

test("legacy scan-watchlist presence loop cannot compete with auto feed", async () => {
  const source = await readFile(
    new URL("../src/monitoring/scan-watcher.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("getPresenceBatched"), false);
  assert.equal(source.includes("checkScanWatchlist("), false);
  assert.equal(source.includes("updateScanPresences"), false);
  assert.match(source, /single recurring presence consumer/);
});

test("rbx2mm2 invokes the scanner with no RAP minimum", async () => {
  const source = await readFile(
    new URL("../src/commands/rbx2mm2.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("minimumRap: null"), true);
  assert.equal(source.includes('.setName("min_rap")'), false);
  assert.match(source, /No RAP minimum/i);
});
