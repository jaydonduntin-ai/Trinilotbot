import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const railwayVolumePath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;

const storagePath =
  process.env.ROBLOX_CANDIDATE_DATABASE_PATH?.trim() ||
  (railwayVolumePath
    ? join(railwayVolumePath, "candidate-database.json")
    : fileURLToPath(
        new URL("../../data/candidate-database.json", import.meta.url),
      ));

const coldStoragePath =
  process.env.ROBLOX_CANDIDATE_COLD_DATABASE_PATH?.trim() ||
  (railwayVolumePath
    ? join(railwayVolumePath, "candidate-cold.ndjson")
    : fileURLToPath(
        new URL("../../data/candidate-cold.ndjson", import.meta.url),
      ));

const COLD_COMPACTION_BYTES = 96 * 1024 * 1024;
const COLD_COMPACTION_MIN_LINES = 200_000;
let writeQueue = Promise.resolve();
let coldWriteQueue = Promise.resolve();

export async function loadCandidateDatabase() {
  try {
    const contents = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(contents);
    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates
        : [];

    return {
      candidates,
      storagePath,
      persistentVolumeDetected: Boolean(railwayVolumePath),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      candidates: [],
      storagePath,
      persistentVolumeDetected: Boolean(railwayVolumePath),
    };
  }
}

export async function saveCandidateDatabase(candidates) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: Array.isArray(candidates) ? candidates : [],
  };
  const serialized = `${JSON.stringify(payload)}\n`;
  const tempPath = `${storagePath}.tmp`;

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(tempPath, serialized, "utf8");
      await rename(tempPath, storagePath);
    });

  await writeQueue;
  return {
    count: payload.candidates.length,
    storagePath,
    persistentVolumeDetected: Boolean(railwayVolumePath),
  };
}


function normalizeColdCandidate(raw) {
  const userId = Number(raw?.userId ?? raw?.id);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  return {
    userId,
    firstSeenAt: Number(raw?.firstSeenAt) || 0,
    lastSeenAt: Number(raw?.lastSeenAt) || Date.now(),
    lastKnownRap:
      Number.isFinite(Number(raw?.lastKnownRap))
        ? Number(raw.lastKnownRap)
        : null,
    lastKnownRapAt: Number(raw?.lastKnownRapAt) || 0,
    lastKnownValue:
      Number.isFinite(Number(raw?.lastKnownValue))
        ? Number(raw.lastKnownValue)
        : null,
    lastKnownValueAt: Number(raw?.lastKnownValueAt) || 0,
    sources: Array.isArray(raw?.sources)
      ? [...new Set(raw.sources.filter(Boolean).map(String))].slice(0, 12)
      : [],
  };
}

export async function appendColdCandidates(candidates) {
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map(normalizeColdCandidate)
    .filter(Boolean);
  if (normalized.length === 0) {
    return {
      count: 0,
      storagePath: coldStoragePath,
      persistentVolumeDetected: Boolean(railwayVolumePath),
    };
  }

  const serialized = normalized
    .map((candidate) => JSON.stringify(candidate))
    .join("\n") + "\n";

  coldWriteQueue = coldWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(coldStoragePath), { recursive: true });
      await appendFile(coldStoragePath, serialized, "utf8");
    });

  await coldWriteQueue;
  return {
    count: normalized.length,
    storagePath: coldStoragePath,
    persistentVolumeDetected: Boolean(railwayVolumePath),
  };
}

export async function sampleColdCandidateDatabase({
  limit = 5_000,
  offset = 0,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(100_000, Number(limit) || 5_000));
  const boundedOffset = Math.max(0, Number(offset) || 0);

  let handle;
  try {
    handle = await open(coldStoragePath, "r");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        candidates: [],
        nextOffset: 0,
        eof: true,
        storagePath: coldStoragePath,
      };
    }
    throw error;
  }

  const stream = handle.createReadStream({
    encoding: "utf8",
    start: boundedOffset,
  });
  const candidates = [];
  let consumedBytes = 0;
  let buffered = "";

  try {
    for await (const chunk of stream) {
      consumedBytes += Buffer.byteLength(chunk);
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const candidate = normalizeColdCandidate(JSON.parse(line));
          if (candidate) candidates.push(candidate);
        } catch {
          // Ignore malformed historical lines rather than blocking scans.
        }

        if (candidates.length >= boundedLimit) {
          stream.destroy();
          break;
        }
      }

      if (candidates.length >= boundedLimit) break;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }

  return {
    candidates,
    nextOffset: boundedOffset + consumedBytes,
    eof: candidates.length < boundedLimit,
    storagePath: coldStoragePath,
  };
}

export async function getColdCandidateDatabaseStats() {
  try {
    const details = await stat(coldStoragePath);
    return {
      storagePath: coldStoragePath,
      sizeBytes: details.size,
      persistentVolumeDetected: Boolean(railwayVolumePath),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        storagePath: coldStoragePath,
        sizeBytes: 0,
        persistentVolumeDetected: Boolean(railwayVolumePath),
      };
    }
    throw error;
  }
}

export async function compactColdCandidateDatabase({
  maxEntries = 1_000_000,
} = {}) {
  const details = await getColdCandidateDatabaseStats();
  if (details.sizeBytes < COLD_COMPACTION_BYTES) {
    return { compacted: false, ...details };
  }

  let contents;
  try {
    contents = await readFile(coldStoragePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { compacted: false, ...details };
    }
    throw error;
  }

  const lines = contents.split("\n").filter(Boolean);
  if (lines.length < COLD_COMPACTION_MIN_LINES) {
    return { compacted: false, lineCount: lines.length, ...details };
  }

  const deduped = new Map();
  for (const line of lines) {
    try {
      const candidate = normalizeColdCandidate(JSON.parse(line));
      if (!candidate) continue;
      const existing = deduped.get(candidate.userId);
      if (
        !existing ||
        Number(candidate.lastSeenAt || 0) > Number(existing.lastSeenAt || 0)
      ) {
        deduped.set(candidate.userId, candidate);
      }
    } catch {
      // Skip malformed historical lines during compaction.
    }
  }

  const selected = [...deduped.values()]
    .sort(
      (left, right) =>
        Number(right.lastSeenAt || 0) - Number(left.lastSeenAt || 0),
    )
    .slice(0, Math.max(1, Number(maxEntries) || 1_000_000));

  const tempPath = `${coldStoragePath}.compact.tmp`;
  const serialized =
    selected.map((candidate) => JSON.stringify(candidate)).join("\n") + "\n";
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, coldStoragePath);
  await unlink(tempPath).catch(() => undefined);

  return {
    compacted: true,
    count: selected.length,
    storagePath: coldStoragePath,
    sizeBytes: Buffer.byteLength(serialized),
    persistentVolumeDetected: Boolean(railwayVolumePath),
  };
}
