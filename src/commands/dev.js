import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  MAX_TARGETS,
  scanDeveloperTargets,
} from "../monitoring/target-scanner.js";

const DEV_DEFAULT_LIMIT = 10;
const DEV_MAX_LIMIT = Math.min(MAX_TARGETS, 25);

export const devCommand = {
  definition: new SlashCommandBuilder()
    .setName("dev")
    .setDescription(
      "Find Roblox developers who are currently in publicly joinable games.",
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Developer results to return; default ${DEV_DEFAULT_LIMIT}, max ${DEV_MAX_LIMIT}.`,
        )
        .setMinValue(1)
        .setMaxValue(DEV_MAX_LIMIT),
    ),

  async execute(interaction) {
    const limit = interaction.options.getInteger("limit") ?? DEV_DEFAULT_LIMIT;

    await interaction.deferReply();

    try {
      const result = await scanDeveloperTargets({
        // /dev is about verified creator evidence + live public presence,
        // not collectible wealth. Keep RAP/value out of qualification.
        minimumValue: null,
        minimumRap: null,
        limit,
      });

      const summary = new EmbedBuilder()
        .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
        .setTitle("Live Roblox developer discovery")
        .setDescription(
          [
            `Observed active experiences: ${result.observedGames ?? 0}`,
            `Creator accounts resolved: ${result.developerCandidates ?? 0}`,
            `Developer presence checks: ${result.presenceChecked ?? 0}`,
            `In-game developer candidates: ${result.inGameDeveloperCandidates ?? 0}`,
            `Publicly joinable developers: ${result.players.length}`,
            `Hidden non-public/stale: ${result.nonPublicServerCount ?? 0}`,
            result.presenceFallbackUsed
              ? "Presence mode: public fallback used"
              : result.presenceRateLimited
                ? "Presence mode: rate-limited"
                : "Presence mode: fresh",
          ].join("\n"),
        )
        .setFooter({
          text: "Only public creator evidence and public/joinable Roblox activity are surfaced.",
        })
        .setTimestamp();

      const embeds = [
        summary,
        ...result.players.map((player) => buildDeveloperEmbed(player)),
      ];

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} publicly joinable Roblox developer${result.players.length === 1 ? "" : "s"}.`
            : "No publicly joinable Roblox developer was verified in this pass.",
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
        "Developer discovery is temporarily unavailable. Try again shortly.",
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
    ? `[Join current public server](<${player.verifiedJoinUrl}>)`
    : "Unavailable";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${player.displayName ?? player.username} (@${player.username})`)
    .setURL(player.profileUrl)
    .addFields(
      {
        name: "Developer evidence",
        value: truncate(evidence, 900),
        inline: false,
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
