import { EmbedBuilder } from "discord.js";
import {
  getPresenceBatched,
  scanDiscoveredTargets,
} from "./target-scanner.js";
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
const AUTO_FEED_DEDUPE_MS = 6 * 60 * 60 * 1000;
const autoFeedSeenAt = new Map();
let autoFeedRunning = false;
let scanWatcherRunning = false;
let scanWatcherCursor = 0;
let lastAutoFeedChannelKey = null;

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

async function publishScanAlert(
  client,
  entry,
  presence,
  { footer = "Triggered by /scan watchlist · public Roblox presence" } = {},
) {
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
    .setFooter({ text: footer })
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

  const run = async () => {
    if (autoFeedRunning) return;
    autoFeedRunning = true;

    try {
      const channelIds = await getAutomaticTargetChannelIds();
      if (channelIds.length === 0) {
        console.warn(
          "Automatic target feed has no destination channel yet; set ROBLOX_AUTO_TARGET_CHANNEL_ID or seed scan history in the desired channel.",
        );
        return;
      }

      const channelKey = channelIds.join(",");
      if (channelKey !== lastAutoFeedChannelKey) {
        console.info(`Automatic target feed channel(s): ${channelKey}`);
        lastAutoFeedChannelKey = channelKey;
      }

      // Run the discovery pipeline directly. This is intentionally not a read
      // from /target's live cache: the feed must keep discovering while nobody
      // is manually invoking a command. null means RAP is informational only.
      const result = await scanDiscoveredTargets({
        minimumValue: null,
        minimumRap: null,
        limit,
      });
      const now = Date.now();
      let sentCount = 0;

      for (const player of result.players ?? []) {
        const userId = Number(player?.id ?? player?.userId);
        if (!Number.isInteger(userId) || userId <= 0) continue;

        const lastSentAt = Number(autoFeedSeenAt.get(userId) || 0);
        if (now - lastSentAt < AUTO_FEED_DEDUPE_MS) continue;

        const sent = await publishAutomaticTargetCard(
          client,
          channelIds,
          player,
        ).catch((error) => {
          console.warn(
            `Automatic target feed publish failed for Roblox user ${userId}:`,
            error,
          );
          return false;
        });

        if (sent) {
          autoFeedSeenAt.set(userId, now);
          sentCount += 1;
        }
      }

      for (const [userId, sentAt] of autoFeedSeenAt) {
        if (now - sentAt > AUTO_FEED_DEDUPE_MS) {
          autoFeedSeenAt.delete(userId);
        }
      }

      console.info(
        `Automatic target feed: ${result.activeCount ?? 0} in-game seen · ${result.verifiedCount ?? 0} verified · ${result.players?.length ?? 0} public-joinable · ${sentCount} sent · no RAP minimum.`,
      );
    } catch (error) {
      console.error("Automatic target feed scan failed:", error);
    } finally {
      autoFeedRunning = false;
    }
  };

  const initialTimer = setTimeout(run, 45_000);
  initialTimer.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
}

async function publishAutomaticTargetCard(client, channelIds, player) {
  const userId = Number(player?.id ?? player?.userId);
  const profileUrl =
    player?.profileUrl ??
    (Number.isInteger(userId) && userId > 0
      ? `https://www.roblox.com/users/${userId}/profile`
      : null);
  const title =
    player?.displayName && player?.username
      ? `${player.displayName} (@${player.username})`
      : player?.username
        ? `@${player.username}`
        : `Roblox user ${userId}`;
  const rap =
    typeof player?.rapValue === "number"
      ? `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`
      : "Unavailable";
  const value =
    typeof player?.totalValue === "number"
      ? player.totalValue.toLocaleString()
      : "Unavailable";
  const joinUrl = player?.verifiedJoinUrl ?? null;
  const rolimonsUrl = player?.rolimonsUrl ?? null;

  const links = [];
  if (joinUrl) links.push(`[Verify & join current server](<${joinUrl}>)`);
  if (profileUrl) links.push(`[Roblox profile](<${profileUrl}>)`);
  if (rolimonsUrl) links.push(`[Rolimon's](<${rolimonsUrl}>)`);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(links.join(" · ") || "Verified in game")
    .addFields(
      { name: "RAP", value: rap, inline: true },
      { name: "Value", value, inline: true },
      {
        name: "Current game",
        value: player?.gameName ?? player?.presenceStatus ?? "In game",
        inline: true,
      },
      {
        name: "Join status",
        value: joinUrl
          ? "Public server verified; server is rechecked when Join is opened."
          : "Join unavailable",
        inline: false,
      },
      {
        name: "Source",
        value: truncate(
          player?.rapSource ?? player?.valueSource ?? "Public Roblox discovery",
          180,
        ),
        inline: false,
      },
    )
    .setFooter({
      text: "Automatic target feed · all Roblox games · no RAP minimum",
    })
    .setTimestamp();

  if (profileUrl) embed.setURL(profileUrl);
  if (player?.avatarUrl) embed.setThumbnail(player.avatarUrl);

  let sent = false;
  for (const channelId of channelIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || typeof channel.send !== "function") {
      continue;
    }
    await channel.send({ embeds: [embed] });
    sent = true;
  }
  return sent;
}

async function getAutomaticTargetChannelIds() {
  const configured = String(
    process.env.ROBLOX_AUTO_TARGET_CHANNEL_ID ?? "",
  ).trim();
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

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
