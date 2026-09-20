import { MessageFlags, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  DEFAULT_TARGET_COUNT,
  MAX_TARGETS,
  scanMm2JoinActivity,
} from "../monitoring/target-scanner.js";

export const rbx2mm2AllCommand = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2all")
    .setDescription(
      "Find current Murder Mystery 2 players with no MM2-value or Roblox-RAP minimum.",
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
    const limit =
      interaction.options.getInteger("limit") ?? DEFAULT_TARGET_COUNT;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(
      "Scanning live MM2 activity with no value/RAP minimum…",
    );

    try {
      const result = await scanMm2JoinActivity({
        minimumMm2Value: 0,
        minimumRap: null,
        limit,
      });

      const embeds = buildEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} current MM2 player${result.players.length === 1 ? "" : "s"} with verified MM2 inventory data. No minimum value or Roblox RAP filter was applied.`
            : result.presenceRateLimited && !result.presenceFallbackUsed
              ? "Roblox is rate-limiting live presence checks right now."
              : result.scanComplete
                ? "No current MM2 players with verified inventory data were found after this sweep."
                : `No verified MM2 result was found in the ${Number(result.presenceScannedCount ?? 0).toLocaleString()} users checked this pass. The next scan continues forward.`,
        embeds: batches[0] ?? [],
      });

      for (const batch of batches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error("/rbx2mm2all failed:", error);
      await interaction.editReply(
        "MM2 unrestricted activity lookup is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Murder Mystery 2 · Unrestricted live scan")
    .setDescription(
      [
        `Candidate pool: ${Number(result.candidateCount ?? 0).toLocaleString()}`,
        `Candidates checked: ${Number(result.presenceScannedCount ?? 0).toLocaleString()}`,
        `In-game users seen: ${result.totalInGameSeen ?? 0}`,
        `MM2 active seen: ${result.gameActiveCount ?? 0}`,
        `MM2 inventories checked: ${result.mm2ValueChecksAttempted ?? 0}`,
        `MM2 value unavailable: ${result.mm2ValueUnavailableCount ?? 0}`,
        `Verified results: ${result.verifiedCount ?? 0}`,
        "MM2 value minimum: OFF",
        "Roblox RAP minimum: OFF",
        `Mode: ${result.liveCacheHit ? "live cache" : result.presenceFallbackUsed ? "public presence fallback" : result.presenceRateLimited ? "rate-limited" : "fresh presence"}`,
        result.scanComplete === false
          ? "Sweep status: partial — next run resumes forward"
          : result.scanComplete === true
            ? "Sweep status: complete"
            : null,
        `Scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].filter(Boolean).join("\n"),
    )
    .addFields({
      name: "Sources",
      value:
        "Same SE TARG candidate streams, Roblox live presence, MM2 activity filter, and RBLXValue MM2 inventory data.",
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
