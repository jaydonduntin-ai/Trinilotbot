import {
  getAvatarThumbnail,
  getGameDetails,
  getRobloxUserById,
  getUsersPresence,
  getAssetOwners,
} from "../roblox/api.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import { getRolimonsItems } from "../sources/rolimons-items.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";

export const DEFAULT_TARGET_RAP = 450_000;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_TARGETS = 7;

const DEFAULT_SEED_ITEM_COUNT = 16;
const DEFAULT_OWNERS_PER_ITEM = 20;
const DEFAULT_MAX_CANDIDATES = 180;
const DEFAULT_MAX_ACTIVE_TO_VERIFY = 60;
const DEFAULT_SEED_MIN_ITEM_RAP = 75_000;
const PRESENCE_BATCH_SIZE = 50;
const OWNER_CONCURRENCY = 4;
const VERIFY_CONCURRENCY = 5;

export async function scanDiscoveredTargets({
  minimumRap = getMinimumTargetRap(),
  limit = DEFAULT_TARGET_COUNT,
} = {}) {
  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );

  const discovery = await discoverCandidateUserIds(minimumRap);
  if (discovery.userIds.length === 0) {
    return {
      minimumRap,
      players: [],
      seedItems: discovery.seedItems,
      candidateCount: 0,
      activeCount: 0,
      verifiedCount: 0,
      sources: discovery.sources,
      skipped: "No owner candidates were returned by the discovery sources.",
    };
  }

  const presences = await getPresenceBatched(discovery.userIds);
  const activePresences = shuffle(
    presences.filter((presence) => Number(presence.userPresenceType) > 0),
  ).slice(
    0,
    getPositiveIntegerEnv(
      "ROBLOX_TARGET_MAX_ACTIVE_TO_VERIFY",
      DEFAULT_MAX_ACTIVE_TO_VERIFY,
    ),
  );

  const verifiedPlayers = [];
  for (let index = 0; index < activePresences.length; index += VERIFY_CONCURRENCY) {
    const batch = activePresences.slice(index, index + VERIFY_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((presence) =>
        buildDiscoveredTargetPlayer(presence, minimumRap).catch((error) => {
          console.warn(
            `Target verification failed for Roblox user ${presence.userId}:`,
            error,
          );
          return null;
        }),
      ),
    );

    for (const player of batchResults) {
      if (player?.qualifies) {
        verifiedPlayers.push(player);
      }
    }

    if (verifiedPlayers.length >= requestedLimit) {
      break;
    }
  }

  const players = shuffle(verifiedPlayers)
    .slice(0, requestedLimit)
    .map(({ qualifies, ...player }) => player);

  return {
    minimumRap,
    players,
    seedItems: discovery.seedItems,
    candidateCount: discovery.userIds.length,
    activeCount: activePresences.length,
    verifiedCount: verifiedPlayers.length,
    sources: [
      ...new Set([
        ...discovery.sources,
        "Roblox public presence",
        "Roblox public collectibles inventory",
        "Rolimon's public player info",
      ]),
    ],
  };
}

async function discoverCandidateUserIds(minimumRap) {
  const dataset = await getRolimonsItems();
  const seedItemCount = getPositiveIntegerEnv(
    "ROBLOX_TARGET_SEED_ITEM_COUNT",
    DEFAULT_SEED_ITEM_COUNT,
  );
  const ownersPerItem = getPositiveIntegerEnv(
    "ROBLOX_TARGET_OWNERS_PER_ITEM",
    DEFAULT_OWNERS_PER_ITEM,
  );
  const maxCandidates = getPositiveIntegerEnv(
    "ROBLOX_TARGET_MAX_CANDIDATES",
    DEFAULT_MAX_CANDIDATES,
  );
  const configuredSeedFloor = getPositiveIntegerEnv(
    "ROBLOX_TARGET_SEED_MIN_ITEM_RAP",
    DEFAULT_SEED_MIN_ITEM_RAP,
  );
  const seedFloor = Math.min(configuredSeedFloor, minimumRap);

  const eligible = dataset.items.filter(
    (item) =>
      Math.max(Number(item.rap) || 0, Number(item.value) || 0) >= seedFloor,
  );

  const fallbackPool = [...dataset.items]
    .sort(
      (left, right) =>
        Math.max(Number(right.value) || 0, Number(right.rap) || 0) -
        Math.max(Number(left.value) || 0, Number(left.rap) || 0),
    )
    .slice(0, Math.max(seedItemCount * 4, 40));

  const seedPool = eligible.length >= seedItemCount ? eligible : fallbackPool;
  const seedItems = shuffle(seedPool).slice(0, seedItemCount);

  const ownerResults = await mapWithConcurrency(
    seedItems,
    OWNER_CONCURRENCY,
    async (item) => {
      try {
        const result = await getAssetOwners(item.id, { limit: ownersPerItem });
        return { item, owners: result.owners };
      } catch (error) {
        console.warn(
          `Owner discovery failed for ${item.name} (${item.id}):`,
          error,
        );
        return { item, owners: [] };
      }
    },
  );

  const userIds = [];
  const seen = new Set();
  for (const result of shuffle(ownerResults)) {
    for (const owner of shuffle(result.owners)) {
      const userId = Number(owner.userId);
      if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
        continue;
      }
      seen.add(userId);
      userIds.push(userId);
      if (userIds.length >= maxCandidates) break;
    }
    if (userIds.length >= maxCandidates) break;
  }

  return {
    userIds: shuffle(userIds),
    seedItems: seedItems.map((item) => ({
      id: item.id,
      name: item.name,
      rap: item.rap,
      value: item.value,
    })),
    sources: [
      `Rolimon's limited catalog (${dataset.sourceUrl ?? "public API"})`,
      process.env.ROBLOX_OWNER_USE_COOKIE === "true" &&
      process.env.ROBLOX_SESSION_COOKIE
        ? "Roblox asset owners (authenticated cookie first, public fallback)"
        : "Roblox public asset owners",
    ],
  };
}

async function buildDiscoveredTargetPlayer(presence, minimumRap) {
  const userId = Number(presence.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  const [userResult, avatarResult, inventoryResult, rolimonsResult] =
    await Promise.allSettled([
      getRobloxUserById(userId),
      getAvatarThumbnail(userId),
      getInventorySummary(userId),
      getRolimonsPlayerSource(userId),
    ]);

  const user = userResult.status === "fulfilled" ? userResult.value : null;
  if (!user) return null;

  const inventory =
    inventoryResult.status === "fulfilled" ? inventoryResult.value : null;
  const rolimons =
    rolimonsResult.status === "fulfilled" ? rolimonsResult.value : null;

  const { rapValue, rapSource, rapIsPartial } = chooseRapSource(
    inventory,
    rolimons,
  );

  if (typeof rapValue !== "number" || rapValue < minimumRap) {
    return {
      qualifies: false,
      id: userId,
    };
  }

  let gameName = presence.lastLocation ?? "Online";
  if (presence.universeId) {
    try {
      const game = await getGameDetails(presence.universeId);
      gameName = game?.name ?? gameName;
    } catch (error) {
      console.warn(`Could not load target game ${presence.universeId}:`, error);
    }
  }

  const gameValueResult = await Promise.allSettled([
    scanGameValue({
      gameName,
      userId,
      username: user.name,
    }),
  ]);
  const gameValue =
    gameValueResult[0].status === "fulfilled"
      ? gameValueResult[0].value
      : null;

  return {
    qualifies: true,
    id: userId,
    username: user.name ?? "Unavailable",
    displayName: user.displayName ?? "Unavailable",
    avatarUrl:
      avatarResult.status === "fulfilled" ? avatarResult.value : null,
    profileUrl: `https://www.roblox.com/users/${userId}/profile`,
    rolimonsUrl: getRolimonsProfileUrl(userId),
    presenceStatus: getPresenceStatus(presence.userPresenceType),
    gameName,
    rapValue,
    rapSource,
    rapIsPartial,
    totalValue:
      typeof rolimons?.totalValue === "number" ? rolimons.totalValue : null,
    premiumStatus: rolimons?.premiumStatus ?? "Unavailable",
    gameValue,
    topLimiteds: getTopLimiteds(inventory),
  };
}

function chooseRapSource(inventory, rolimons) {
  const officialRap =
    inventory?.status === "public" && typeof inventory.totalRAP === "number"
      ? inventory.totalRAP
      : null;
  const rolimonsRap =
    typeof rolimons?.totalRAP === "number" ? rolimons.totalRAP : null;

  if (officialRap !== null && inventory?.hasMore !== true) {
    return {
      rapValue: officialRap,
      rapSource: "Roblox public collectibles inventory",
      rapIsPartial: false,
    };
  }

  if (rolimonsRap !== null) {
    return {
      rapValue: rolimonsRap,
      rapSource:
        officialRap !== null
          ? "Rolimon's total RAP (Roblox inventory was partial)"
          : "Rolimon's public player info",
      rapIsPartial: false,
    };
  }

  if (officialRap !== null) {
    return {
      rapValue: officialRap,
      rapSource: "Roblox public collectibles inventory",
      rapIsPartial: inventory?.hasMore === true,
    };
  }

  return {
    rapValue: null,
    rapSource: "Unavailable",
    rapIsPartial: false,
  };
}

function getTopLimiteds(inventory) {
  if (!Array.isArray(inventory?.items) || inventory.items.length === 0) {
    return [];
  }

  return [...inventory.items]
    .sort(
      (left, right) =>
        Number(right.recentAveragePrice || 0) -
        Number(left.recentAveragePrice || 0),
    )
    .slice(0, 3)
    .map((item) => ({
      assetId: item.assetId,
      name: item.name,
      rap: Number(item.recentAveragePrice) || 0,
    }));
}

async function getPresenceBatched(userIds) {
  const results = [];
  for (let index = 0; index < userIds.length; index += PRESENCE_BATCH_SIZE) {
    const batch = userIds.slice(index, index + PRESENCE_BATCH_SIZE);
    try {
      const presences = await getUsersPresence(batch);
      results.push(...presences);
    } catch (error) {
      console.warn("Roblox presence batch failed:", error);
    }
  }
  return results;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, items.length)) },
      worker,
    ),
  );
  return results;
}

function getPresenceStatus(type) {
  return {
    0: "Offline",
    1: "Online",
    2: "In game",
    3: "In Roblox Studio",
  }[Number(type)] ?? "Active";
}

function getMinimumTargetRap() {
  return getPositiveIntegerEnv("ROBLOX_TARGET_MIN_RAP", DEFAULT_TARGET_RAP);
}

function getPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function shuffle(values) {
  const array = [...values];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}
