import {
  getAvatarThumbnail,
  getGameDetails,
  getRobloxBadges,
  getRobloxUserById,
  getUserPresence,
  getUserSocialCounts,
  lookupRobloxUser,
} from "./api.js";
import { getPublicJoinUrl } from "./game-session.js";
import { getInventorySummary } from "./inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import { enrichInventoryWithRolimons } from "../sources/rolimons-items.js";
import { scanGameValue } from "../providers/game-value-providers.js";

const PRESENCE_LABELS = {
  0: "Offline",
  1: "Online",
  2: "In game",
  3: "In Roblox Studio",
};

export async function getRobloxProfile(username) {
  const lookup = await lookupRobloxUser(username);
  if (!lookup) return null;

  const [detailsResult, presenceResult, avatarResult, inventoryResult, rolimonsResult, socialsResult, badgesResult] =
    await Promise.allSettled([
      getRobloxUserById(lookup.id),
      getUserPresence(lookup.id),
      getAvatarThumbnail(lookup.id),
      getInventorySummary(lookup.id),
      getRolimonsPlayerSource(lookup.id),
      getUserSocialCounts(lookup.id),
      getRobloxBadges(lookup.id),
    ]);

  const details = detailsResult.status === "fulfilled" ? detailsResult.value : null;
  const presence = presenceResult.status === "fulfilled" ? presenceResult.value : null;
  const rolimons = rolimonsResult.status === "fulfilled" ? rolimonsResult.value : null;
  const socials = socialsResult.status === "fulfilled" ? socialsResult.value : null;
  const badges = badgesResult.status === "fulfilled" ? badgesResult.value : [];
  const currentGame = await buildCurrentGame(presence);

  let inventory = inventoryResult.status === "fulfilled" ? inventoryResult.value : null;
  if (inventory?.status === "public" && inventory.items.length > 0) {
    try {
      inventory = await enrichInventoryWithRolimons(inventory);
    } catch (error) {
      console.warn(`Could not enrich inventory for Roblox user ${lookup.id}:`, error);
    }
  }

  let gameValue = null;
  try {
    gameValue = await scanGameValue({
      gameName: currentGame?.name,
      userId: lookup.id,
      username: details?.name ?? lookup.name,
    });
  } catch (error) {
    console.warn(`Could not scan game value for Roblox user ${lookup.id}:`, error);
  }

  return {
    id: lookup.id,
    username: details?.name ?? lookup.name ?? "Unavailable",
    displayName: details?.displayName ?? lookup.displayName ?? "Unavailable",
    description: details?.description ?? "",
    created: details?.created ?? null,
    hasVerifiedBadge: details?.hasVerifiedBadge === true,
    isBanned: details?.isBanned === true,
    avatarUrl:
      avatarResult.status === "fulfilled"
        ? avatarResult.value
        : rolimons?.avatarUrl ?? null,
    profileUrl: `https://www.roblox.com/users/${lookup.id}/profile`,
    premiumStatus: rolimons?.premiumStatus ?? "Unavailable",
    presenceStatus:
      PRESENCE_LABELS[presence?.userPresenceType] ??
      rolimons?.presenceStatus ??
      "Unavailable",
    currentGame,
    gameValue,
    lastGame: currentGame?.name ?? rolimons?.lastGame ?? "Unavailable",
    lastOnline: rolimons?.lastOnline ?? null,
    inventory,
    socialCounts: socials,
    badges: normalizeBadges(badges),
    roliBadges: rolimons?.roliBadges ?? null,
    rolimonsTotals: {
      rap: rolimons?.totalRAP ?? null,
      value: rolimons?.totalValue ?? null,
    },
    sources: [
      "Roblox public APIs",
      ...(rolimons ? ["Rolimon's public player info"] : []),
    ],
  };
}

function normalizeBadges(badges) {
  if (!Array.isArray(badges)) return [];
  return badges
    .map((badge) => ({
      id: badge?.id ?? null,
      name: badge?.name ? String(badge.name) : null,
      description: badge?.description ? String(badge.description) : null,
    }))
    .filter((badge) => badge.name)
    .slice(0, 12);
}

async function buildCurrentGame(presence) {
  if (presence?.userPresenceType !== 2) return null;

  let gameName = presence.lastLocation ?? "Unavailable";
  if (presence.universeId) {
    try {
      const game = await getGameDetails(presence.universeId);
      gameName = game?.name ?? gameName;
    } catch (error) {
      console.warn(`Could not load game ${presence.universeId} from Roblox:`, error);
    }
  }

  const placeId = presence.placeId ?? null;
  return {
    name: gameName,
    activityStatus: "In game",
    lastLocation: presence.lastLocation ?? null,
    universeId: presence.universeId ?? null,
    placeId,
    gameId: presence.gameId ?? null,
    gameUrl: placeId ? `https://www.roblox.com/games/start?placeId=${encodeURIComponent(placeId)}` : null,
    joinUrl: await getPublicJoinUrl(presence),
  };
}
