import { isPublicGameInstance } from "./api.js";

const ROBLOX_DEFERRED_LINK_BASE = "https://ro.blox.com/Ebh5";

export function getFollowUserJoinUrl(userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const directAppUrl = `roblox://userId=${encodeURIComponent(normalizedUserId)}`;
  const webFallbackUrl =
    `https://www.roblox.com/users/${encodeURIComponent(normalizedUserId)}/profile`;

  return buildDeferredRobloxLink(directAppUrl, webFallbackUrl);
}

export function getOpenGameUrl(placeId) {
  const normalizedPlaceId = Number(placeId);
  if (!Number.isInteger(normalizedPlaceId) || normalizedPlaceId <= 0) {
    return null;
  }

  // Use the normal experience details page as the browser fallback. Unlike the
  // legacy /games/start route, this remains a valid web destination on mobile.
  return `https://www.roblox.com/games/${encodeURIComponent(normalizedPlaceId)}`;
}

export async function getPublicJoinUrl(presence) {
  if (!presence?.placeId || !presence?.gameId) {
    return null;
  }

  try {
    const isPublic = await isPublicGameInstance(
      presence.placeId,
      presence.gameId,
    );

    if (!isPublic) {
      return null;
    }

    const directAppUrl =
      `roblox://placeId=${encodeURIComponent(presence.placeId)}` +
      `&gameInstanceId=${encodeURIComponent(presence.gameId)}`;
    const webFallbackUrl = getOpenGameUrl(presence.placeId);

    return buildDeferredRobloxLink(directAppUrl, webFallbackUrl);
  } catch (error) {
    console.warn("Could not verify whether the Roblox game instance is public:", error);
    return null;
  }
}

function buildDeferredRobloxLink(directAppUrl, webFallbackUrl) {
  if (!directAppUrl || !webFallbackUrl) return null;

  const params = new URLSearchParams({
    af_dp: directAppUrl,
    af_web_dp: webFallbackUrl,
  });

  return `${ROBLOX_DEFERRED_LINK_BASE}?${params.toString()}`;
}
