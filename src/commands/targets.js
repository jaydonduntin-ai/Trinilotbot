import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_RAP,
  DEFAULT_TARGET_VALUE,
  MAX_TARGETS,
  MIN_TARGET_THRESHOLD,
  MAX_TARGET_THRESHOLD,
  scanDiscoveredTargets,
} from "../monitoring/target-scanner.js";

export const targetsCommand = {
  definition: new SlashCommandBuilder()
    .setName("target")
    .setDescription(
      "Discover currently in-game Roblox players above a value/RAP threshold.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_value")
        .setDescription(
          `Collectible value floor: ${MIN_TARGET_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}.`,
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
          `Random results to return, default ${DEFAULT_TARGET_COUNT}, max ${MAX_TARGETS}.`,
        )
        .setMinValue(MIN_TARGET_THRESHOLD)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const minimumValueOption =
      interaction.options.getInteger("min_value");
    const minimumRapOption =
      interaction.options.getInteger("min_rap");
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    // Default /target behavior is the established 450k+ RAP live search.
    // min_value can still be supplied explicitly for value-based searches.
    const minimumValue = minimumValueOption ?? null;
    const minimumRap =
      minimumRapOption ??
      (minimumValueOption === null ? DEFAULT_TARGET_RAP : null);

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await scanDiscoveredTargets({
        minimumValue,
        minimumRap,
        limit,
      });

      const embeds = buildTargetEmbeds(result);
      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} currently in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)}.`
            : `No currently in-game public profile matching ${formatThresholds(result)} was verified in this discovery pass.`,
        embeds: embeds.slice(0, 10),
      });
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
        `Verified 450k+ index: ${result.verifiedIndexCount ?? 0}`,
        `Live cache: ${result.liveCacheSize ?? 0}`,
        `Live-cache hit: ${result.liveCacheHit ? "Yes" : "No — broadened search"}`,
        `Candidate pool: ${result.candidatePoolSize ?? result.candidateCount ?? 0}`,
        `Candidates selected: ${result.candidateCount ?? 0}`,
        `Presence checked: ${result.presenceScannedCount ?? result.freshCandidateCount ?? 0}`,
        `Currently in-game seen: ${result.activeCount ?? 0}`,
        `Value/RAP checks attempted: ${result.verificationAttempts ?? 0}`,
        `Value unavailable: ${result.valueUnavailableCount ?? 0}`,
        `Below value: ${result.belowValueCount ?? 0}`,
        `RAP unavailable: ${result.rapUnavailableCount ?? 0}`,
        `Below RAP: ${result.belowRapCount ?? 0}`,
        `Profile metadata fallback: ${result.profileUnavailableCount ?? 0}`,
        `Verification errors: ${result.verificationErrorCount ?? 0}`,
        `Passed threshold before live recheck: ${result.preRecheckVerifiedCount ?? 0}`,
        `Left game before final recheck: ${result.finalPresenceLeftGameCount ?? 0}`,
        `Final presence unavailable: ${result.finalPresenceUnavailableCount ?? 0}`,
        `Cooling candidates skipped: ${result.recentlyCheckedSkipped ?? 0}`,
        `Verified scan watchlist: ${result.candidateSourceCounts?.watchlist ?? 0}`,
        `Trade-ad users: ${result.candidateSourceCounts?.tradeAds ?? 0}`,
        `Jailbreak trade users: ${result.candidateSourceCounts?.jailbreakTrades ?? 0}`,
        `Limited owners: ${result.candidateSourceCounts?.limitedOwners ?? 0}`,
        `Leaderboard users: ${result.candidateSourceCounts?.leaderboard ?? 0}`,
        `Marketplace owners: ${result.candidateSourceCounts?.marketplaceOwners ?? 0}`,
        `Verified live above threshold: ${result.verifiedCount ?? 0}`,
        `Join-ready profiles: ${result.joinReadyCount ?? 0}`,
        `Public server confirmed: ${result.publicServerConfirmedCount ?? 0}`,
        `Scan time: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
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
        "Candidates: Roblox public limited/Marketplace owners + Rolimon's trade ads/leaderboard\nVerification: Roblox current presence + public value data\n" +
        (truncate((result.sources ?? []).join("\n"), 850) || "Unavailable"),
      inline: false,
    })
    .setFooter({
      text: "The verified RAP index and live cache run continuously. /target final-checks Roblox presence before display.",
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
          name: "Value source",
          value: player.valueSource ?? "Unavailable",
          inline: false,
        },
        {
          name: "RAP source",
          value: player.rapSource ?? "Unavailable",
          inline: false,
        },
        {
          name: "Top public limiteds",
          value: truncate(limiteds, 1000),
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

  if (player.followJoinUrl) {
    links.push(`[Join player](<${player.followJoinUrl}>)`);
  }
  if (player.exactJoinUrl) {
    links.push(`[Try exact public server](<${player.exactJoinUrl}>)`);
  }

  const ids = [];
  if (player.placeId) ids.push(`Place: \`${player.placeId}\``);
  if (player.gameId) ids.push(`Job: \`${player.gameId}\``);

  const status = player.publicServerConfirmed
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

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}
