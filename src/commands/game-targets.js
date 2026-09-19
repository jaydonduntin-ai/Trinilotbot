import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_RAP,
  MAX_TARGETS,
  scanGameTargets,
} from "../monitoring/target-scanner.js";

function createGameTargetCommand({
  name,
  gameKey,
  gameLabel,
}) {
  return {
    definition: new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `Find active ${gameLabel} players above a Roblox RAP threshold.`,
      )
      .addIntegerOption((option) =>
        option
          .setName("min_rap")
          .setDescription(
            `Minimum Roblox RAP, default ${DEFAULT_TARGET_RAP.toLocaleString()}.`,
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
      const minimumRap =
        interaction.options.getInteger("min_rap") ?? undefined;
      const limit =
        interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

      await interaction.deferReply({ ephemeral: true });

      try {
        const result = await scanGameTargets({
          gameKey,
          minimumRap,
          limit,
        });

        await interaction.editReply({
          content:
            result.players.length > 0
              ? `Found ${result.players.length} active ${gameLabel} player${result.players.length === 1 ? "" : "s"} at or above ${result.minimumRap.toLocaleString()} Roblox RAP.`
              : `No active ${gameLabel} player at or above ${result.minimumRap.toLocaleString()} Roblox RAP was verified in this pass.`,
          embeds: buildGameTargetEmbeds(result).slice(0, 10),
        });
      } catch (error) {
        console.error(`/${name} scan failed:`, error);
        await interaction.editReply(
          `${gameLabel} target scanning is temporarily unavailable. Try again in a moment.`,
        );
      }
    },
  };
}

export const rbx2mm2Command = createGameTargetCommand({
  name: "rbx2mm2",
  gameKey: "mm2",
  gameLabel: "Murder Mystery 2",
});

export const rbx2admCommand = createGameTargetCommand({
  name: "rbx2adm",
  gameKey: "adopt-me",
  gameLabel: "Adopt Me",
});

function buildGameTargetEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle(`${result.gameLabel} discovery`)
    .setDescription(
      [
        `Candidate pool: ${result.candidatePoolSize ?? 0}`,
        `Candidates scanned: ${result.candidateCount ?? 0}`,
        `Active in ${result.gameLabel}: ${result.gameActiveCount ?? 0}`,
        `Verified above threshold: ${result.verifiedCount ?? 0}`,
        `Roblox RAP threshold: ${result.minimumRap.toLocaleString()}`,
      ].join("\n"),
    )
    .addFields({
      name: "Sources",
      value: truncate((result.sources ?? []).join("\n"), 1000) || "Unavailable",
      inline: false,
    })
    .setFooter({
      text: "Game membership is based on Roblox public presence. Game-specific inventory values are shown only when a configured provider verifies them.",
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const gameInventory = formatGameInventory(player.gameValue);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setURL(player.profileUrl)
      .setDescription(
        `[Roblox profile](${player.profileUrl}) · [Rolimon's](${player.rolimonsUrl})`,
      )
      .addFields(
        {
          name: "Roblox RAP",
          value: `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`,
          inline: true,
        },
        {
          name: "Presence",
          value: player.presenceStatus ?? "Active",
          inline: true,
        },
        {
          name: "Current game",
          value: player.gameName ?? result.gameLabel,
          inline: true,
        },
        {
          name: `${result.gameLabel} inventory scanner`,
          value: gameInventory,
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

function formatGameInventory(gameValue) {
  if (!gameValue) {
    return "No compatible user-inventory provider returned data.";
  }

  if (gameValue.status !== "verified") {
    return truncate(
      gameValue.reason ??
        "A compatible provider is configured, but no verified inventory was returned.",
      1000,
    );
  }

  const total = Number(gameValue.totalValue ?? gameValue.value);
  const totalText = Number.isFinite(total)
    ? total.toLocaleString()
    : "Unavailable";
  const itemCount =
    Number.isFinite(Number(gameValue.itemCount))
      ? ` · ${Number(gameValue.itemCount).toLocaleString()} items`
      : "";
  const source = gameValue.source ? ` · ${gameValue.source}` : "";

  return `${totalText} ${gameValue.currency ?? "value"}${itemCount}${source}`;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
