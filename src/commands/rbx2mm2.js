import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  MAX_TARGETS,
  scanMm2RapActivity,
} from "../monitoring/target-scanner.js";

const MM2_SESSION_TIME_BUDGET_MS = 165_000;

export const rbx2mm2Command = {
  definition: new SlashCommandBuilder()
    .setName("rbx2mm2")
    .setDescription(
      "Find public-joinable players currently active in Murder Mystery 2. No RAP minimum.",
    ),

  async execute(interaction) {
    await interaction.deferReply();
    await interaction.editReply(
      "Scanning the target pool for active Murder Mystery 2 players…",
    );

    try {
      const result = await scanMm2TargetSession();
      const embeds = buildTargetEmbeds(result);
      const batches = batchEmbedsForDiscord(embeds);

      await interaction.editReply({
        content:
          result.players.length > 0
            ? `Found ${result.players.length} public-joinable Murder Mystery 2 player${result.players.length === 1 ? "" : "s"}. No RAP minimum or fixed result-count cap is applied.`
            : result.presenceRateLimited
              ? `Roblox rate-limited this live scan after checking ${Number(result.presenceScannedCount ?? 0).toLocaleString()} candidates. This pass was cut short, so 0 returned does not mean there are no active MM2 players.`
              : "No current public-joinable Murder Mystery 2 player was verified in this pass.",
        embeds: batches[0] ?? [],
      });

      for (const batch of batches.slice(1)) {
        await interaction.followUp({ embeds: batch });
      }

      console.info(
        `/rbx2mm2 diagnostic: passes=${result.passCount} · pool=${result.candidatePoolSize} · presenceChecked=${result.presenceScannedCount} · mm2Active=${result.gameActiveCount} · returned=${result.players.length} · rateLimited=${result.presenceRateLimited === true}`,
      );
    } catch (error) {
      console.error("/rbx2mm2 failed:", error);
      await interaction.editReply(
        "MM2 target discovery is temporarily unavailable. Try again in a moment.",
      );
    }
  },
};

async function scanMm2TargetSession() {
  const startedAt = Date.now();
  const playersById = new Map();
  const sources = new Set();
  let candidatePoolSize = 0;
  let candidateCount = 0;
  let presenceScannedCount = 0;
  let gameActiveCount = 0;
  let nonPublicServerCount = 0;
  let publicServerVerificationErrorCount = 0;
  let presenceRateLimited = false;
  let presenceFallbackUsed = false;
  let liveCacheHit = false;
  let passCount = 0;

  while (Date.now() - startedAt < MM2_SESSION_TIME_BUDGET_MS) {
    const pass = await scanMm2RapActivity({
      minimumRap: null,
      // MAX_TARGETS is only the scanner page size here. The command aggregates
      // unique MM2 results across passes and has no user-facing result cap.
      limit: MAX_TARGETS,
    });
    passCount += 1;

    candidatePoolSize = Math.max(
      candidatePoolSize,
      Number(pass.candidatePoolSize ?? 0),
    );
    candidateCount += Number(pass.candidateCount ?? 0);
    presenceScannedCount += Number(pass.presenceScannedCount ?? 0);
    gameActiveCount += Number(pass.gameActiveCount ?? pass.activeCount ?? 0);
    nonPublicServerCount += Number(pass.nonPublicServerCount ?? 0);
    publicServerVerificationErrorCount += Number(
      pass.publicServerVerificationErrorCount ?? 0,
    );
    presenceRateLimited =
      presenceRateLimited || pass.presenceRateLimited === true;
    presenceFallbackUsed =
      presenceFallbackUsed || pass.presenceFallbackUsed === true;
    liveCacheHit = liveCacheHit || pass.liveCacheHit === true;
    for (const source of pass.sources ?? []) sources.add(source);

    let newlyAdded = 0;
    for (const player of pass.players ?? []) {
      const key =
        Number(player?.id ?? player?.userId) ||
        String(player?.username ?? "").toLowerCase();
      if (!key || playersById.has(key)) continue;
      playersById.set(key, player);
      newlyAdded += 1;
    }

    // A short page means this pass did not hit the scanner page boundary.
    // A duplicate-only pass means another pass would just recycle the same
    // live set. Rate limiting also ends the session cleanly.
    if ((pass.players?.length ?? 0) < MAX_TARGETS) break;
    if (newlyAdded === 0) break;
    if (pass.presenceRateLimited && !pass.presenceFallbackUsed) break;
  }

  return {
    players: [...playersById.values()],
    candidatePoolSize,
    candidateCount,
    presenceScannedCount,
    gameActiveCount,
    verifiedCount: playersById.size,
    nonPublicServerCount,
    publicServerVerificationErrorCount,
    presenceRateLimited,
    presenceFallbackUsed,
    liveCacheHit,
    passCount,
    scanElapsedMs: Date.now() - startedAt,
    sources: [...sources],
  };
}

function buildTargetEmbeds(result) {
  const summary = new EmbedBuilder()
    .setColor(result.players.length > 0 ? 0x57f287 : 0x2f3136)
    .setTitle("Murder Mystery 2 · target scan")
    .setDescription(
      [
        `Candidate pool: ${Number(result.candidatePoolSize ?? 0).toLocaleString()}`,
        `Candidates checked: ${Number(result.presenceScannedCount ?? 0).toLocaleString()}`,
        `MM2 active seen: ${Number(result.gameActiveCount ?? 0).toLocaleString()}`,
        `Public-joinable returned: ${result.players.length}`,
        `Passes: ${result.passCount ?? 1}`,
        `Presence mode: ${result.liveCacheHit ? "live cache" : result.presenceFallbackUsed ? "public fallback" : result.presenceRateLimited ? "rate-limited" : "fresh"}`,
        "Roblox RAP threshold: none",
        "Result-count cap: none",
        `Live scan: ${Math.round((result.scanElapsedMs ?? 0) / 1000)}s`,
      ].join("\n"),
    )
    .addFields({
      name: "Discovery source",
      value:
        "Same public candidate pool and live-verification model as /target, filtered to active Murder Mystery 2 sessions only.",
      inline: false,
    })
    .setFooter({
      text: "/rbx2mm2 only displays players verified in Murder Mystery 2 with a public joinable server.",
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
    const links = [
      player.profileUrl ? `[Roblox profile](${player.profileUrl})` : null,
      player.rolimonsUrl ? `[Rolimon's](${player.rolimonsUrl})` : null,
    ].filter(Boolean).join(" · ");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${player.displayName} (@${player.username})`)
      .setDescription(links || "Murder Mystery 2 — In Game")
      .addFields(
        { name: "RAP", value: rap, inline: true },
        { name: "Value", value, inline: true },
        {
          name: "Presence",
          value: player.presenceStatus ?? "In game",
          inline: true,
        },
        {
          name: "Current game",
          value: player.gameName ?? "Murder Mystery 2",
          inline: true,
        },
        {
          name: "Join",
          value: formatTargetJoin(player),
          inline: false,
        },
        {
          name: "Source",
          value: truncate(
            player.rapSource ?? player.valueSource ?? "Public data",
            180,
          ),
          inline: false,
        },
      );

    if (player.profileUrl) embed.setURL(player.profileUrl);
    if (player.avatarUrl) embed.setThumbnail(player.avatarUrl);
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

  return [status, links.join(" · "), ids.join(" · ")]
    .filter(Boolean)
    .join("\n");
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

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
