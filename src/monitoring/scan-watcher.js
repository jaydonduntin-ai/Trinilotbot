import { EmbedBuilder } from "discord.js";
import { getPresenceBatched, getFreshLiveTargetPresences } from "./target-scanner.js";
import { getFollowUserJoinUrl } from "../roblox/game-session.js";
import {
  getScanWatchlist,
  updateScanPresences,
} from "../storage/scan-watchlist.js";

const DEFAULT_SCAN_WATCH_INTERVAL_MS = 60 * 1000;
const DEFAULT_SCAN_WATCH_USERS_PER_CYCLE = 200;
const PRESENCE_BATCH_SIZE = 50;
const DEFAULT_AUTO_TARGET_FEED_INTERVAL_MS = 60 * 1000;
const DEFAULT_AUTO_TARGET_FEED_LIMIT = 25;
const DEFAULT_AUTO_TARGET_MIN_RAP = 2_000;
const autoFeedSeenAt = new Map();
let autoFeedRunning = false;
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

  const initialTimer = setTimeout(run, 20_000);
  initialTimer.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();

  startAutomaticTargetFeed(client);
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

async function publishScanAlert(client, entry, presence, { footer = "Triggered by /scan watchlist · public Roblox presence" } = {}) {
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
      text: footer,
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


function startAutomaticTargetFeed(client) {
  const intervalMs = readPositiveInteger(
    process.env.ROBLOX_AUTO_TARGET_FEED_INTERVAL_MS,
    DEFAULT_AUTO_TARGET_FEED_INTERVAL_MS,
  );
  const limit = readPositiveInteger(
    process.env.ROBLOX_AUTO_TARGET_FEED_LIMIT,
    DEFAULT_AUTO_TARGET_FEED_LIMIT,
  );
  const minimumRap = readPositiveInteger(
    process.env.ROBLOX_AUTO_TARGET_MIN_RAP,
    DEFAULT_AUTO_TARGET_MIN_RAP,
  );

  const run = async () => {
    if (autoFeedRunning) return;
    autoFeedRunning = true;
    try {
      const channelIds = await getAutomaticTargetChannelIds();
      if (channelIds.length === 0) return;

      const presences = getFreshLiveTargetPresences({
        minimumRap,
        limit,
      });
      const now = Date.now();
      const dedupeMs = 6 * 60 * 60 * 1000;

      for (const presence of presences) {
        const userId = Number(presence?.userId);
        if (!Number.isInteger(userId) || userId <= 0) continue;
        const lastSentAt = Number(autoFeedSeenAt.get(userId) || 0);
        if (now - lastSentAt < dedupeMs) continue;

        const entry = {
          userId,
          username: null,
          displayName: null,
          rapValue: null,
          channels: channelIds,
        };
        await publishScanAlert(client, entry, presence, {
          footer: `Automatic discovery feed · verified ${minimumRap.toLocaleString()}+ RAP candidate`,
        }).catch((error) => {
          console.warn(`Automatic target feed publish failed for Roblox user ${userId}:`, error);
        });
        autoFeedSeenAt.set(userId, now);
      }

      for (const [userId, sentAt] of autoFeedSeenAt) {
        if (now - sentAt > dedupeMs) autoFeedSeenAt.delete(userId);
      }
    } finally {
      autoFeedRunning = false;
    }
  };

  const initialTimer = setTimeout(run, 45_000);
  initialTimer.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
}

async function getAutomaticTargetChannelIds() {
  const configured = String(process.env.ROBLOX_AUTO_TARGET_CHANNEL_ID ?? "").trim();
  if (/^\d+$/.test(configured)) return [configured];

  const entries = await getScanWatchlist();
  const counts = new Map();
  for (const entry of entries) {
    for (const rawChannelId of entry.channels ?? []) {
      const channelId = String(rawChannelId ?? "").trim();
      if (!/^\d+$/.test(channelId)) continue;
      counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([channelId]) => channelId);
}
