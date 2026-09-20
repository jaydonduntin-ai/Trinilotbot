import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  DEFAULT_TARGET_RAP,
  DEFAULT_MM2_VALUE,
  MAX_TARGETS,
  MIN_TARGET_THRESHOLD,
  MAX_TARGET_THRESHOLD,
  scanMm2JoinActivity,
} from "../monitoring/target-scanner.js";

export const rbx2mm2Command = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2")
    .setDescription("Find high-MM2-value Roblox users currently playing Murder Mystery 2.")
    .addIntegerOption((option) =>
      option
        .setName("min_value")
        .setDescription(
          `Minimum verified MM2 inventory value; default ${DEFAULT_MM2_VALUE.toLocaleString()}.`,
        )
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          "Optional Roblox limited RAP prefilter; leave blank for MM2-value-only scanning.",
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
    const minimumMm2Value =
      interaction.options.getInteger("min_value") ?? DEFAULT_MM2_VALUE;
    const minimumRap =
      interaction.options.getInteger("min_rap");
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await scanMm2JoinActivity({
        minimumMm2Value,
        minimumRap,
        limit,
      });

      const embeds = buildEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} Murder Mystery 2 player${result.players.length === 1 ? "" : "s"} with verified MM2 inventory value of ${minimumMm2Value.toLocaleString()}+.`
            : result.presenceRateLimited && !result.presenceFallbackUsed
              ? "Roblox is rate-limiting live presence checks right now. No recent MM2 cache hit was available."
              : result.scanComplete
                ? `No currently active MM2 player with verified inventory value of ${minimumMm2Value.toLocaleString()}+ was found after this sweep.`
                : `No ${minimumMm2Value.toLocaleString()}+ MM2-value match was found in the ${(result.presenceScannedCount ?? 0).toLocaleString()} users checked this pass. The next scan continues forward.`,
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
        `Candidate pool: ${Number(result.candidateCount ?? 0).toLocaleString()}`,
        `Candidates checked this pass: ${Number(result.presenceScannedCount ?? 0).toLocaleString()}`,
        `In-game users seen: ${result.totalInGameSeen ?? 0}`,
        `MM2 active seen: ${result.gameActiveCount ?? 0}`,
        `MM2 values checked: ${result.mm2ValueChecksAttempted ?? 0}`,
        `Below MM2 value: ${result.belowMm2ValueCount ?? 0}`,
        `MM2 value unavailable: ${result.mm2ValueUnavailableCount ?? 0}`,
        `Verified results: ${result.verifiedCount ?? 0}`,
        `Mode: ${result.liveCacheHit ? "live cache" : result.presenceFallbackUsed ? "public presence fallback" : result.presenceRateLimited ? "rate-limited" : "fresh presence"}`,
        result.scanComplete === false
          ? "Sweep status: partial — next run resumes forward"
          : result.scanComplete === true
            ? "Sweep status: complete"
            : null,
        `MM2 value threshold: ${Number(result.minimumMm2Value ?? DEFAULT_MM2_VALUE).toLocaleString()}+`,
        result.minimumRap
          ? `Optional Roblox RAP prefilter: ${Number(result.minimumRap).toLocaleString()}+`
          : "Roblox RAP prefilter: off",
        `Scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].filter(Boolean).join("\n"),
    )
    .addFields({
      name: "Sources",
      value:
        "SE TARG candidate discovery + Roblox live presence + RBLXValue MM2 profile values. A result must be in Murder Mystery 2 and pass the MM2 inventory-value threshold.",
      inline: false,
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const mm2Value =
      typeof player.mm2Value === "number"
        ? `${player.mm2Value.toLocaleString()} MM2 value`
        : "Unavailable";
    const rap =
      typeof player.rapValue === "number"
        ? `${player.rapValue.toLocaleString()} RAP`
        : "Not required";

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
        { name: "MM2 value", value: mm2Value, inline: true },
        {
          name: "MM2 items",
          value:
            typeof player.mm2ItemCount === "number"
              ? player.mm2ItemCount.toLocaleString()
              : "Unavailable",
          inline: true,
        },
        { name: "Roblox RAP", value: rap, inline: true },
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
        {
          name: "MM2 value source",
          value: player.mm2ValueSource ?? "RBLXValue API v2",
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
