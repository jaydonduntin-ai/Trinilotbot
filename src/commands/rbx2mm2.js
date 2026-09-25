import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  MAX_TARGETS,
  scanMm2RapActivity,
} from "../monitoring/target-scanner.js";

export const rbx2mm2Command = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2")
    .setDescription(
      "Find up to 50 public-joinable users currently playing Murder Mystery 2. No RAP minimum.",
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Results to return, default ${MAX_TARGETS}, max ${MAX_TARGETS}.`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const limit =
      interaction.options.getInteger("limit") ?? MAX_TARGETS;

    await interaction.deferReply();
    await interaction.editReply(
      "Scanning MM2 live activity with no RAP minimum…",
    );

    try {
      const result = await scanMm2RapActivity({
        minimumRap: null,
        limit,
      });

      const embeds = buildEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} public-joinable Murder Mystery 2 player${result.players.length === 1 ? "" : "s"}. No RAP minimum is applied.`
            : result.presenceRateLimited && !result.presenceFallbackUsed
              ? "Roblox is rate-limiting live presence checks right now."
              : "No current public-joinable MM2 player was verified in this pass.",
        embeds: batches[0] ?? [],
      });

      for (const batch of batches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
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
    .setTitle("Murder Mystery 2 · live scan")
    .setDescription(
      [
        `Candidate pool: ${Number(result.candidatePoolSize ?? result.candidateCount ?? 0).toLocaleString()}`,
        `Candidates checked: ${Number(result.presenceScannedCount ?? 0).toLocaleString()}`,
        `MM2 active seen: ${result.gameActiveCount ?? 0}`,
        `Verified public-joinable results: ${result.verifiedCount ?? 0}`,
        `Mode: ${result.liveCacheHit ? "MM2 live cache" : result.presenceFallbackUsed ? "public presence fallback" : result.presenceRateLimited ? "rate-limited" : "fresh Roblox presence"}`,
        "Roblox RAP threshold: none",
        `Scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].join("\n"),
    )
    .addFields({
      name: "Sources",
      value:
        "Public candidate discovery + Roblox live presence + public joinability verification. RAP is informational only and does not filter results.",
      inline: false,
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const rap =
      typeof player.rapValue === "number"
        ? `${player.rapValue.toLocaleString()} RAP`
        : "Unavailable";
    const join =
      player.verifiedJoinUrl
        ? `[Verify & join MM2 server](<${player.verifiedJoinUrl}>)`
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
