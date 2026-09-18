import { isPublicGameInstance } from "./api.js";

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

    return `https://www.roblox.com/games/start?placeId=${encodeURIComponent(
      presence.placeId,
    )}&gameInstanceId=${encodeURIComponent(presence.gameId)}`;
  } catch (error) {
    console.warn("Could not verify whether the Roblox game instance is public:", error);
    return null;
  }
}