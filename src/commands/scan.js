import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_RAP,
  MIN_TARGET_THRESHOLD,
  MAX_TARGET_THRESHOLD,
  scanCandidatesForWatchlist,
} from "../monitoring/target-scanner.js";
import { addScanPlayers } from "../storage/scan-watchlist.js";

const DEFAULT_SCAN_LIMIT = 25;
const MAX_SCAN_LIMIT = 50;

export const scanCommand = {
  definition: new SlashCommandBuilder()
    .setName("scan")
    .setDescription(
      "Discover 450k+ RAP players and add them to the automatic presence watchlist.",
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
          `Players to add this pass, default ${DEFAULT_SCAN_LIMIT}, max ${MAX_SCAN_LIMIT}.`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_SCAN_LIMIT),
    ),

  async execute(interaction) {
    const minimumRap =
      interaction.options.getInteger("min_rap") ?? DEFAULT_TARGET_RAP;
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_SCAN_LIMIT;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await scanCandidatesForWatchlist({
        minimumRap,
        minimumValue: null,
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
            `Threshold: ${minimumRap.toLocaleString()}+ RAP`,
            `Candidates checked: ${result.checkedCount}`,
            `Watchlist users skipped: ${result.alreadyWatchedSkipped ?? 0}`,
            `Previous /target users skipped: ${result.previousTargetSkipped ?? 0}`,
            `Previous /scan candidates skipped: ${result.previousScanSkipped ?? 0}`,
            `Total expansion exclusions: ${result.totalExcludedFromExpansion ?? 0}`,
            `Qualifying found: ${result.players.length}`,
            `Newly added: ${stored.added}`,
            `Already watched: ${stored.existing}`,
            `Total watchlist: ${stored.total}`,
            "",
            "Each /scan pass now expands forward instead of replaying prior /target results or candidates already attempted at the same threshold.",
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
