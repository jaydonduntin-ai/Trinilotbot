import { MessageFlags, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_MM2_RAP,
  DEFAULT_TARGET_COUNT,
  MAX_TARGETS,
  MAX_TARGET_THRESHOLD,
  scanMm2RapActivity,
} from "../monitoring/target-scanner.js";

const MIN_MM2_RAP = 150_000;

export const rbx2mm2Command = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2")
    .setDescription(
      "Find 150K+ RAP Roblox users currently playing Murder Mystery 2.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `Minimum Roblox RAP; default ${DEFAULT_MM2_RAP.toLocaleString()}.`,
        )
        .setMinValue(MIN_MM2_RAP)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Results to return, default ${DEFAULT_TARGET_COUNT}, max ${MAX_TARGETS}.`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const minimumRap =
      interaction.options.getInteger("min_rap") ?? DEFAULT_MM2_RAP;
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(
      `Scanning MM2 live activity for ${minimumRap.toLocaleString()}+ RAP users…`,
    );

    try {
      const result = await scanMm2RapActivity({
        minimumRap,
        limit,
      });

      const embeds = buildEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} Murder Mystery 2 player${result.players.length === 1 ? "" : "s"} with ${minimumRap.toLocaleString()}+ Roblox RAP.`
            : result.presenceRateLimited && !result.presenceFallbackUsed
              ? "Roblox is rate-limiting live presence checks right now."
              : `No current MM2 player with ${minimumRap.toLocaleString()}+ Roblox RAP was verified in this pass.`,
        embeds: batches[0] ?? [],
      });

      for (const batch of batches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error("/rbx2mm2 failed:", error);
      await interaction.editReply(
        "MM2 RAP activity lookup is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Murder Mystery 2 · RAP live scan")
    .setDescription(
      [
        `Candidate pool: ${Number(result.candidatePoolSize ?? result.candidateCount ?? 0).toLocaleString()}`,
        `Candidates checked: ${Number(result.presenceScannedCount ?? 0).toLocaleString()}`,
        `MM2 active seen: ${result.gameActiveCount ?? 0}`,
        `RAP checks attempted: ${result.verificationAttempts ?? 0}`,
        `Below RAP: ${result.belowRapCount ?? 0}`,
        `RAP unavailable: ${result.rapUnavailableCount ?? 0}`,
        `Verified results: ${result.verifiedCount ?? 0}`,
        `Mode: ${result.liveCacheHit ? "MM2 live cache" : result.presenceFallbackUsed ? "public presence fallback" : result.presenceRateLimited ? "rate-limited" : "fresh Roblox presence"}`,
        `Roblox RAP threshold: ${Number(result.minimumRap ?? DEFAULT_MM2_RAP).toLocaleString()}+`,
        `Scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].join("\n"),
    )
    .addFields({
      name: "Sources",
      value:
        "Same SE TARG discovery streams + Roblox live presence + public Roblox/Rolimon's RAP verification. MM2 inventory value is not used by this command.",
      inline: false,
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const rap =
      typeof player.rapValue === "number"
        ? `${player.rapValue.toLocaleString()} RAP`
        : "Unavailable";
    const join =
      player.followJoinUrl
        ? `[Direct join MM2 player](<${player.followJoinUrl}>)`
        : "Join unavailable";

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setURL(player.profileUrl)
      .setDescription(
        `**Murder Mystery 2 — In Game**\n${join}\n[Roblox profile](${player.profileUrl})`,
      )
      .addFields(
        { name: "Roblox RAP", value: rap, inline: true },
        {
          name: "Activity",
          value: player.gameName ?? "Murder Mystery 2",
          inline: true,
        },
        {
          name: "RAP source",
          value: player.rapSource ?? "Public RAP source",
          inline: false,
        },
      );

    if (player.avatarUrl) embed.setThumbnail(player.avatarUrl);
    return embed;
  });

  return [summary, ...players];
}

function batchEmbedsForDiscord(embeds) {
  const batches = [];
  let current = [];
  let chars = 0;

  for (const embed of embeds) {
    const count = countEmbedCharacters(embed);
    if (
      current.length > 0 &&
      (current.length >= 10 || chars + count > 5_500)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(embed);
    chars += count;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function countEmbedCharacters(embed) {
  const data =
    typeof embed?.toJSON === "function" ? embed.toJSON() : embed ?? {};
  let total = 0;
  total += String(data.title ?? "").length;
  total += String(data.description ?? "").length;
  total += String(data.footer?.text ?? "").length;

  for (const field of data.fields ?? []) {
    total += String(field?.name ?? "").length;
    total += String(field?.value ?? "").length;
  }

  return total;
}
