import { MessageFlags, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_RAP,
  DEFAULT_TARGET_VALUE,
  MIN_TARGET_THRESHOLD,
  MAX_TARGET_THRESHOLD,
  scanCandidatesForWatchlist,
} from "../monitoring/target-scanner.js";
import { addScanPlayers } from "../storage/scan-watchlist.js";

const MAX_MANUAL_SCAN_LIMIT = 5_000;

export const scanCommand = {
  definition: new SlashCommandBuilder()
    .setName("scan")
    .setDescription(
      "Discover threshold-qualified RAP/value players for the presence watchlist.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_value")
        .setDescription(
          `Value to store: ${MIN_TARGET_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEFAULT_TARGET_VALUE.toLocaleString()}.`,
        )
        .setMinValue(MIN_TARGET_THRESHOLD)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `RAP to store: ${MIN_TARGET_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEFAULT_TARGET_RAP.toLocaleString()}.`,
        )
        .setMinValue(MIN_TARGET_THRESHOLD)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Optional qualified-user cap; omit to scan all available unseen candidates this pass (max manual cap ${MAX_MANUAL_SCAN_LIMIT.toLocaleString()}).`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_MANUAL_SCAN_LIMIT),
    ),

  async execute(interaction) {
    const minimumRap =
      interaction.options.getInteger("min_rap") ?? DEFAULT_TARGET_RAP;
    const minimumValue =
      interaction.options.getInteger("min_value") ?? DEFAULT_TARGET_VALUE;
    const limit = interaction.options.getInteger("limit");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await scanCandidatesForWatchlist({
        minimumRap,
        minimumValue,
        limit,
      });

      const stored = await addScanPlayers(
        result.players,
        interaction.channelId,
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Roblox scan watchlist")
        .setDescription(
          [
            `Threshold: ${minimumRap.toLocaleString()}+ RAP · ${minimumValue.toLocaleString()}+ value`,
            `Mode: ${limit === null ? "exhaustive/resume (no qualified-user cap)" : `manual cap ${limit.toLocaleString()}`}`,
            `Candidates available this pass: ${result.candidateCount ?? 0}`,
            `Candidates checked: ${result.checkedCount}`,
            `Stop reason: ${formatScanStopReason(result.stopReason)}`,
            `Watchlist users skipped: ${result.alreadyWatchedSkipped ?? 0}`,
            `Previous /target users skipped: ${result.previousTargetSkipped ?? 0}`,
            `Previous /scan candidates skipped: ${result.previousScanSkipped ?? 0}`,
            `Total expansion exclusions: ${result.totalExcludedFromExpansion ?? 0}`,
            `Qualifying found: ${result.players.length}`,
            `Newly added: ${stored.added}`,
            `Already watched: ${stored.existing}`,
            `Total watchlist: ${stored.total}`,
            "",
            "Each /scan pass expands forward. Definitively checked users stay excluded at the same threshold; transient failures may be retried.",
          ].join("\n"),
        )
        .setFooter({
          text: "Public Roblox presence and public value data only.",
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Scan watchlist discovery failed:", error);
      await interaction.editReply(
        "The scan could not finish right now. Try again in a moment.",
      );
    }
  },
};


function formatScanStopReason(reason) {
  return {
    "candidate-selection-exhausted": "all currently selected unseen candidates checked",
    "time-budget": "scan time budget reached; run /scan again to resume",
    "qualified-cap": "manual qualified-user cap reached",
  }[reason] ?? "pass completed";
}
