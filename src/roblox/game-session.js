import { isPublicGameInstance } from "./api.js";

export function getFollowUserJoinUrl(userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const bridgeBase = getJoinBridgeBaseUrl();
  if (bridgeBase) {
    return `${bridgeBase}/join/user/${encodeURIComponent(normalizedUserId)}`;
  }

  return `https://www.roblox.com/users/${encodeURIComponent(normalizedUserId)}/profile`;
}

export function getGameInstanceJoinUrl(placeId, gameId) {
  const normalizedPlaceId = Number(placeId);
  const normalizedGameId = String(gameId ?? "").trim();

  if (
    !Number.isInteger(normalizedPlaceId) ||
    normalizedPlaceId <= 0 ||
    !normalizedGameId ||
    !/^[A-Za-z0-9-]+$/.test(normalizedGameId)
  ) {
    return null;
  }

  const bridgeBase = getJoinBridgeBaseUrl();
  if (!bridgeBase) {
    return getOpenGameUrl(normalizedPlaceId);
  }

  return (
    `${bridgeBase}/join/server/${encodeURIComponent(normalizedPlaceId)}/` +
    encodeURIComponent(normalizedGameId)
  );
}

export function getOpenGameUrl(placeId) {
  const normalizedPlaceId = Number(placeId);
  if (!Number.isInteger(normalizedPlaceId) || normalizedPlaceId <= 0) {
    return null;
  }

  return `https://www.roblox.com/games/${encodeURIComponent(normalizedPlaceId)}`;
}

export function getOpenGameAppUrl(placeId) {
  const normalizedPlaceId = Number(placeId);
  if (!Number.isInteger(normalizedPlaceId) || normalizedPlaceId <= 0) {
    return null;
  }

  const bridgeBase = getJoinBridgeBaseUrl();
  return bridgeBase
    ? `${bridgeBase}/join/game/${encodeURIComponent(normalizedPlaceId)}`
    : getOpenGameUrl(normalizedPlaceId);
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

    const bridgeBase = getJoinBridgeBaseUrl();
    if (!bridgeBase) {
      return getOpenGameUrl(presence.placeId);
    }

    return (
      `${bridgeBase}/join/server/${encodeURIComponent(presence.placeId)}/` +
      `${encodeURIComponent(presence.gameId)}`
    );
  } catch (error) {
    console.warn(
      "Could not verify whether the Roblox game instance is public:",
      error,
    );
    return null;
  }
}

function getJoinBridgeBaseUrl() {
  const explicit =
    process.env.ROBLOX_JOIN_BRIDGE_BASE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    return `https://${railwayDomain
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "")}`;
  }

  return null;
}
