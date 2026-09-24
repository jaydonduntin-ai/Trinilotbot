import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_MM2_VALUE,
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_VALUE,
  DEFAULT_TARGET_RAP,
  MAX_TARGETS,
  scanAdoptMeRapActivity,
  scanGameTargets,
  scanMm2ValueTargets,
} from "../monitoring/target-scanner.js";

function createGameTargetCommand({
  name,
  gameKey,
  gameLabel,
  supportsGameValue = false,
}) {
  return {
    definition: (() => {
      const builder = new SlashCommandBuilder()
        .setName(name)
        .setDescription(
          supportsGameValue
            ? `Find current ${gameLabel} players; optionally require verified MM2 profile value.`
            : `Find active ${gameLabel} players above a Roblox RAP threshold.`,
        );

      if (supportsGameValue) {
        builder
          .addIntegerOption((option) =>
            option
              .setName("min_value")
              .setDescription(
                `Minimum Roblox collectible value, default ${DEFAULT_TARGET_VALUE.toLocaleString()}.`,
              )
              .setMinValue(1)
              .setMaxValue(2_000_000_000),
          )
          .addIntegerOption((option) =>
            option
              .setName("min_mm2_value")
              .setDescription(
                "Optional strict RBLXValue MM2 profile/inventory value floor.",
              )
              .setMinValue(1)
              .setMaxValue(2_000_000_000),
          )
          .addIntegerOption((option) =>
            option
              .setName("min_rap")
              .setDescription("Optional extra Roblox RAP floor.")
              .setMinValue(1)
              .setMaxValue(2_000_000_000),
          );
      } else {
        builder.addIntegerOption((option) =>
          option
            .setName("min_rap")
            .setDescription(
              `Minimum Roblox RAP, default 2,000.`,
            )
            .setMinValue(2_000)
            .setMaxValue(2_000_000_000),
        );
      }

      builder.addIntegerOption((option) =>
        option
          .setName("limit")
          .setDescription(
            `Results to return, default ${gameKey === "adopt-me" ? MAX_TARGETS : DEFAULT_TARGET_COUNT}, max ${MAX_TARGETS}.`,
          )
          .setMinValue(1)
          .setMaxValue(MAX_TARGETS),
      );

      return builder;
    })(),

    async execute(interaction) {
      const minimumRap = interaction.options.getInteger("min_rap");
      const minimumValue = supportsGameValue
        ? (interaction.options.getInteger("min_value") ??
          DEFAULT_TARGET_VALUE)
        : null;
      const minimumMm2Value = supportsGameValue
        ? interaction.options.getInteger("min_mm2_value")
        : null;
      const limit =
        interaction.options.getInteger("limit") ??
        (gameKey === "adopt-me" ? MAX_TARGETS : DEFAULT_TARGET_COUNT);

      await interaction.deferReply();

      try {
        const result =
          supportsGameValue && minimumMm2Value !== null
            ? await scanMm2ValueTargets({
                minimumGameValue: minimumMm2Value,
                minimumRap,
                limit,
              })
            : gameKey === "adopt-me"
              ? await scanAdoptMeRapActivity({
                  minimumRap: minimumRap ?? 2_000,
                  limit,
                })
              : await scanGameTargets({
                  gameKey,
                  minimumValue: supportsGameValue ? minimumValue : null,
                  minimumRap:
                    supportsGameValue
                      ? minimumRap
                      : (minimumRap ?? undefined),
                  limit,
                });

        await interaction.editReply({
          content:
            result.players.length > 0
              ? supportsGameValue
                ? minimumMm2Value !== null
                  ? `Found ${result.players.length} current ${gameLabel} player${result.players.length === 1 ? "" : "s"} with verified RBLXValue MM2 value at or above ${minimumMm2Value.toLocaleString()}.`
                  : `Found ${result.players.length} current ${gameLabel} player${result.players.length === 1 ? "" : "s"} at or above ${minimumValue.toLocaleString()} Roblox collectible value.`
                : `Found ${result.players.length} active ${gameLabel} player${result.players.length === 1 ? "" : "s"} at or above ${result.minimumRap.toLocaleString()} Roblox RAP.`
              : supportsGameValue
                ? minimumMm2Value !== null
                  ? `No current ${gameLabel} player with a matching RBLXValue MM2 profile at or above ${minimumMm2Value.toLocaleString()} was verified in this pass.`
                  : `No current ${gameLabel} player at or above ${minimumValue.toLocaleString()} Roblox collectible value was verified in this pass.`
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
  supportsGameValue: true,
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
        `Candidates selected: ${result.candidateCount ?? 0}`,
        result.presenceScannedCount !== undefined
          ? `Presence checked: ${result.presenceScannedCount}`
          : null,
        `Active in ${result.gameLabel}: ${result.gameActiveCount ?? 0}`,
        result.profileChecks !== undefined
          ? `RBLXValue profile checks: ${result.profileChecks}`
          : null,
        result.valueUnavailableCount !== undefined
          ? `MM2 value unavailable: ${result.valueUnavailableCount}`
          : null,
        result.belowGameValueCount !== undefined
          ? `Below MM2 value: ${result.belowGameValueCount}`
          : null,
        `Verified above threshold: ${result.verifiedCount ?? 0}`,
        result.minimumGameValue !== undefined
          ? `Strict MM2 profile value: ${result.minimumGameValue.toLocaleString()}`
          : null,
        result.minimumValue !== null && result.minimumValue !== undefined
          ? `Roblox collectible value: ${result.minimumValue.toLocaleString()}`
          : null,
        result.minimumRap !== null && result.minimumRap !== undefined
          ? `Roblox RAP threshold: ${result.minimumRap.toLocaleString()}`
          : null,
        result.scanElapsedMs !== undefined
          ? `Scan time: ${Math.round(result.scanElapsedMs / 1000)}s`
          : null,
      ].filter(Boolean).join("\n"),
    )
    .addFields({
      name: "Sources",
      value: truncate((result.sources ?? []).join("\n"), 1000) || "Unavailable",
      inline: false,
    })
    .setFooter({
      text: "Game membership is based on Roblox public presence. RBLXValue MM2 data is enrichment unless min_mm2_value is explicitly used.",
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
          value:
            typeof player.rapValue === "number"
              ? `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`
              : "Not required",
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
        ...(result.gameKey === "mm2"
          ? [{
              name: `${result.gameLabel} inventory scanner`,
              value: gameInventory,
              inline: false,
            }]
          : []),
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
