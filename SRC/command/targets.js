import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  DEFAULT_TARGET_RAP,
  MAX_TARGETS,
  getConfiguredTargetUsernames,
  scanConfiguredTargets,
} from "../monitoring/target-scanner.js";

export const targetsCommand = {
  definition: new SlashCommandBuilder()
    .setName("targets")
    .setDescription(
      "Find active, joinable Roblox players above a RAP threshold.",
    )
    .addStringOption((option) =>
      option
        .setName("usernames")
        .setDescription("Optional comma-separated Roblox usernames to scan.")
        .setMaxLength(500),
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
        .setDescription(`Maximum targets to return, up to ${MAX_TARGETS}.`)
        .setMinValue(1)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const rawUsernames = interaction.options.getString("usernames");
    const minimumRap = interaction.options.getInteger("min_rap") ?? undefined;
    const limit = interaction.options.getInteger("limit") ?? MAX_TARGETS;
    const usernames = rawUsernames
      ? rawUsernames.split(",").slice(0, MAX_TARGETS)
      : getConfiguredTargetUsernames();

    await interaction.deferReply({ ephemeral: true });
    const result = await scanConfiguredTargets({ usernames, minimumRap, limit });

    if (result.skipped) {
      await interaction.editReply(
        `${result.skipped} Provide usernames here or configure ROBLOX_TARGET_USERNAMES.`,
      );
      return;
    }

    const embeds = buildTargetEmbeds(result);
    const firstPage = embeds.slice(0, 10);
    await interaction.editReply({
      content:
        result.players.length > 0
          ? "Only active players with verified public server joins are shown."
          : "No active player met the RAP and verified-join requirements.",
      embeds: firstPage,
      components: buildTargetButtons(result.players.slice(0, 5)),
    });

    for (let index = 10; index < embeds.length; index += 10) {
      const playerOffset = index - 1;
      await interaction.followUp({
        embeds: embeds.slice(index, index + 10),
        components: buildTargetButtons(
          result.players.slice(playerOffset, playerOffset + 5),
        ),
        ephemeral: true,
      });
    }
  },
};

function buildTargetEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Roblox targets")
    .setDescription(
      [
        `Scanned ${result.usernames.length} configured username${result.usernames.length === 1 ? "" : "s"}.`,
        `Active: ${result.activeCount ?? 0} · Minimum RAP: ${result.minimumRap.toLocaleString()}.`,
        "A watchlist result must have a verified recentAveragePrice total and a public server instance.",
      ].join("\n"),
    )
    .setFooter({
      text: "Watchlist-only scan. Use /limitedowners for automatic public owner discovery.",
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const rap = `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`;
    const gameValue =
      player.gameValue?.status === "verified"
        ? `${player.gameValue.value.toLocaleString()} ${player.gameValue.currency}`
        : (player.gameValue?.reason ?? "Unavailable");
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setURL(player.profileUrl)
      .setDescription(
        `[Roblox profile](${player.profileUrl}) · [Rolimon's](${player.rolimonsUrl})`,
      )
      .addFields(
        { name: "RAP", value: rap, inline: true },
        { name: "Presence", value: player.presenceStatus, inline: true },
        { name: "Current game", value: player.gameName, inline: true },
        { name: "Game scanner", value: gameValue, inline: false },
      );
    if (player.avatarUrl) {
      embed.setThumbnail(player.avatarUrl);
    }
    return embed;
  });

  return [summary, ...players];
}

function buildTargetButtons(players) {
  const buttons = [];
  for (const player of players) {
    buttons.push(
      new ButtonBuilder()
        .setLabel(`Join ${player.username}`.slice(0, 80))
        .setStyle(ButtonStyle.Link)
        .setURL(player.joinUrl),
    );
  }
  return buttons.length > 0
    ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))]
    : [];
}
