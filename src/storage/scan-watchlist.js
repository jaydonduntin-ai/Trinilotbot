import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const railwayVolumePath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;

const storagePath =
  process.env.ROBLOX_SCAN_WATCHLIST_PATH?.trim() ||
  (railwayVolumePath
    ? join(railwayVolumePath, "scan-watchlist.json")
    : fileURLToPath(
        new URL("../../data/scan-watchlist.json", import.meta.url),
      ));

let entries = new Map();
let initialized = false;
let writeQueue = Promise.resolve();

export async function initializeScanWatchlist() {
  if (initialized) return;

  try {
    const contents = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(contents);
    for (const item of Array.isArray(parsed) ? parsed : []) {
      const userId = Number(item?.userId);
      if (!Number.isInteger(userId) || userId <= 0) continue;
      entries.set(userId, {
        userId,
        username: item.username ?? null,
        displayName: item.displayName ?? null,
        rapValue: typeof item.rapValue === "number" ? item.rapValue : null,
        totalValue: typeof item.totalValue === "number" ? item.totalValue : null,
        sources: Array.isArray(item.sources) ? item.sources : [],
        channels: Array.isArray(item.channels) ? item.channels : [],
        addedAt: item.addedAt ?? new Date().toISOString(),
        rapVerifiedAt:
          item.rapVerifiedAt ?? item.addedAt ?? new Date().toISOString(),
        lastPresenceType:
          Number.isInteger(Number(item.lastPresenceType))
            ? Number(item.lastPresenceType)
            : null,
        lastAlertedAt: item.lastAlertedAt ?? null,
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  initialized = true;
}

export async function addScanPlayers(players, channelId) {
  await initializeScanWatchlist();
  let added = 0;
  let existing = 0;

  for (const player of players) {
    const userId = Number(player?.id ?? player?.userId);
    if (!Number.isInteger(userId) || userId <= 0) continue;

    const current = entries.get(userId);
    const channels = new Set(current?.channels ?? []);
    if (channelId) channels.add(String(channelId));

    entries.set(userId, {
      userId,
      username: player.username ?? current?.username ?? null,
      displayName: player.displayName ?? current?.displayName ?? null,
      rapValue:
        typeof player.rapValue === "number"
          ? player.rapValue
          : current?.rapValue ?? null,
      totalValue:
        typeof player.totalValue === "number"
          ? player.totalValue
          : current?.totalValue ?? null,
      sources: [
        ...new Set([
          ...(current?.sources ?? []),
          player.rapSource,
          player.valueSource,
        ].filter(Boolean)),
      ],
      channels: [...channels],
      addedAt: current?.addedAt ?? new Date().toISOString(),
      rapVerifiedAt:
        typeof player.rapValue === "number"
          ? new Date().toISOString()
          : current?.rapVerifiedAt ?? current?.addedAt ?? new Date().toISOString(),
      lastPresenceType: current?.lastPresenceType ?? null,
      lastAlertedAt: current?.lastAlertedAt ?? null,
    });

    if (current) existing += 1;
    else added += 1;
  }

  await persist();
  return { added, existing, total: entries.size };
}

export async function getScanWatchlist() {
  await initializeScanWatchlist();
  return [...entries.values()];
}

export async function updateScanPresence(userId, presenceType, { alerted = false } = {}) {
  await initializeScanWatchlist();
  const entry = entries.get(Number(userId));
  if (!entry) return;

  entry.lastPresenceType = Number(presenceType);
  if (alerted) entry.lastAlertedAt = new Date().toISOString();
  await persist();
}

async function persist() {
  const serialized = `${JSON.stringify(
    [...entries.values()].sort((a, b) => a.userId - b.userId),
    null,
    2,
  )}\n`;

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, serialized, "utf8");
    });

  await writeQueue;
}
