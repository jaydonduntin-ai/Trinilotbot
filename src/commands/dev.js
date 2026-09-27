import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  getGameDetails,
} from "../roblox/api.js";
import {
  MAX_TARGETS,
  scanDeveloperTargets,
} from "../monitoring/target-scanner.js";

const DEV_DEFAULT_LIMIT = 10;
const DEV_MAX_LIMIT = Math.min(MAX_TARGETS, 25);
const DEV_DEFAULT_MIN_RAP = 5_000;
const DEV_DEFAULT_MIN_VISITS = 100_000;

export const devCommand = {
  definition: new SlashCommandBuilder()
    .setName("dev")
    .setDescription(
      "Find in-game Roblox developers with 5K+ RAP and a 100K+ visit owned experience.",
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(
          `Developer results to return; default ${DEV_DEFAULT_LIMIT}, max ${DEV_MAX_LIMIT}.`,
        )
        .setMinValue(1)
        .setMaxValue(DEV_MAX_LIMIT),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_rap")
        .setDescription("Minimum Roblox RAP; default 5,000.")
        .setMinValue(5_000)
        .setMaxValue(2_500_000_000),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_visits")
        .setDescription("Minimum lifetime visits on an owned experience; default 100,000.")
        .setMinValue(100_000)
        .setMaxValue(10_000_000_000),
    ),

  async execute(interaction) {
    const limit = interaction.options.getInteger("limit") ?? DEV_DEFAULT_LIMIT;
    const minimumRap =
      interaction.options.getInteger("min_rap") ?? DEV_DEFAULT_MIN_RAP;
    const minimumVisits =
      interaction.options.getInteger("min_visits") ?? DEV_DEFAULT_MIN_VISITS;

    await interaction.deferReply();

    try {
      // Oversample because /dev now rejects weak/cached creator labels and
      // experiences that do not meet the requested live-player floor.
      const scanLimit = Math.min(MAX_TARGETS, Math.max(limit * 3, limit));
      const result = await scanDeveloperTargets({
        minimumValue: null,
        minimumRap,
        limit: scanLimit,
      });

      const verifiedPlayers = await verifyDeveloperGameTraffic(
        result.players,
        minimumVisits,
        limit,
      );

      const summary = new EmbedBuilder()
        .setColor(verifiedPlayers.length > 0 ? 0x57f287 : 0x2f3136)
        .setTitle("Roblox developer discovery")
        .setDescription(
          [
            `Observed active experiences: ${result.observedGames ?? 0}`,
            `Creator accounts resolved: ${result.developerCandidates ?? 0}`,
            `Developer presence checks: ${result.presenceChecked ?? 0}`,
            `In-game creator candidates: ${result.inGameDeveloperCandidates ?? 0}`,
            `Verified creators with ${formatNumber(minimumVisits)}+ lifetime visits: ${verifiedPlayers.length}`,
            `Hidden non-public/stale: ${result.nonPublicServerCount ?? 0}`,
            result.presenceFallbackUsed
              ? "Presence mode: public fallback used"
              : result.presenceRateLimited
                ? "Presence mode: rate-limited"
                : "Presence mode: fresh",
          ].join("\n"),
        )
        .setFooter({
          text: "Group ownership alone never qualifies; each result must map to an active creator-owned experience.",
        })
        .setTimestamp();

      const embeds = [
        summary,
        ...verifiedPlayers.map((player) => buildDeveloperEmbed(player)),
      ];

      await interaction.editReply({
        content:
          verifiedPlayers.length > 0
            ? `Found ${verifiedPlayers.length} Roblox developer${verifiedPlayers.length === 1 ? "" : "s"} with 5K+ RAP and an owned experience at ${formatNumber(minimumVisits)}+ lifetime visits.`
            : `No creator met the in-game, RAP, ownership, and visit requirements in this pass.`,
        embeds: embeds.slice(0, 10),
      });

      for (let index = 10; index < embeds.length; index += 10) {
        await interaction.followUp({
          embeds: embeds.slice(index, index + 10),
        });
      }
    } catch (error) {
      console.error("Developer discovery failed:", error);
      await interaction.editReply(
        "Developer discovery is temporarily unavailable. Try again shortly.",
      );
    }
  },
};

async function verifyDeveloperGameTraffic(players, minimumVisits, limit) {
  const input = Array.isArray(players) ? players : [];
  const gamePromises = new Map();

  const loadGame = (universeId) => {
    const id = Number(universeId);
    if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
    if (!gamePromises.has(id)) {
      gamePromises.set(id, getGameDetails(id).catch(() => null));
    }
    return gamePromises.get(id);
  };

  const verified = [];

  for (const player of input) {
    const concreteEvidence = (player?.developerEvidence ?? []).filter(
      (entry) =>
        entry?.kind === "experience-creator" ||
        entry?.kind === "creator-group-owner",
    );

    if (concreteEvidence.length === 0) continue;

    const enrichedEvidence = [];
    for (const evidence of concreteEvidence) {
      const game = await loadGame(evidence.universeId);
      const playing = Number(game?.playing);
      const visits = Number(game?.visits);
      if (!Number.isFinite(visits) || visits < minimumVisits) continue;

      enrichedEvidence.push({
        ...evidence,
        gameName: game?.name ?? evidence.gameName,
        playing,
        visits: Number.isFinite(visits) ? visits : null,
        rootPlaceId: Number.isInteger(Number(game?.rootPlaceId))
          ? Number(game.rootPlaceId)
          : null,
      });
    }

    if (enrichedEvidence.length === 0) continue;

    const highestPlayers = Math.max(
      ...enrichedEvidence.map((entry) => Number(entry.playing) || 0),
    );
    const highestVisits = Math.max(
      ...enrichedEvidence.map((entry) => Number(entry.visits) || 0),
    );

    verified.push({
      ...player,
      developerEvidence: enrichedEvidence,
      developerGamePlayers: highestPlayers,
      developerGameVisits: highestVisits,
    });
  }

  return verified
    .sort(
      (left, right) =>
        Number(right.developerGameVisits ?? 0) -
        Number(left.developerGameVisits ?? 0),
    )
    .slice(0, limit);
}

function buildDeveloperEmbed(player) {
  const evidence = (player.developerEvidence ?? [])
    .map((entry) => {
      const gameLabel = entry.rootPlaceId
        ? `[${entry.gameName}](https://www.roblox.com/games/${entry.rootPlaceId})`
        : entry.gameName;
      const traffic = `${formatNumber(entry.playing)} playing${entry.visits !== null ? ` · ${formatNumber(entry.visits)} visits` : ""}`;

      if (entry.kind === "experience-creator") {
        return `Direct creator · ${gameLabel} · ${traffic}`;
      }
      return `Group-owned experience · ${entry.groupName ?? entry.groupId ?? "group"} · ${gameLabel} · ${traffic}`;
    })
    .join("\n") || "No qualifying creator evidence";

  const join = player.verifiedJoinUrl
    ? `[Join current public server](<${player.verifiedJoinUrl}>)`
    : "Not currently verified as joinable";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${player.displayName ?? player.username} (@${player.username})`)
    .setURL(player.profileUrl)
    .addFields(
      {
        name: "Creator evidence",
        value: truncate(evidence, 1000),
        inline: false,
      },
      {
        name: "Current creator activity",
        value: `${formatNumber(player.developerGameVisits ?? 0)} lifetime visits on strongest qualifying experience`,
        inline: false,
      },
      {
        name: "Developer presence",
        value: player.gameName ?? "Not currently resolved",
        inline: true,
      },
      {
        name: "Join developer",
        value: join,
        inline: false,
      },
    );

  if (player.avatarUrl) {
    embed.setThumbnail(player.avatarUrl);
  }
  return embed;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("en-US") : "0";
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
