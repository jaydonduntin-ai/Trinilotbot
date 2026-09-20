import { EmbedBuilder } from "discord.js";
import { getPresenceBatched } from "./target-scanner.js";
import { getFollowUserJoinUrl } from "../roblox/game-session.js";
import {
  getScanWatchlist,
  updateScanPresences,
} from "../storage/scan-watchlist.js";

const DEFAULT_SCAN_WATCH_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_SCAN_WATCH_USERS_PER_CYCLE = 50;
const PRESENCE_BATCH_SIZE = 50;
let scanWatcherRunning = false;
let scanWatcherCursor = 0;

export async function startScanWatcher(client) {
  const intervalMs = readPositiveInteger(
    process.env.ROBLOX_SCAN_WATCH_INTERVAL_MS,
    DEFAULT_SCAN_WATCH_INTERVAL_MS,
  );

  const run = async () => {
    if (scanWatcherRunning) return;
    scanWatcherRunning = true;

    try {
      await checkScanWatchlist(client);
    } catch (error) {
      console.error("Scan watcher run failed:", error);
    } finally {
      scanWatcherRunning = false;
    }
  };

  const initialTimer = setTimeout(run, 75_000);
  initialTimer.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
}

async function checkScanWatchlist(client) {
  const entries = await getScanWatchlist();
  if (entries.length === 0) return;

  const usersPerCycle = Math.max(
    1,
    Math.min(
      entries.length,
      readPositiveInteger(
        process.env.ROBLOX_SCAN_WATCH_USERS_PER_CYCLE,
        DEFAULT_SCAN_WATCH_USERS_PER_CYCLE,
      ),
    ),
  );
  const start = scanWatcherCursor % entries.length;
  const selectedEntries = [];

  for (let offset = 0; offset < usersPerCycle; offset += 1) {
    selectedEntries.push(
      entries[(start + offset) % entries.length],
    );
  }
  scanWatcherCursor =
    (start + selectedEntries.length) % entries.length;

  const ids = selectedEntries.map((entry) => entry.userId);
  const presenceScan = await getPresenceBatched(ids, {
    batchSize: PRESENCE_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 1_000,
    stopOnRateLimit: true,
    priority: "background",
  });
  const presences = presenceScan.presences;

  const presenceById = new Map(
    presences.map((presence) => [Number(presence.userId), presence]),
  );

  const updates = [];

  for (const entry of selectedEntries) {
    const presence = presenceById.get(Number(entry.userId));
    if (!presence) continue;

    const currentType = Number(presence.userPresenceType);
    const previousType =
      entry.lastPresenceType === null || entry.lastPresenceType === undefined
        ? null
        : Number(entry.lastPresenceType);

    const enteredGame =
      previousType !== null &&
      previousType !== 2 &&
      currentType === 2;

    if (enteredGame) {
      await publishScanAlert(client, entry, presence).catch((error) => {
        console.warn(
          `Could not publish scan alert for Roblox user ${entry.userId}:`,
          error,
        );
      });
    }

    updates.push({
      userId: entry.userId,
      presenceType: currentType,
      alerted: enteredGame,
    });
  }

  await updateScanPresences(updates);
}

async function publishScanAlert(client, entry, presence) {
  const profileUrl =
    `https://www.roblox.com/users/${entry.userId}/profile`;
  const followJoinUrl = getFollowUserJoinUrl(entry.userId);
  const name =
    entry.displayName && entry.username
      ? `${entry.displayName} (@${entry.username})`
      : entry.username
        ? `@${entry.username}`
        : `Roblox user ${entry.userId}`;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`${name} is now in game`)
    .setURL(profileUrl)
    .addFields(
      {
        name: "RAP",
        value:
          typeof entry.rapValue === "number"
            ? `${entry.rapValue.toLocaleString()} RAP`
            : "Unavailable",
        inline: true,
      },
      {
        name: "Current game",
        value: presence?.lastLocation ?? "In game",
        inline: true,
      },
      {
        name: "Profile",
        value: `[Open Roblox profile](${profileUrl})`,
        inline: false,
      },
      {
        name: "Direct join",
        value: followJoinUrl
          ? `[Join player](${followJoinUrl})`
          : "Unavailable",
        inline: false,
      },
    )
    .setFooter({
      text: "Triggered by /scan watchlist · public Roblox presence",
    })
    .setTimestamp();

  for (const channelId of entry.channels ?? []) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || typeof channel.send !== "function") continue;
    await channel.send({ embeds: [embed] });
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
