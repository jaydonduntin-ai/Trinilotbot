import { MessageFlags, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_RAP,
  DEFAULT_TARGET_VALUE,
  MAX_TARGETS,
  MIN_TARGET_THRESHOLD,
  MAX_TARGET_THRESHOLD,
  scanCandidatesForWatchlist,
  scanDiscoveredTargets,
} from "../monitoring/target-scanner.js";
import { addScanPlayers } from "../storage/scan-watchlist.js";

const TARGET_DEFAULT_LIMIT = 50;
const TARGET_EXPANSION_LIMIT = 50;

export const targetsCommand = {
  definition: new SlashCommandBuilder()
    .setName("target")
    .setDescription(
      "Expand the candidate pool, then return currently in-game RAP/value targets.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_value")
        .setDescription(
          `Value floor: ${MIN_TARGET_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEFAULT_TARGET_VALUE.toLocaleString()}.`,
        )
        .setMinValue(MIN_TARGET_THRESHOLD)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `RAP floor: ${MIN_TARGET_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEFAULT_TARGET_RAP.toLocaleString()}.`,
        )
        .setMinValue(MIN_TARGET_THRESHOLD)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Results to return, default ${TARGET_DEFAULT_LIMIT}, max ${MAX_TARGETS}.`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const minimumValueOption =
      interaction.options.getInteger("min_value");
    const minimumRapOption =
      interaction.options.getInteger("min_rap");
    const limit =
      interaction.options.getInteger("limit") ?? TARGET_DEFAULT_LIMIT;

    // /target now enforces both configured floors by default.
    const minimumValue = minimumValueOption ?? DEFAULT_TARGET_VALUE;
    const minimumRap = minimumRapOption ?? DEFAULT_TARGET_RAP;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let expansion = {
        attempted: true,
        failed: false,
        checkedCount: 0,
        qualifyingCount: 0,
        newlyAdded: 0,
        alreadyWatched: 0,
        totalWatchlist: 0,
      };

      try {
        const scanResult = await scanCandidatesForWatchlist({
          minimumValue,
          minimumRap,
          limit: TARGET_EXPANSION_LIMIT,
        });
        const stored = await addScanPlayers(
          scanResult.players,
          interaction.channelId,
        );
        expansion = {
          ...expansion,
          checkedCount: scanResult.checkedCount,
          qualifyingCount: scanResult.players.length,
          newlyAdded: stored.added,
          alreadyWatched: stored.existing,
          totalWatchlist: stored.total,
        };
      } catch (error) {
        expansion = { ...expansion, failed: true };
        console.warn(
          "/target expansion scan failed; continuing with live discovery:",
          error,
        );
      }

      const result = await scanDiscoveredTargets({
        minimumValue,
        minimumRap,
        limit,
      });
      result.expansion = expansion;
      result.requestedLimit = limit;

      const embeds = buildTargetEmbeds(result);
      const embedBatches = batchEmbedsForDiscord(embeds);
      const content =
        result.players.length > 0
          ? result.usedCachedPresenceFallback
            ? `Found ${result.players.length} recently verified in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)}. Roblox is rate-limiting fresh presence checks, so these are from the recent live cache.`
            : result.presenceFallbackUsed
              ? `Found ${result.players.length} currently in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)} using the public presence fallback.`
              : `Found ${result.players.length} currently in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)}.`
          : result.presenceRateLimited && !result.presenceFallbackUsed
            ? "Roblox is rate-limiting live presence checks right now, and no usable fallback/cache result was available for this pass."
            : `No currently in-game public profile matching ${formatThresholds(result)} was verified in this discovery pass.`;

      await interaction.editReply({
        content,
        embeds: embedBatches[0] ?? [],
      });

      for (const batch of embedBatches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error("Automatic target discovery failed:", error);
      await interaction.editReply(
        "Automatic target discovery is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildTargetEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Automatic Roblox discovery")
    .setDescription(
      [
        `Verified ${DEFAULT_TARGET_RAP.toLocaleString()}+ RAP index: ${result.verifiedIndexCount ?? 0}`,
        `Live cache: ${result.liveCacheSize ?? 0} · Cache hit: ${result.liveCacheHit ? "Yes" : "No"}`,
        result.usedCachedPresenceFallback
          ? "Presence mode: recent cache (Roblox rate-limited)"
          : result.presenceFallbackUsed
            ? "Presence mode: public fallback"
            : result.presenceRateLimited
              ? "Presence mode: rate-limited"
              : "Presence mode: fresh",
        `Candidates: ${result.candidateCount ?? 0} · Presence checked: ${result.presenceScannedCount ?? result.freshCandidateCount ?? 0}`,
        `In-game seen: ${result.activeCount ?? 0} · Verified live: ${result.verifiedCount ?? 0}`,
        `Requested: ${result.requestedLimit ?? result.players.length} · Returned: ${result.players.length}`,
        formatPriorityGameSummary(result.players),
        `Join-ready: ${result.joinReadyCount ?? 0} · Live scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
        result.expansion?.failed
          ? "Expansion scan: unavailable · live discovery continued"
          : result.expansion?.attempted
            ? `Expansion scan: ${result.expansion.checkedCount} checked · ${result.expansion.qualifyingCount} qualified · ${result.expansion.newlyAdded} newly watched`
            : null,
        result.minimumValue !== null && result.minimumValue !== undefined
          ? `Value threshold: ${result.minimumValue.toLocaleString()}`
          : null,
        result.minimumRap !== null && result.minimumRap !== undefined
          ? `RAP threshold: ${result.minimumRap.toLocaleString()}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .addFields({
      name: "Discovery source",
      value:
        "Public Roblox presence + public RAP/value sources. " +
        (truncate((result.sources ?? []).join(" · "), 450) || "Unavailable"),
      inline: false,
    })
    .setFooter({
      text: "/target expands first, then final-checks Roblox presence before display.",
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const rap =
      typeof player.rapValue === "number"
        ? `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`
        : "Unavailable";
    const value =
      typeof player.totalValue === "number"
        ? player.totalValue.toLocaleString()
        : "Unavailable";
    const limiteds =
      player.topLimiteds?.length > 0
        ? player.topLimiteds
            .map(
              (item) =>
                `[${escapeMarkdown(item.name)}](https://www.rolimons.com/item/${item.assetId}) — ${item.rap.toLocaleString()} RAP`,
            )
            .join("\n")
        : "Unavailable";

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setURL(player.profileUrl)
      .setDescription(
        `[Roblox profile](${player.profileUrl}) · [Rolimon's](${player.rolimonsUrl})`,
      )
      .addFields(
        { name: "RAP", value: rap, inline: true },
        { name: "Value", value, inline: true },
        { name: "Presence", value: player.presenceStatus, inline: true },
        {
          name: "Current game",
          value: player.gameName ?? "Unavailable",
          inline: true,
        },
        {
          name: "Join",
          value: formatTargetJoin(player),
          inline: false,
        },
        {
          name: "Source",
          value: truncate(player.rapSource ?? player.valueSource ?? "Public data", 180),
          inline: false,
        },
      );

    if (player.avatarUrl) {
      embed.setThumbnail(player.avatarUrl);
    }
    return embed;
  });

  return [summary, ...players];
}

function formatTargetJoin(player) {
  const links = [];

  if (player.exactJoinUrl) {
    links.push(`[Join exact server](<${player.exactJoinUrl}>)`);
  }
  if (player.followJoinUrl) {
    links.push(`[Follow-join fallback](<${player.followJoinUrl}>)`);
  }

  const ids = [];
  if (player.placeId) ids.push(`Place: \`${player.placeId}\``);
  if (player.gameId) ids.push(`Job: \`${player.gameId}\``);

  const status = player.exactJoinUrl
    ? "Exact server JobId captured from live presence"
    : player.publicServerConfirmed
      ? "Public server confirmed"
      : player.joinReady
        ? "Profile follow-join available"
        : "Join unavailable";

  return [
    status,
    links.join(" · "),
    ids.join(" · "),
  ].filter(Boolean).join("\n");
}

function formatPriorityGameSummary(players) {
  const counts = new Map();
  for (const player of players ?? []) {
    const label = player?.priorityGameLabel;
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return "Priority games: 0 returned · all-game discovery stayed open";
  }

  const breakdown = [...counts.entries()]
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
  return `Priority games: ${total} returned · ${breakdown}`;
}

function formatThresholds(result) {
  const parts = [];
  if (result.minimumValue !== null && result.minimumValue !== undefined) {
    parts.push(`${result.minimumValue.toLocaleString()}+ value`);
  }
  if (result.minimumRap !== null && result.minimumRap !== undefined) {
    parts.push(`${result.minimumRap.toLocaleString()}+ RAP`);
  }
  return parts.length > 0 ? parts.join(" and ") : "the configured thresholds";
}

function batchEmbedsForDiscord(embeds) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const chars = countEmbedCharacters(embed);

    if (
      current.length > 0 &&
      (current.length >= 10 || currentChars + chars > 5_500)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(embed);
    currentChars += chars;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function countEmbedCharacters(embed) {
  const data = typeof embed?.toJSON === "function" ? embed.toJSON() : embed ?? {};
  let total = 0;

  total += String(data.title ?? "").length;
  total += String(data.description ?? "").length;
  total += String(data.footer?.text ?? "").length;
  total += String(data.author?.name ?? "").length;

  for (const field of data.fields ?? []) {
    total += String(field?.name ?? "").length;
    total += String(field?.value ?? "").length;
  }

  return total;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}
