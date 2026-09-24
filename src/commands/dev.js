import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_VALUE,
  MAX_TARGETS,
  MAX_TARGET_THRESHOLD,
  scanDeveloperTargets,
} from "../monitoring/target-scanner.js";

const DEV_MIN_THRESHOLD = 150_000;
const DEV_DEFAULT_RAP = 150_000;

export const devCommand = {
  definition: new SlashCommandBuilder()
    .setName("dev")
    .setDescription(
      "Find in-game public experience creators that meet RAP/value thresholds.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_value")
        .setDescription(
          `Value floor: ${DEV_MIN_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEFAULT_TARGET_VALUE.toLocaleString()}.`,
        )
        .setMinValue(DEV_MIN_THRESHOLD)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `RAP floor: ${DEV_MIN_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEV_DEFAULT_RAP.toLocaleString()}.`,
        )
        .setMinValue(DEV_MIN_THRESHOLD)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Developer targets to return, default ${MAX_TARGETS}, max ${MAX_TARGETS}.`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const minimumValue =
      interaction.options.getInteger("min_value") ?? DEFAULT_TARGET_VALUE;
    const minimumRap =
      interaction.options.getInteger("min_rap") ?? DEV_DEFAULT_RAP;
    const limit = interaction.options.getInteger("limit") ?? MAX_TARGETS;

    await interaction.deferReply();

    try {
      const result = await scanDeveloperTargets({
        minimumValue,
        minimumRap,
        limit,
      });

      const summary = new EmbedBuilder()
        .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
        .setTitle("Public Roblox developer discovery")
        .setDescription(
          [
            `Observed active experiences: ${result.observedGames ?? 0}`,
            `Creator accounts resolved: ${result.developerCandidates ?? 0}`,
            `Developer presence checks: ${result.presenceChecked ?? 0}`,
            `In-game developer candidates: ${result.inGameDeveloperCandidates ?? 0}`,
            `Verified public-joinable targets: ${result.players.length}`,
            `Hidden non-public/stale: ${result.nonPublicServerCount ?? 0}`,
            `RAP floor: ${minimumRap.toLocaleString()} · Value floor: ${minimumValue.toLocaleString()}`,
            result.presenceFallbackUsed
              ? "Presence mode: public fallback used"
              : result.presenceRateLimited
                ? "Presence mode: rate-limited"
                : "Presence mode: fresh",
          ].join("\n"),
        )
        .setFooter({
          text: "Evidence is public experience creator metadata or ownership of the creator group.",
        })
        .setTimestamp();

      const embeds = [
        summary,
        ...result.players.map((player) => buildDeveloperEmbed(player)),
      ];

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} in-game developer target${result.players.length === 1 ? "" : "s"} meeting both thresholds.`
            : "No in-game developer target meeting both thresholds was verified in this pass.",
        embeds: embeds.slice(0, 10),
      });

      for (let index = 10; index < embeds.length; index += 10) {
        await interaction.followUp({
          embeds: embeds.slice(index, index + 10),
        });
      }
    } catch (error) {
      console.error("Developer discovery failed:", error);
      await interaction.editReply(
        "Developer discovery is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildDeveloperEmbed(player) {
  const evidence = (player.developerEvidence ?? [])
    .map((entry) => {
      if (entry.kind === "experience-creator") {
        return `Direct creator · ${entry.gameName} · universe ${entry.universeId}`;
      }
      return `Creator-group owner · ${entry.groupName ?? entry.groupId ?? "group"} · ${entry.gameName}`;
    })
    .join("\n") || "Public creator evidence unavailable";

  const join = player.verifiedJoinUrl
    ? `[Verify & join current server](<${player.verifiedJoinUrl}>)`
    : "Unavailable";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${player.displayName} (@${player.username})`)
    .setURL(player.profileUrl)
    .addFields(
      {
        name: "Creator evidence",
        value: truncate(evidence, 900),
        inline: false,
      },
      {
        name: "RAP",
        value:
          typeof player.rapValue === "number"
            ? player.rapValue.toLocaleString()
            : "Unavailable",
        inline: true,
      },
      {
        name: "Value",
        value:
          typeof player.totalValue === "number"
            ? player.totalValue.toLocaleString()
            : "Unavailable",
        inline: true,
      },
      {
        name: "Current game",
        value: player.gameName ?? "In game",
        inline: true,
      },
      {
        name: "Join",
        value: join,
        inline: false,
      },
    );

  if (player.avatarUrl) {
    embed.setThumbnail(player.avatarUrl);
  }
  return embed;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
