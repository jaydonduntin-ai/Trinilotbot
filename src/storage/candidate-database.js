import {
  mkdir,
  readFile,
  rename,
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

let writeQueue = Promise.resolve();

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
