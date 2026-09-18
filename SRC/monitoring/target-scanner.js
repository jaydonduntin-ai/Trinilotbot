import {
  getAvatarThumbnail,
  getGameDetails,
  getUsersPresence,
  lookupRobloxUsers,
} from "../roblox/api.js";
import { getPublicJoinUrl } from "../roblox/game-session.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";

export const DEFAULT_TARGET_RAP = 450_000;
export const MAX_TARGETS = 7;

export async function scanConfiguredTargets({
  usernames = getConfiguredTargetUsernames(),
  minimumRap = getMinimumTargetRap(),
  limit = MAX_TARGETS,
} = {}) {
  const normalizedUsernames = normalizeUsernames(usernames).slice(0, 50);

  if (normalizedUsernames.length === 0) {
    return {
      usernames: [],
      minimumRap,
      players: [],
      skipped: "No usernames were configured.",
    };
  }

  const users = await lookupRobloxUsers(normalizedUsernames);
  const presences = await getUsersPresence(users.map((user) => user.id));
  const presenceByUserId = new Map(
    presences.map((presence) => [Number(presence.userId), presence]),
  );

  const activeUsers = users.filter(
    (user) =>
      (presenceByUserId.get(Number(user.id))?.userPresenceType ?? 0) > 0,
  );
  const players = await Promise.all(
    activeUsers.map((user) =>
      buildTargetPlayer(user, presenceByUserId.get(Number(user.id))),
    ),
  );

  return {
    usernames: normalizedUsernames,
    minimumRap,
    players: players
      .filter(
        (player) =>
          typeof player.rapValue === "number" &&
          player.rapValue >= minimumRap &&
          player.joinUrl,
      )
      .sort((left, right) => right.rapValue - left.rapValue)
      .slice(0, Math.min(MAX_TARGETS, Math.max(1, limit))),
    activeCount: activeUsers.length,
  };
}

export function getConfiguredTargetUsernames() {
  return normalizeUsernames(
    process.env.ROBLOX_TARGET_USERNAMES ??
      process.env.ROBLOX_MONITOR_USERNAMES ??
      "",
  );
}

export function getMinimumTargetRap() {
  const value = Number(process.env.ROBLOX_TARGET_MIN_RAP);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TARGET_RAP;
}

async function buildTargetPlayer(user, presence) {
  let gameName = presence.lastLocation ?? "Unavailable";
  if (presence.universeId) {
    try {
      const game = await getGameDetails(presence.universeId);
      gameName = game?.name ?? gameName;
    } catch (error) {
      console.warn(`Could not load target game ${presence.universeId}:`, error);
    }
  }

  const [avatarResult, inventoryResult, rolimonsResult, gameValueResult] =
    await Promise.allSettled([
      getAvatarThumbnail(user.id),
      getInventorySummary(user.id),
      getRolimonsPlayerSource(user.id),
      scanGameValue({
        gameName,
        userId: user.id,
        username: user.name,
      }),
    ]);
  const officialInventory =
    inventoryResult.status === "fulfilled" ? inventoryResult.value : null;
  const rolimons =
    rolimonsResult.status === "fulfilled" ? rolimonsResult.value : null;
  const inventory = officialInventory;

  return {
    id: user.id,
    username: user.name ?? "Unavailable",
    displayName: user.displayName ?? "Unavailable",
    avatarUrl: avatarResult.status === "fulfilled" ? avatarResult.value : null,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile`,
    premiumStatus: rolimons?.premiumStatus ?? "Unavailable",
    presenceStatus: rolimons?.presenceStatus ?? "Online",
    gameName,
    placeId: presence.placeId ?? null,
    gameId: presence.gameId ?? null,
    joinUrl: await getPublicJoinUrl(presence),
    rapValue: inventory?.totalRAP ?? rolimons?.totalRAP ?? null,
    rapIsPartial: inventory?.hasMore ?? false,
    totalValue: inventory?.totalValue ?? rolimons?.totalValue ?? null,
    gameValue:
      gameValueResult.status === "fulfilled" ? gameValueResult.value : null,
    rolimonsUrl: getRolimonsProfileUrl(user.id),
  };
}

function normalizeUsernames(usernames) {
  return [
    ...new Set(
      (Array.isArray(usernames) ? usernames : String(usernames).split(","))
        .map((username) => String(username).trim())
        .filter(Boolean),
    ),
  ];
}
