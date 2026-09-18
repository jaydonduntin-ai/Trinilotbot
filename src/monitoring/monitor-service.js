import { EmbedBuilder } from "discord.js";
import {
  getAvatarThumbnail,
  getGameDetails,
  getUsersPresence,
  lookupRobloxUsers,
} from "../roblox/api.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { getPublicJoinUrl } from "../roblox/game-session.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import { getAlertSubscribers } from "../storage/alert-subscribers.js";
import { scanGameValue } from "../providers/game-value-providers.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_MIN_VALUE = 450_000;
const MAX_MONITORED_PLAYERS = 15;

let lastPublishedFingerprint = null;

export async function startMonitoring(client) {
  const channelId = process.env.ROBLOX_MONITOR_CHANNEL_ID;

  if (!channelId) {
    console.info(
      "Roblox monitoring is disabled: ROBLOX_MONITOR_CHANNEL_ID is not configured.",
    );
    return;
  }

  const intervalMs = readPositiveInteger(
    process.env.ROBLOX_MONITOR_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
  );

  try {
    await publishMonitorReport(client, channelId);
  } catch (error) {
    console.error("Initial Roblox monitoring run failed:", error);
  }

  const interval = setInterval(() => {
    publishMonitorReport(client, channelId).catch((error) => {
      console.error("Roblox monitoring run failed:", error);
    });
  }, intervalMs);
  interval.unref?.();
}

async function publishMonitorReport(client, channelId) {
  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new Error(
      "ROBLOX_MONITOR_CHANNEL_ID does not point to a text-based Discord channel.",
    );
  }

  const configuredUsernames = getConfiguredUsernames();
  const minimumValue = readPositiveInteger(
    process.env.ROBLOX_MONITOR_MIN_VALUE,
    DEFAULT_MIN_VALUE,
  );

  if (configuredUsernames.length === 0) {
    await publishIfChanged(channel, {
      title: "Roblox monitor",
      description:
        "No monitoring usernames are configured. Add 10–15 usernames to ROBLOX_MONITOR_USERNAMES.",
      fingerprint: "no-usernames",
    });
    return;
  }

  const users = await lookupRobloxUsers(configuredUsernames);
  const presences = await getUsersPresence(users.map((user) => user.id));
  const presenceByUserId = new Map(
    presences.map((presence) => [Number(presence.userId), presence]),
  );

  const onlinePlayers = await Promise.all(
    users
      .map((user) => ({
        user,
        presence: presenceByUserId.get(Number(user.id)),
      }))
      .filter(({ presence }) => presence?.userPresenceType > 0)
      .map(({ user, presence }) =>
        createMonitoredPlayer(user, presence, minimumValue),
      ),
  );

  const qualifyingPlayers = onlinePlayers
    .filter(
      (player) =>
        typeof player.rapValue === "number" && player.rapValue >= minimumValue,
    )
    .slice(0, MAX_MONITORED_PLAYERS);

  if (qualifyingPlayers.length === 0) {
    await publishIfChanged(channel, {
      title: "Roblox monitor",
      description: [
        `Online candidates checked: ${onlinePlayers.length}.`,
        `Qualifying players: 0 (minimum value ${minimumValue.toLocaleString()}).`,
        "No player with a verified Roblox recentAveragePrice total at or above the threshold was returned.",
      ].join("\n"),
      fingerprint: `none:${onlinePlayers
        .map((player) => player.id)
        .sort()
        .join(",")}`,
    });
    return;
  }

  const subscribers = await getAlertSubscribers();
  await publishIfChanged(channel, {
    fingerprint: qualifyingPlayers
      .map((player) => `${player.id}:${player.rapValue}:${player.gameName}`)
      .join("|"),
    content: subscribers.map((id) => `<@${id}>`).join(" ") || undefined,
    embeds: buildQualifyingPlayerEmbeds(qualifyingPlayers, minimumValue),
  });
}

async function createMonitoredPlayer(user, presence, minimumValue) {
  let gameName = presence.lastLocation ?? "Unavailable";
  let joinUrl = null;

  if (presence.universeId) {
    try {
      const game = await getGameDetails(presence.universeId);
      gameName = game?.name ?? gameName;
    } catch (error) {
      console.warn(
        `Could not load monitored game ${presence.universeId}:`,
        error,
      );
    }
  }

  joinUrl = await getPublicJoinUrl(presence);

  const [avatarResult, inventoryResult, rolimonsResult, gameValueResult] =
    await Promise.allSettled([
      getAvatarThumbnail(user.id),
      getInventorySummary(user.id),
      getRolimonsPlayerSource(user.id),
      scanGameValue({
        gameName,
        userId: user.id,
        username: user.name,
      }),
    ]);
  const officialInventory =
    inventoryResult.status === "fulfilled" ? inventoryResult.value : null;
  const rolimons =
    rolimonsResult.status === "fulfilled" ? rolimonsResult.value : null;
  const inventory = rolimons?.inventory ?? officialInventory;

  return {
    id: user.id,
    username: user.name ?? "Unavailable",
    displayName: user.displayName ?? "Unavailable",
    avatarUrl: avatarResult.status === "fulfilled" ? avatarResult.value : null,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile`,
    premiumStatus: rolimons?.premiumStatus ?? "Unavailable",
    gameName,
    joinUrl,
    rapValue: inventory?.totalRAP ?? null,
    rapIsPartial: inventory?.hasMore ?? false,
    totalValue: inventory?.totalValue ?? null,
    gameValue:
      gameValueResult.status === "fulfilled" ? gameValueResult.value : null,
    rolimonsUrl: getRolimonsProfileUrl(user.id),
    minimumValue,
  };
}

async function publishIfChanged(channel, report) {
  if (report.fingerprint === lastPublishedFingerprint) {
    return;
  }

  if (report.embeds) {
    for (let index = 0; index < report.embeds.length; index += 10) {
      await channel.send({
        content: index === 0 ? report.content : undefined,
        embeds: report.embeds.slice(index, index + 10),
      });
    }
  } else {
    const embed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setTitle(report.title)
      .setDescription(report.description)
      .setFooter({
        text: "Official Roblox public API data only. Unavailable fields are not inferred.",
      })
      .setTimestamp();

    await channel.send({
      content: report.content,
      embeds: [embed],
    });
  }
  lastPublishedFingerprint = report.fingerprint;
}

function buildQualifyingPlayerEmbeds(players, minimumValue) {
  const summary = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle("Roblox hourly monitor")
    .setDescription(
      `Found ${players.length} active configured player${players.length === 1 ? "" : "s"} at or above ${minimumValue.toLocaleString()} RAP.`,
    )
    .setFooter({
      text: "Roblox official public APIs only. No Roblox users are contacted.",
    })
    .setTimestamp();

  const playerEmbeds = players.map((player) => {
    const rapText = `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setURL(player.profileUrl)
      .setDescription(
        `[Open Roblox profile](${player.profileUrl}) · [Rolimon's lookup](${player.rolimonsUrl})`,
      )
      .addFields(
        { name: "Premium", value: player.premiumStatus, inline: true },
        { name: "Current game", value: player.gameName, inline: true },
        { name: "RAP", value: rapText, inline: true },
        {
          name: "Direct join",
          value: player.joinUrl
            ? `[Join game](${player.joinUrl})`
            : "Unavailable",
          inline: false,
        },
        {
          name: "Game scanner",
          value:
            player.gameValue?.status === "verified"
              ? `${player.gameValue.value.toLocaleString()} ${player.gameValue.currency}`
              : (player.gameValue?.reason ?? "Unavailable"),
          inline: false,
        },
      );

    if (player.avatarUrl) {
      embed.setThumbnail(player.avatarUrl);
    }

    return embed;
  });

  return [summary, ...playerEmbeds];
}

function getConfiguredUsernames() {
  return [
    ...new Set(
      (process.env.ROBLOX_MONITOR_USERNAMES ?? "")
        .split(",")
        .map((username) => username.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_MONITORED_PLAYERS);
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
