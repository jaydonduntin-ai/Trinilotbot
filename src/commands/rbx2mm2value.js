import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_MM2_VALUE,
  DEFAULT_TARGET_COUNT,
  MAX_TARGETS,
  scanMm2JoinActivity,
} from "../monitoring/target-scanner.js";

const MIN_MM2_VALUE = 100_000;

export const rbx2mm2ValueCommand = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2value")
    .setDescription(
      "Find current MM2 players with at least 100K verified MM2 inventory value.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_value")
        .setDescription(
          `Minimum verified MM2 inventory value; default ${DEFAULT_MM2_VALUE.toLocaleString()}.`,
        )
        .setMinValue(MIN_MM2_VALUE),
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
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply(
      `Scanning current MM2 players and verifying ${minimumMm2Value.toLocaleString()}+ MM2 inventory value…`,
    );

    try {
      const result = await scanMm2JoinActivity({
        minimumMm2Value,
        minimumRap: null,
        limit,
      });

      const embeds = buildEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} current MM2 player${result.players.length === 1 ? "" : "s"} with verified MM2 inventory value of ${minimumMm2Value.toLocaleString()}+.`
            : result.presenceRateLimited && !result.presenceFallbackUsed
              ? "Roblox is rate-limiting live presence checks right now."
              : result.scanComplete
                ? `No current MM2 player with verified MM2 inventory value of ${minimumMm2Value.toLocaleString()}+ was found after this sweep.`
                : `No ${minimumMm2Value.toLocaleString()}+ MM2-value match was found in the ${Number(result.presenceScannedCount ?? 0).toLocaleString()} users checked this pass. The next scan continues forward.`,
        embeds: batches[0] ?? [],
      });

      for (const batch of batches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("/rbx2mm2value failed:", error);
      await interaction.editReply(
        "MM2 value activity lookup is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Murder Mystery 2 · Value live scan")
    .setDescription(
      [
        `Candidate pool: ${Number(result.candidateCount ?? 0).toLocaleString()}`,
        `Candidates checked: ${Number(result.presenceScannedCount ?? 0).toLocaleString()}`,
        `In-game users seen: ${result.totalInGameSeen ?? 0}`,
        `MM2 active seen: ${result.gameActiveCount ?? 0}`,
        `MM2 values checked: ${result.mm2ValueChecksAttempted ?? 0}`,
        `Below MM2 value: ${result.belowMm2ValueCount ?? 0}`,
        `MM2 value unavailable: ${result.mm2ValueUnavailableCount ?? 0}`,
        `Verified results: ${result.verifiedCount ?? 0}`,
        `MM2 value threshold: ${Number(result.minimumMm2Value ?? DEFAULT_MM2_VALUE).toLocaleString()}+`,
        "Roblox RAP prefilter: off",
        `Mode: ${result.liveCacheHit ? "live cache" : result.presenceFallbackUsed ? "public presence fallback" : result.presenceRateLimited ? "rate-limited" : "fresh presence"}`,
        `Scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].join("\n"),
    )
    .addFields({
      name: "Verification source",
      value:
        "RBLXValue API v2 MM2 profile value only. Presence is verified separately through Roblox public presence.",
      inline: false,
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const mm2Value =
      typeof player.mm2Value === "number"
        ? `${player.mm2Value.toLocaleString()} MM2 value`
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
        { name: "MM2 value", value: mm2Value, inline: true },
        {
          name: "MM2 items",
          value:
            typeof player.mm2ItemCount === "number"
              ? player.mm2ItemCount.toLocaleString()
              : "Unavailable",
          inline: true,
        },
        {
          name: "MM2 value source",
          value: player.mm2ValueSource ?? "RBLXValue API v2 profile",
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
