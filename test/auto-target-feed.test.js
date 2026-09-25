import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("/target is registered alongside /rbx2mm2", async () => {
  const source = await readFile(
    new URL("../src/commands/index.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /targetsCommand/);
  assert.match(source, /rbx2mm2Command/);
});

test("automatic target delivery is disabled", async () => {
  const source = await readFile(
    new URL("../src/monitoring/scan-watcher.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("scanDiscoveredTargets"), false);
  assert.equal(source.includes("channel.send"), false);
  assert.match(source, /on-demand \/target active/);
});

test("background candidate-pool warmup remains enabled", async () => {
  const source = await readFile(
    new URL("../src/index.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /startTargetCandidatePoolWarmup/);
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
