import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("cold candidate sampling advances without skipping buffered records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trinilotbot-cold-"));
  const previousVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;

  try {
    const moduleUrl = new URL(
      "../src/storage/candidate-database.js",
      import.meta.url,
    );
    moduleUrl.searchParams.set(
      "test",
      `${Date.now()}-${Math.random()}`,
    );
    const database = await import(moduleUrl.href);

    await database.appendColdCandidates(
      Array.from({ length: 12 }, (_, index) => ({
        userId: index + 1,
        lastSeenAt: 1_000 + index,
        lastKnownRap: 100_000 + index,
        sources: ["test"],
      })),
    );

    const first = await database.sampleColdCandidateDatabase({
      limit: 3,
      offset: 0,
    });
    assert.deepEqual(
      first.candidates.map((candidate) => candidate.userId),
      [1, 2, 3],
    );
    assert.equal(first.eof, false);
    assert.ok(first.nextOffset > 0);

    const second = await database.sampleColdCandidateDatabase({
      limit: 3,
      offset: first.nextOffset,
    });
    assert.deepEqual(
      second.candidates.map((candidate) => candidate.userId),
      [4, 5, 6],
    );

    const stats = await database.getColdCandidateDatabaseStats();
    assert.ok(stats.sizeBytes > 0);
  } finally {
    if (previousVolume === undefined) {
      delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    } else {
      process.env.RAILWAY_VOLUME_MOUNT_PATH = previousVolume;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
