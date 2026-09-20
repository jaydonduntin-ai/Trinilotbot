import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const railwayVolumePath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;

const storagePath =
  process.env.ROBLOX_MM2_VALUE_WATCHLIST_PATH?.trim() ||
  (railwayVolumePath
    ? join(railwayVolumePath, "mm2-value-watchlist.json")
    : fileURLToPath(
        new URL("../../data/mm2-value-watchlist.json", import.meta.url),
      ));

let entries = new Map();
let channels = new Set();
let initialized = false;
let writeQueue = Promise.resolve();

export async function initializeMm2ValueWatchlist() {
  if (initialized) return;

  try {
    const contents = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(contents);

    const rawEntries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];
    const rawChannels = Array.isArray(parsed?.channels)
      ? parsed.channels
      : [];

    for (const channelId of rawChannels) {
      if (channelId) channels.add(String(channelId));
    }

    for (const item of rawEntries) {
      const userId = Number(item?.userId);
      if (!Number.isInteger(userId) || userId <= 0) continue;

      entries.set(userId, {
        userId,
        username: item.username ?? null,
        displayName: item.displayName ?? null,
        mm2Value:
          typeof item.mm2Value === "number" ? item.mm2Value : null,
        mm2ItemCount:
          typeof item.mm2ItemCount === "number"
            ? item.mm2ItemCount
            : null,
        mm2ValueSource:
          item.mm2ValueSource ?? "RBLXValue API v2 profile",
        addedAt: item.addedAt ?? new Date().toISOString(),
        valueVerifiedAt:
          item.valueVerifiedAt ??
          item.addedAt ??
          new Date().toISOString(),
        lastPresenceType:
          Number.isInteger(Number(item.lastPresenceType))
            ? Number(item.lastPresenceType)
            : null,
        lastUniverseId:
          Number.isFinite(Number(item.lastUniverseId))
            ? Number(item.lastUniverseId)
            : null,
        lastInMm2:
          typeof item.lastInMm2 === "boolean"
            ? item.lastInMm2
            : null,
        lastAlertedAt: item.lastAlertedAt ?? null,
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  initialized = true;
}

export async function subscribeMm2ValueChannel(channelId) {
  await initializeMm2ValueWatchlist();
  if (!channelId) return false;

  const normalized = String(channelId);
  const before = channels.size;
  channels.add(normalized);
  if (channels.size !== before) await persist();
  return true;
}

export async function getMm2ValueWatchChannels() {
  await initializeMm2ValueWatchlist();
  return [...channels];
}

export async function addMm2ValuePlayers(players) {
  await initializeMm2ValueWatchlist();
  let added = 0;
  let updated = 0;

  for (const player of players ?? []) {
    const userId = Number(player?.id ?? player?.userId);
    if (!Number.isInteger(userId) || userId <= 0) continue;

    const mm2Value = Number(player?.mm2Value);
    if (!Number.isFinite(mm2Value)) continue;

    const current = entries.get(userId);
    entries.set(userId, {
      userId,
      username: player.username ?? current?.username ?? null,
      displayName: player.displayName ?? current?.displayName ?? null,
      mm2Value,
      mm2ItemCount:
        Number.isFinite(Number(player?.mm2ItemCount))
          ? Number(player.mm2ItemCount)
          : current?.mm2ItemCount ?? null,
      mm2ValueSource:
        player.mm2ValueSource ??
        current?.mm2ValueSource ??
        "RBLXValue API v2 profile",
      addedAt: current?.addedAt ?? new Date().toISOString(),
      valueVerifiedAt: new Date().toISOString(),
      lastPresenceType: current?.lastPresenceType ?? null,
      lastUniverseId: current?.lastUniverseId ?? null,
      lastInMm2: current?.lastInMm2 ?? null,
      lastAlertedAt: current?.lastAlertedAt ?? null,
    });

    if (current) updated += 1;
    else added += 1;
  }

  if (added > 0 || updated > 0) await persist();
  return { added, updated, total: entries.size };
}

export async function getMm2ValueWatchlist() {
  await initializeMm2ValueWatchlist();
  return [...entries.values()];
}

export async function updateMm2ValuePresence(
  userId,
  presence,
  { inMm2 = false, alerted = false } = {},
) {
  await initializeMm2ValueWatchlist();
  const entry = entries.get(Number(userId));
  if (!entry) return;

  entry.lastPresenceType =
    Number.isInteger(Number(presence?.userPresenceType))
      ? Number(presence.userPresenceType)
      : entry.lastPresenceType;
  entry.lastUniverseId =
    Number.isFinite(Number(presence?.universeId))
      ? Number(presence.universeId)
      : null;
  entry.lastInMm2 = Boolean(inMm2);
  if (alerted) entry.lastAlertedAt = new Date().toISOString();

  await persist();
}

async function persist() {
  const payload = {
    channels: [...channels],
    entries: [...entries.values()].sort((a, b) => a.userId - b.userId),
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
