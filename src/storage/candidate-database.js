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

const COLD_APPEND_BATCH_SIZE = 5_000;
const COLD_SAMPLE_CHUNK_BYTES = 64 * 1024;
const COLD_IO_CHUNK_BYTES = 1024 * 1024;
const COLD_BYTES_PER_ENTRY_BUDGET = 320;
const COLD_MIN_CAP_BYTES = 64 * 1024 * 1024;
const COLD_MAX_CAP_BYTES = 320 * 1024 * 1024;
const COLD_COMPACTION_TARGET_RATIO = 0.8;
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
  const deduped = new Map();
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const candidate = normalizeColdCandidate(raw);
    if (!candidate) continue;
    const existing = deduped.get(candidate.userId);
    if (
      !existing ||
      Number(candidate.lastSeenAt || 0) >= Number(existing.lastSeenAt || 0)
    ) {
      deduped.set(candidate.userId, candidate);
    }
  }

  const normalized = [...deduped.values()];
  if (normalized.length === 0) {
    return {
      count: 0,
      storagePath: coldStoragePath,
      persistentVolumeDetected: Boolean(railwayVolumePath),
    };
  }

  coldWriteQueue = coldWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(coldStoragePath), { recursive: true });
      for (
        let index = 0;
        index < normalized.length;
        index += COLD_APPEND_BATCH_SIZE
      ) {
        const batch = normalized.slice(index, index + COLD_APPEND_BATCH_SIZE);
        const serialized =
          batch.map((candidate) => JSON.stringify(candidate)).join("\n") +
          "\n";
        await appendFile(coldStoragePath, serialized, "utf8");
      }
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

  await coldWriteQueue.catch(() => undefined);

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

  const candidates = [];
  let fileSize = 0;
  let position = boundedOffset;
  let nextOffset = boundedOffset;
  let pending = Buffer.alloc(0);
  let pendingStart = boundedOffset;

  const parseLine = (lineBuffer) => {
    const text = lineBuffer.toString("utf8").trim();
    if (!text) return;
    try {
      const candidate = normalizeColdCandidate(JSON.parse(text));
      if (candidate) candidates.push(candidate);
    } catch {
      // Ignore malformed historical lines rather than blocking rotation.
    }
  };

  try {
    fileSize = (await handle.stat()).size;
    if (boundedOffset >= fileSize) {
      return {
        candidates: [],
        nextOffset: 0,
        eof: true,
        storagePath: coldStoragePath,
      };
    }

    while (position < fileSize && candidates.length < boundedLimit) {
      const readSize = Math.min(
        COLD_SAMPLE_CHUNK_BYTES,
        fileSize - position,
      );
      const chunk = Buffer.allocUnsafe(readSize);
      const chunkStart = position;
      const { bytesRead } = await handle.read(
        chunk,
        0,
        readSize,
        position,
      );
      if (bytesRead <= 0) break;
      position += bytesRead;

      const combinedStart =
        pending.length > 0 ? pendingStart : chunkStart;
      const combined =
        pending.length > 0
          ? Buffer.concat([pending, chunk.subarray(0, bytesRead)])
          : chunk.subarray(0, bytesRead);

      let lineStart = 0;
      while (candidates.length < boundedLimit) {
        const newline = combined.indexOf(0x0a, lineStart);
        if (newline < 0) break;

        parseLine(combined.subarray(lineStart, newline));
        nextOffset = combinedStart + newline + 1;
        lineStart = newline + 1;
      }

      pending = combined.subarray(lineStart);
      pendingStart = combinedStart + lineStart;
    }

    if (
      candidates.length < boundedLimit &&
      position >= fileSize &&
      pending.length > 0
    ) {
      parseLine(pending);
      nextOffset = fileSize;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }

  const eof =
    nextOffset >= fileSize ||
    (position >= fileSize && candidates.length < boundedLimit);

  return {
    candidates,
    nextOffset: eof ? 0 : nextOffset,
    eof,
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
  const requestedEntries = Math.max(
    1,
    Number(maxEntries) || 1_000_000,
  );
  const maxBytes = Math.min(
    COLD_MAX_CAP_BYTES,
    Math.max(
      COLD_MIN_CAP_BYTES,
      requestedEntries * COLD_BYTES_PER_ENTRY_BUDGET,
    ),
  );
  const targetBytes = Math.floor(
    maxBytes * COLD_COMPACTION_TARGET_RATIO,
  );

  let result = null;
  coldWriteQueue = coldWriteQueue
    .catch(() => undefined)
    .then(async () => {
      let details;
      try {
        details = await stat(coldStoragePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          result = {
            compacted: false,
            storagePath: coldStoragePath,
            sizeBytes: 0,
            persistentVolumeDetected: Boolean(railwayVolumePath),
          };
          return;
        }
        throw error;
      }

      if (details.size <= maxBytes) {
        result = {
          compacted: false,
          storagePath: coldStoragePath,
          sizeBytes: details.size,
          persistentVolumeDetected: Boolean(railwayVolumePath),
        };
        return;
      }

      const tempPath = `${coldStoragePath}.compact.tmp`;
      let source;
      let target;
      try {
        source = await open(coldStoragePath, "r");
        target = await open(tempPath, "w");

        let start = Math.max(0, details.size - targetBytes);
        if (start > 0) {
          start = await findNextLineBoundary(
            source,
            start,
            details.size,
          );
        }

        let position = start;
        const buffer = Buffer.allocUnsafe(COLD_IO_CHUNK_BYTES);
        while (position < details.size) {
          const toRead = Math.min(
            buffer.length,
            details.size - position,
          );
          const { bytesRead } = await source.read(
            buffer,
            0,
            toRead,
            position,
          );
          if (bytesRead <= 0) break;
          await target.write(buffer, 0, bytesRead);
          position += bytesRead;
        }

        await target.sync();
        await target.close();
        target = null;
        await source.close();
        source = null;
        await rename(tempPath, coldStoragePath);

        result = {
          compacted: true,
          storagePath: coldStoragePath,
          sizeBytes: Math.max(0, details.size - start),
          persistentVolumeDetected: Boolean(railwayVolumePath),
        };
      } finally {
        await target?.close().catch(() => undefined);
        await source?.close().catch(() => undefined);
        await unlink(tempPath).catch(() => undefined);
      }
    });

  await coldWriteQueue;
  return result;
}

async function findNextLineBoundary(handle, start, fileSize) {
  let position = start;
  const buffer = Buffer.allocUnsafe(COLD_SAMPLE_CHUNK_BYTES);

  while (position < fileSize) {
    const toRead = Math.min(buffer.length, fileSize - position);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      toRead,
      position,
    );
    if (bytesRead <= 0) return fileSize;

    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (newline >= 0) {
      return position + newline + 1;
    }
    position += bytesRead;
  }

  return fileSize;
}

