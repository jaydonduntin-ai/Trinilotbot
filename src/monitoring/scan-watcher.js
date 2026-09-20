import { EmbedBuilder } from "discord.js";
import { getPresenceBatched } from "./target-scanner.js";
import { getRobloxProfile } from "../roblox/profile.js";
import {
  getScanWatchlist,
  updateScanPresence,
} from "../storage/scan-watchlist.js";

const DEFAULT_SCAN_WATCH_INTERVAL_MS = 2 * 60 * 1000;
const PRESENCE_BATCH_SIZE = 50;

export async function startScanWatcher(client) {
  const intervalMs = readPositiveInteger(
    process.env.ROBLOX_SCAN_WATCH_INTERVAL_MS,
    DEFAULT_SCAN_WATCH_INTERVAL_MS,
  );

  const run = () =>
    checkScanWatchlist(client).catch((error) => {
      console.error("Scan watcher run failed:", error);
    });

  setTimeout(run, 15_000);
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
}

async function checkScanWatchlist(client) {
  const entries = await getScanWatchlist();
  if (entries.length === 0) return;

  const ids = entries.map((entry) => entry.userId);
  const presenceScan = await getPresenceBatched(ids, {
    batchSize: PRESENCE_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 1_000,
    stopOnRateLimit: true,
  });
  const presences = presenceScan.presences;

  const presenceById = new Map(
    presences.map((presence) => [Number(presence.userId), presence]),
  );

  for (const entry of entries) {
    const presence = presenceById.get(Number(entry.userId));
    if (!presence) continue;

    const currentType = Number(presence.userPresenceType);
    const previousType =
      entry.lastPresenceType === null || entry.lastPresenceType === undefined
        ? null
        : Number(entry.lastPresenceType);

    const enteredGame = previousType !== null && previousType !== 2 && currentType === 2;

    if (enteredGame) {
      await publishScanAlert(client, entry).catch((error) => {
        console.warn(
          `Could not publish scan alert for Roblox user ${entry.userId}:`,
          error,
        );
      });
    }

    await updateScanPresence(entry.userId, currentType, {
      alerted: enteredGame,
    });
  }
}

async function publishScanAlert(client, entry) {
  const profile = await getRobloxProfile(
    String(entry.userId),
  ).catch(() => null);

  const profileUrl =
    profile?.profileUrl ??
    `https://www.roblox.com/users/${entry.userId}/profile`;
  const rap =
    typeof profile?.inventory?.totalRAP === "number"
      ? profile.inventory.totalRAP
      : typeof profile?.rolimonsTotals?.rap === "number"
        ? profile.rolimonsTotals.rap
        : entry.rapValue;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(
      profile
        ? `${profile.displayName} (@${profile.username}) is now in game`
        : `Roblox user ${entry.userId} is now in game`,
    )
    .setURL(profileUrl)
    .addFields(
      {
        name: "RAP",
        value:
          typeof rap === "number"
            ? `${rap.toLocaleString()} RAP`
            : "Unavailable",
        inline: true,
      },
      {
        name: "Current game",
        value: profile?.currentGame?.name ?? "In game",
        inline: true,
      },
      {
        name: "Profile",
        value: `[Open Roblox profile](${profileUrl})`,
        inline: false,
      },
      {
        name: "Direct join",
        value: profile?.currentGame?.followJoinUrl
          ? `[Join player](${profile.currentGame.followJoinUrl})`
          : profile?.currentGame?.joinUrl
            ? `[Try exact server](${profile.currentGame.joinUrl})`
            : profile?.currentGame?.gameUrl
              ? `[Open game](${profile.currentGame.gameUrl})`
              : "Unavailable",
        inline: false,
      },
    )
    .setFooter({
      text: "Triggered by /scan watchlist · public Roblox presence",
    })
    .setTimestamp();

  if (profile?.avatarUrl) embed.setThumbnail(profile.avatarUrl);

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
