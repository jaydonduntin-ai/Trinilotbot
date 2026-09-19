import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_VALUE,
  MAX_TARGETS,
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
          `Minimum collectible value, default ${DEFAULT_TARGET_VALUE.toLocaleString()}.`,
        )
        .setMinValue(1)
        .setMaxValue(2_000_000_000),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          "Optional extra RAP floor. Leave blank for value-only targeting.",
        )
        .setMinValue(1)
        .setMaxValue(2_000_000_000),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Random results to return, default ${DEFAULT_TARGET_COUNT}, max ${MAX_TARGETS}.`,
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
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    // Backward compatibility: /target min_rap:... remains RAP-only.
    // With no threshold options, /target defaults to 150k+ collectible value.
    const minimumValue =
      minimumRapOption !== null && minimumValueOption === null
        ? null
        : (minimumValueOption ?? undefined);
    const minimumRap = minimumRapOption ?? null;

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
        `Candidate pool: ${result.candidatePoolSize ?? result.candidateCount ?? 0}`,
        `Candidates selected: ${result.candidateCount ?? 0}`,
        `Presence checked: ${result.presenceScannedCount ?? result.freshCandidateCount ?? 0}`,
        `Currently in-game seen: ${result.activeCount ?? 0}`,
        `Value/RAP checks attempted: ${result.verificationAttempts ?? 0}`,
        `Value unavailable: ${result.valueUnavailableCount ?? 0}`,
        `Below value: ${result.belowValueCount ?? 0}`,
        `RAP unavailable: ${result.rapUnavailableCount ?? 0}`,
        `Below RAP: ${result.belowRapCount ?? 0}`,
        `Cooling candidates skipped: ${result.recentlyCheckedSkipped ?? 0}`,
        `Trade-ad users: ${result.candidateSourceCounts?.tradeAds ?? 0}`,
        `Limited owners: ${result.candidateSourceCounts?.limitedOwners ?? 0}`,
        `Leaderboard users: ${result.candidateSourceCounts?.leaderboard ?? 0}`,
        `Marketplace owners: ${result.candidateSourceCounts?.marketplaceOwners ?? 0}`,
        `Verified live above threshold: ${result.verifiedCount ?? 0}`,
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
      text: "Discovery uses multiple public sources. Results are rechecked against Roblox current InGame presence before display.",
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
