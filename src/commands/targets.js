import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  MAX_TARGETS,
  MAX_TARGET_THRESHOLD,
  scanDiscoveredTargets,
} from "../monitoring/target-scanner.js";
import { createTargetAssociationQualifier } from "./target-associations.js";

const TARGET_DEFAULT_LIMIT = 50;
const TARGET_DEFAULT_MIN_RAP = 5_000;

export const targetsCommand = {
  definition: new SlashCommandBuilder()
    .setName("target")
    .setDescription(
      "Find high-RAP users currently active in any Roblox game.",
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription(
          `RAP floor: ${TARGET_DEFAULT_MIN_RAP.toLocaleString()}–${MAX_TARGET_THRESHOLD.toLocaleString()}; default ${TARGET_DEFAULT_MIN_RAP.toLocaleString()}.`,
        )
        .setMinValue(TARGET_DEFAULT_MIN_RAP)
        .setMaxValue(MAX_TARGET_THRESHOLD),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Results to return, default ${TARGET_DEFAULT_LIMIT}, max ${MAX_TARGETS}.`,
        )
        .setMinValue(1)
        .setMaxValue(MAX_TARGETS),
    ),

  async execute(interaction) {
    const minimumRapOption =
      interaction.options.getInteger("min_rap");
    const limit =
      interaction.options.getInteger("limit") ?? TARGET_DEFAULT_LIMIT;

    // /target qualifies by RAP only. Value is informational when available.
    const minimumValue = null;
    const minimumRap = minimumRapOption ?? TARGET_DEFAULT_MIN_RAP;

    await interaction.deferReply();

    try {
      const result = await scanDiscoveredTargets({
        minimumValue,
        minimumRap,
        limit,
        qualifyPlayer: createTargetAssociationQualifier({
          guildId: interaction.guildId,
          client: interaction.client,
        }),
      });
      result.players = result.players ?? [];
      result.requestedLimit = limit;
      result.discordVerifiedCount = result.players.length;

      console.info(
        `/target diagnostic: pool=${result.candidatePoolSize ?? 0} · candidates=${result.candidateCount ?? 0} · presenceChecked=${result.presenceScannedCount ?? 0} · inGame=${result.activeCount ?? 0} · prePublicVerified=${result.preRecheckVerifiedCount ?? 0} · publicJoinable=${result.players.length} · hiddenNonPublic=${result.nonPublicServerCount ?? 0} · publicVerifyErrors=${result.publicServerVerificationErrorCount ?? 0} · rateLimited=${result.presenceRateLimited === true}`,
      );

      const embeds = buildTargetEmbeds(result);
      const embedBatches = batchEmbedsForDiscord(embeds);
      const content =
        result.players.length > 0
          ? result.usedCachedPresenceFallback
            ? `Found ${result.players.length} recently verified in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)}. Roblox is rate-limiting fresh presence checks, so these are from the recent live cache.`
            : result.presenceFallbackUsed
              ? `Found ${result.players.length} currently in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)} using the public presence fallback.`
              : `Found ${result.players.length} currently in-game public profile${result.players.length === 1 ? "" : "s"} matching ${formatThresholds(result)}.`
          : result.presenceRateLimited && !result.presenceFallbackUsed
            ? "Roblox is rate-limiting live presence checks right now, and no usable fallback/cache result was available for this pass."
            : `No currently in-game public profile matching ${formatThresholds(result)} was verified in this discovery pass.`;

      await interaction.editReply({
        content,
        embeds: embedBatches[0] ?? [],
      });

      for (const batch of embedBatches.slice(1)) {
        await interaction.followUp({
          embeds: batch,
        });
      }

      // Candidate discovery/pool warmup is handled independently in the
      // background. Do not start a second scan after /target; that competed
      // for Roblox presence capacity and made the next interactive request
      // more likely to hit rate limits.
      console.info(
        "/target completed without post-command expansion; background candidate pool remains independent.",
      );
    } catch (error) {
      console.error("Automatic target discovery failed:", error);
      await interaction.editReply(
        "Automatic target discovery is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

function buildTargetEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Automatic Roblox discovery")
    .setDescription(
      [
        `Verified ${Number(result.minimumRap ?? TARGET_DEFAULT_MIN_RAP).toLocaleString()}+ RAP index: ${result.verifiedIndexCount ?? 0}`,
        `Live cache: ${result.liveCacheSize ?? 0} · Cache hit: ${result.liveCacheHit ? "Yes" : "No"}`,
        result.usedCachedPresenceFallback
          ? "Presence mode: recent cache (Roblox rate-limited)"
          : result.presenceFallbackUsed
            ? "Presence mode: public fallback"
            : result.presenceRateLimited
              ? "Presence mode: rate-limited"
              : "Presence mode: fresh",
        `Candidates: ${result.candidateCount ?? 0} · Presence checked: ${result.presenceScannedCount ?? result.freshCandidateCount ?? 0}`,
        `In-game seen: ${result.activeCount ?? 0} · Verified live: ${result.verifiedCount ?? 0}`,
        `Requested: ${result.requestedLimit ?? result.players.length} · Discord-verified returned: ${result.players.length}`,
        formatGameCoverageSummary(result.players),
        `Public-joinable returned: ${result.joinReadyCount ?? 0} · Hidden non-public/stale: ${result.nonPublicServerCount ?? 0}`,
        `Live scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
        result.minimumValue !== null && result.minimumValue !== undefined
          ? `Value threshold: ${result.minimumValue.toLocaleString()}`
          : null,
        result.minimumRap !== null && result.minimumRap !== undefined
          ? `RAP threshold: ${result.minimumRap.toLocaleString()}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .addFields({
      name: "Discovery source",
      value:
        "Public Roblox presence + public RAP sources; value is informational. " +
        (truncate((result.sources ?? []).join(" · "), 450) || "Unavailable"),
      inline: false,
    })
    .setFooter({
      text: "/target searches all Roblox games and requires a public joinable server before display.",
    })
    .setTimestamp();

  const players = result.players.map((player) => {
    const rap =
      typeof player.rapValue === "number"
        ? `${player.rapIsPartial ? "At least " : ""}${player.rapValue.toLocaleString()} RAP`
        : "Unavailable";
    const value =
      typeof player.totalValue === "number"
        ? player.totalValue.toLocaleString()
        : "Unavailable";
    const limiteds =
      player.topLimiteds?.length > 0
        ? player.topLimiteds
            .map(
              (item) =>
                `[${escapeMarkdown(item.name)}](https://www.rolimons.com/item/${item.assetId}) — ${item.rap.toLocaleString()} RAP`,
            )
            .join("\n")
        : "Unavailable";

    const discord = player.discordAssociation
      ? formatDiscordAssociation(player.discordAssociation)
      : "Unavailable";

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setURL(player.profileUrl)
      .setDescription(
        `[Roblox profile](${player.profileUrl}) · [Rolimon's](${player.rolimonsUrl})`,
      )
      .addFields(
        { name: "RAP", value: rap, inline: true },
        { name: "Value", value, inline: true },
        { name: "Presence", value: player.presenceStatus, inline: true },
        { name: "Discord", value: discord, inline: false },
        {
          name: "Current game",
          value: player.gameName ?? "Unavailable",
          inline: true,
        },
        {
          name: "Join",
          value: formatTargetJoin(player),
          inline: false,
        },
        {
          name: "Source",
          value: truncate(player.rapSource ?? player.valueSource ?? "Public data", 180),
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

function formatTargetJoin(player) {
  const links = [];

  if (player.verifiedJoinUrl) {
    links.push(`[Verify & join current server](<${player.verifiedJoinUrl}>)`);
  }
  if (player.profileUrl) {
    links.push(`[Open profile](<${player.profileUrl}>)`);
  }

  const ids = [];
  if (player.placeId) ids.push(`Place: \`${player.placeId}\``);
  if (player.gameId) ids.push(`Job: \`${player.gameId}\``);

  const status = player.verifiedJoinUrl
    ? "Server is rechecked for public access when you tap Join"
    : "Join unavailable";

  return [
    status,
    links.join(" · "),
    ids.join(" · "),
  ].filter(Boolean).join("\n");
}

function formatGameCoverageSummary(players) {
  const counts = new Map();
  for (const player of players ?? []) {
    const label = player?.gameName ?? "Unknown game";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return "Games: 0 returned";
  }

  const breakdown = [...counts.entries()]
    .slice(0, 8)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
  return `Games: ${players.length} returned · ${breakdown}`;
}

function formatThresholds(result) {
  const parts = [];
  if (result.minimumValue !== null && result.minimumValue !== undefined) {
    parts.push(`${result.minimumValue.toLocaleString()}+ value`);
  }
  if (result.minimumRap !== null && result.minimumRap !== undefined) {
    parts.push(`${result.minimumRap.toLocaleString()}+ RAP`);
  }
  return parts.length > 0 ? parts.join(" and ") : "the configured thresholds";
}

function batchEmbedsForDiscord(embeds) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const chars = countEmbedCharacters(embed);

    if (
      current.length > 0 &&
      (current.length >= 10 || currentChars + chars > 5_500)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(embed);
    currentChars += chars;
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
  total += String(data.author?.name ?? "").length;

  for (const field of data.fields ?? []) {
    total += String(field?.name ?? "").length;
    total += String(field?.value ?? "").length;
  }

  return total;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}


function formatDiscordAssociation(association) {
  const label = association.discordGlobalName
    ? `${association.discordGlobalName}${association.discordUsername ? ` (@${association.discordUsername})` : ""}`
    : association.discordUsername
      ? `@${association.discordUsername}`
      : association.discordId
        ? `<@${association.discordId}>`
        : "Verified Discord";
  const evidence = association.evidenceUrl ? `\nEvidence: ${association.evidenceUrl}` : "";
  return `${label}\nSource: ${association.source ?? "Verified association source"}${evidence}`;
}
