import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_RAP,
  MAX_TARGETS,
  scanDiscoveredTargets,
} from "../monitoring/target-scanner.js";

export const targetsCommand = {
  definition: new SlashCommandBuilder()
    .setName("target")
    .setDescription(
      "Discover Roblox players currently in-game above a RAP threshold.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `Minimum RAP, default ${DEFAULT_TARGET_RAP.toLocaleString()}.`,
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
    const minimumRap = interaction.options.getInteger("min_rap") ?? undefined;
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await scanDiscoveredTargets({
        minimumRap,
        limit,
      });

      const embeds = buildTargetEmbeds(result);
      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} random active public profile${result.players.length === 1 ? "" : "s"} at or above ${result.minimumRap.toLocaleString()} RAP.`
            : `No active public profile at or above ${result.minimumRap.toLocaleString()} RAP was verified in this discovery pass.`,
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
        `Fresh candidates scanned: ${result.freshCandidateCount ?? result.candidateCount ?? 0}`,
        `Cooling down from recent scans: ${result.recentlyCheckedSkipped ?? 0}`,
        `Roblox search: ${result.candidateSourceCounts?.userSearch ?? 0}`,
        `Roblox friends: ${result.candidateSourceCounts?.socialGraph ?? 0}`,
        `Roblox followers: ${result.candidateSourceCounts?.followers ?? 0}`,
        `Roblox followings: ${result.candidateSourceCounts?.followings ?? 0}`,
        `Rolimon's trade ads: ${result.candidateSourceCounts?.tradeAds ?? 0}`,
        `Rolimon's player search: ${result.candidateSourceCounts?.rolimonsSearch ?? 0}`,
        `Rolimon's leaderboard: ${result.candidateSourceCounts?.leaderboard ?? 0}`,
        `Rolimon's limited owners: ${result.candidateSourceCounts?.limitedOwners ?? 0}`,
        `Roblox group search: ${result.candidateSourceCounts?.groupSearchMembers ?? 0}`,
        `Roblox group graph: ${result.candidateSourceCounts?.groupGraphMembers ?? 0}`,
        `Roblox friends' groups: ${result.candidateSourceCounts?.friendGroupMembers ?? 0}`,
        `Active candidates checked: ${result.activeCount ?? 0}`,
        `RAP threshold: ${result.minimumRap.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .addFields({
      name: "Sources",
      value: truncate((result.sources ?? []).join("\n"), 1000) || "Unavailable",
      inline: false,
    })
    .setFooter({
      text: "Results are rechecked for current InGame presence before display. No exact server/job IDs or private inventories are exposed.",
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const rap = `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`;
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

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}
