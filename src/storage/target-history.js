import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const railwayVolumePath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;

const storagePath =
  process.env.ROBLOX_TARGET_HISTORY_PATH?.trim() ||
  (railwayVolumePath
    ? join(railwayVolumePath, "target-history.json")
    : fileURLToPath(
        new URL("../../data/target-history.json", import.meta.url),
      ));

const MAX_IDS_PER_BUCKET = 25_000;
const MAX_ATTEMPT_BUCKETS = 24;

let state = {
  surfacedTargets: new Set(),
  scanReserved: new Set(),
  scanAttempts: new Map(),
};
let initialized = false;
let writeQueue = Promise.resolve();

export async function initializeTargetHistory() {
  if (initialized) return;

  try {
    const contents = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(contents);

    state.surfacedTargets = new Set(
      normalizeIds(parsed?.surfacedTargets),
    );
    state.scanReserved = new Set(
      normalizeIds(parsed?.scanReserved),
    );

    state.scanAttempts = new Map();
    for (const [key, ids] of Object.entries(parsed?.scanAttempts ?? {})) {
      state.scanAttempts.set(String(key), new Set(normalizeIds(ids)));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  initialized = true;
}

export async function getTargetHistory() {
  await initializeTargetHistory();

  return {
    surfacedTargets: new Set(state.surfacedTargets),
    scanReserved: new Set(state.scanReserved),
    scanAttempts: new Map(
      [...state.scanAttempts.entries()].map(([key, ids]) => [
        key,
        new Set(ids),
      ]),
    ),
    storagePath,
    persistentVolumeDetected: Boolean(railwayVolumePath),
  };
}

export async function addSurfacedTargetIds(ids) {
  await initializeTargetHistory();
  addIds(state.surfacedTargets, ids);
  trimSet(state.surfacedTargets);
  await persist();
}

export async function addScanReservedIds(ids) {
  await initializeTargetHistory();
  addIds(state.scanReserved, ids);
  trimSet(state.scanReserved);
  await persist();
}

export async function addScanAttemptIds(key, ids) {
  await initializeTargetHistory();

  const normalizedKey = String(key);
  const bucket = state.scanAttempts.get(normalizedKey) ?? new Set();
  addIds(bucket, ids);
  trimSet(bucket);
  state.scanAttempts.set(normalizedKey, bucket);

  while (state.scanAttempts.size > MAX_ATTEMPT_BUCKETS) {
    const oldestKey = state.scanAttempts.keys().next().value;
    state.scanAttempts.delete(oldestKey);
  }

  await persist();
}

export function getTargetHistoryStoragePath() {
  return storagePath;
}

function addIds(target, ids) {
  for (const rawId of ids ?? []) {
    const id = Number(rawId);
    if (Number.isInteger(id) && id > 0) target.add(id);
  }
}

function normalizeIds(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

function trimSet(set) {
  while (set.size > MAX_IDS_PER_BUCKET) {
    set.delete(set.values().next().value);
  }
}

async function persist() {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    surfacedTargets: [...state.surfacedTargets],
    scanReserved: [...state.scanReserved],
    scanAttempts: Object.fromEntries(
      [...state.scanAttempts.entries()].map(([key, ids]) => [
        key,
        [...ids],
      ]),
    ),
  };

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, serialized, "utf8");
    });

  await writeQueue;
}
