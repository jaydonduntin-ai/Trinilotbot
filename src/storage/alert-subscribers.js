import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const railwayVolumePath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;

const storagePath =
  process.env.ROBLOX_ALERT_SUBSCRIBERS_PATH?.trim() ||
  (railwayVolumePath
    ? join(railwayVolumePath, "alert-subscribers.json")
    : fileURLToPath(
        new URL("../../data/alert-subscribers.json", import.meta.url),
      ));

let subscribers = new Set();
let initialized = false;
let writeQueue = Promise.resolve();

export async function initializeAlertSubscriptions() {
  if (initialized) {
    return;
  }

  try {
    const contents = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(contents);
    subscribers = new Set(
      Array.isArray(parsed)
        ? parsed.filter((value) => typeof value === "string")
        : [],
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  initialized = true;
}

export async function getAlertSubscription(discordUserId) {
  await initializeAlertSubscriptions();
  return subscribers.has(discordUserId);
}

export async function getAlertSubscribers() {
  await initializeAlertSubscriptions();
  return [...subscribers];
}

export async function setAlertSubscription(discordUserId, enabled) {
  await initializeAlertSubscriptions();

  if (enabled) {
    subscribers.add(discordUserId);
  } else {
    subscribers.delete(discordUserId);
  }

  const serialized = `${JSON.stringify([...subscribers].sort(), null, 2)}\n`;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, serialized, "utf8");
    });
  await writeQueue;
}