import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_RAP,
  MAX_TARGETS,
  MIN_TARGET_THRESHOLD,
  MAX_TARGET_THRESHOLD,
  scanMm2JoinActivity,
} from "../monitoring/target-scanner.js";

export const rbx2mm2Command = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2")
    .setDescription("Find high-RAP Roblox users currently playing Murder Mystery 2.")
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `RAP floor: ${MIN_TARGET_THRESHOLD.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${DEFAULT_TARGET_RAP.toLocaleString()}.`,
        )
        .setMinValue(MIN_TARGET_THRESHOLD)
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
      interaction.options.getInteger("min_rap") ?? DEFAULT_TARGET_RAP;
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await scanMm2JoinActivity({
        minimumRap,
        limit,
      });

      const embeds = buildEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? result.liveCacheHit
              ? `Found ${result.players.length} recently verified Murder Mystery 2 player${result.players.length === 1 ? "" : "s"} with ${minimumRap.toLocaleString()}+ RAP from the live cache.`
              : `Found ${result.players.length} public Roblox user${result.players.length === 1 ? "" : "s"} currently active in Murder Mystery 2 with ${minimumRap.toLocaleString()}+ RAP.`
            : result.presenceRateLimited && !result.presenceFallbackUsed
              ? "Roblox is rate-limiting live presence checks right now. No recent MM2 cache hit was available."
              : `No ${minimumRap.toLocaleString()}+ RAP users currently active in Murder Mystery 2 were verified in this pass.`,
        embeds: batches[0] ?? [],
      });

      for (const batch of batches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("/rbx2mm2 failed:", error);
      await interaction.editReply(
        "MM2 activity lookup is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Murder Mystery 2 · Live activity")
    .setDescription(
      [
        `Verified RAP index: ${result.verifiedRapIndexCount ?? 0}`,
        `Candidates checked this pass: ${result.presenceScannedCount ?? 0}`,
        `MM2 active seen: ${result.gameActiveCount ?? 0}`,
        `Verified results: ${result.verifiedCount ?? 0}`,
        `Mode: ${result.liveCacheHit ? "live cache" : result.presenceFallbackUsed ? "public presence fallback" : result.presenceRateLimited ? "rate-limited" : "fresh presence"}`,
        !result.liveCacheHit && (result.verifiedRapIndexCount ?? 0) > 0
          ? `Coverage: ${Math.min(result.presenceScannedCount ?? 0, result.verifiedRapIndexCount ?? 0).toLocaleString()} / ${Number(result.verifiedRapIndexCount).toLocaleString()} indexed users this pass`
          : null,
        `RAP threshold: ${Number(result.minimumRap ?? DEFAULT_TARGET_RAP).toLocaleString()}+`,
        `Scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].filter(Boolean).join("\n"),
    )
    .addFields({
      name: "Sources",
      value:
        "Same SE TARG verified RAP index + Roblox public live presence. Each pass rotates forward through the index and only returns Murder Mystery 2 activity.",
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
        { name: "RAP", value: rap, inline: true },
        {
          name: "Activity",
          value: player.gameName ?? "Murder Mystery 2",
          inline: true,
        },
        {
          name: "Presence",
          value:
            player.presenceFreshness === "recent"
              ? "Recently verified in MM2"
              : "Verified in MM2",
          inline: true,
        },
      );

    if (player.avatarUrl) {
      embed.setThumbnail(player.avatarUrl);
    }

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
  const data = typeof embed?.toJSON === "function" ? embed.toJSON() : embed ?? {};
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
