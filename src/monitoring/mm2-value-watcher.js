import { EmbedBuilder } from "discord.js";
import {
  getPresenceBatched,
  isMm2Presence,
  refreshMm2ValueWatchCandidates,
} from "./target-scanner.js";
import { getUsersPresence, getUsersPresenceFallback } from "../roblox/api.js";
import { getFollowUserJoinUrl } from "../roblox/game-session.js";
import {
  getMm2ValueWatchChannels,
  getMm2ValueWatchlist,
  updateMm2ValuePresences,
} from "../storage/mm2-value-watchlist.js";

const DEFAULT_MM2_VALUE_WATCH_INTERVAL_MS = 2 * 60 * 1000;
const PRESENCE_BATCH_SIZE = 50;

export function startMm2ValueWatcher(client) {
  const intervalMs = readPositiveInteger(
    process.env.ROBLOX_MM2_VALUE_WATCH_INTERVAL_MS,
    DEFAULT_MM2_VALUE_WATCH_INTERVAL_MS,
  );

  const run = () =>
    runMm2ValueWatchCycle(client).catch((error) => {
      console.error("MM2 value watcher run failed:", error);
    });

  setTimeout(run, 45_000);
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
}

async function runMm2ValueWatchCycle(client) {
  const refresh = await refreshMm2ValueWatchCandidates().catch((error) => {
    console.warn("MM2 background value-index refresh failed:", error);
    return null;
  });

  if (refresh) {
    console.info(
      `MM2 value watch index: ${refresh.knownCount ?? 0} known · ${refresh.checked ?? 0} refreshed · ${refresh.persisted ?? 0} stored 50k+.`,
    );
  }

  const entries = await getMm2ValueWatchlist();
  if (entries.length === 0) return;

  const ids = entries.map((entry) => Number(entry.userId));
  const presenceScan = await getPresenceBatched(ids, {
    batchSize: PRESENCE_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 1_000,
    stopOnRateLimit: true,
    presenceFetcher: getUsersPresence,
    fallbackFetcher: getUsersPresenceFallback,
    fallbackOnRateLimit: true,
    priority: "background",
  });

  const presenceById = new Map(
    presenceScan.presences.map((presence) => [
      Number(presence.userId),
      presence,
    ]),
  );

  const updates = [];

  for (const entry of entries) {
    const presence = presenceById.get(Number(entry.userId));
    if (!presence) continue;

    const inMm2 = isMm2Presence(presence);
    const previousInMm2 =
      typeof entry.lastInMm2 === "boolean"
        ? entry.lastInMm2
        : null;

    const enteredMm2 = previousInMm2 === false && inMm2 === true;

    if (enteredMm2) {
      await publishMm2ValueAlert(client, entry, presence).catch((error) => {
        console.warn(
          `Could not publish MM2 value alert for Roblox user ${entry.userId}:`,
          error,
        );
      });
    }

    updates.push({
      userId: entry.userId,
      presence,
      inMm2,
      alerted: enteredMm2,
    });
  }

  await updateMm2ValuePresences(updates);
}

async function publishMm2ValueAlert(client, entry, presence) {
  const channels = await getMm2ValueWatchChannels();
  if (channels.length === 0) return;

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
    .setTitle(`${name} entered Murder Mystery 2`)
    .setURL(profileUrl)
    .addFields(
      {
        name: "MM2 value",
        value:
          typeof entry.mm2Value === "number"
            ? `${entry.mm2Value.toLocaleString()}+`
            : "Verified 50K+",
        inline: true,
      },
      {
        name: "MM2 items",
        value:
          typeof entry.mm2ItemCount === "number"
            ? entry.mm2ItemCount.toLocaleString()
            : "Unavailable",
        inline: true,
      },
      {
        name: "Activity",
        value: presence?.lastLocation ?? "Murder Mystery 2",
        inline: true,
      },
      {
        name: "Direct join",
        value: followJoinUrl
          ? `[Join player](${followJoinUrl})`
          : "Unavailable",
        inline: false,
      },
      {
        name: "Profile",
        value: `[Open Roblox profile](${profileUrl})`,
        inline: false,
      },
    )
    .setFooter({
      text: `MM2 value watch · ${entry.mm2ValueSource ?? "RBLXValue API v2"}`,
    })
    .setTimestamp();

  for (const channelId of channels) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || typeof channel.send !== "function") continue;
    await channel.send({ embeds: [embed] });
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
