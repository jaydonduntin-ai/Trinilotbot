import {
  getAvatarThumbnail,
  getAssetOwners,
  getGameDetails,
  getRobloxUserById,
  getUsersPresence,
} from "../roblox/api.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import { getRolimonsItems } from "../sources/rolimons-items.js";
import { getRecentTradeAdPlayers } from "../sources/rolimons-trade-ads.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";

export const DEFAULT_TARGET_RAP = 450_000;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_TARGETS = 7;

const DEFAULT_SEED_ITEM_COUNT = 12;
const DEFAULT_OWNERS_PER_ITEM = 20;
const DEFAULT_MAX_CANDIDATES = 350;
const DEFAULT_MAX_ACTIVE_TO_VERIFY = 120;
const DEFAULT_POOL_MAX_SIZE = 2_000;
const DEFAULT_POOL_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RECENT_CHECK_COOLDOWN_MS = 15 * 60 * 1000;

const candidatePool = new Map();
const DEFAULT_SEED_MIN_ITEM_RAP = 75_000;
const PRESENCE_BATCH_SIZE = 50;
const OWNER_CONCURRENCY = 4;
const VERIFY_CONCURRENCY = 5;
const OWNER_DISCOVERY_BUDGET_MS = 12_000;

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
      candidateSourceCounts: discovery.candidateSourceCounts,
      candidatePoolSize: discovery.candidatePoolSize,
      freshCandidateCount: discovery.freshCandidateCount,
      recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
      activeCount: 0,
      verifiedCount: 0,
      sources: discovery.sources,
      skipped: "No candidates were returned by the discovery sources.",
    };
  }

  const presenceScan = await getPresenceBatched(discovery.userIds);
  markCandidatesChecked(presenceScan.checkedIds);

  const activePresences = shuffle(
    presenceScan.presences.filter(
      (presence) => Number(presence.userPresenceType) > 0,
    ),
  ).slice(
    0,
    getPositiveIntegerEnv(
      "ROBLOX_TARGET_MAX_ACTIVE_TO_VERIFY",
      DEFAULT_MAX_ACTIVE_TO_VERIFY,
    ),
  );

  const verifiedPlayers = [];
  for (
    let index = 0;
    index < activePresences.length;
    index += VERIFY_CONCURRENCY
  ) {
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
    candidateSourceCounts: discovery.candidateSourceCounts,
    candidatePoolSize: discovery.candidatePoolSize,
    freshCandidateCount: discovery.freshCandidateCount,
    recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
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

  const [tradeAdsResult, itemCatalogResult] = await Promise.allSettled([
    getRecentTradeAdPlayers(),
    getRolimonsItems(),
  ]);

  const sources = [];
  const candidateSourceCounts = {
    tradeAds: 0,
    assetOwners: 0,
  };

  const tradeAdCandidates =
    tradeAdsResult.status === "fulfilled"
      ? shuffle(
          tradeAdsResult.value.players
            .map((player) => Number(player.userId))
            .filter((userId) => Number.isInteger(userId) && userId > 0),
        )
      : [];

  if (tradeAdsResult.status === "fulfilled") {
    sources.push(
      `Rolimon's recent trade ads (${tradeAdsResult.value.sourceUrl})`,
    );
    candidateSourceCounts.tradeAds = new Set(tradeAdCandidates).size;
  } else {
    console.warn("Rolimon's trade-ad discovery failed:", tradeAdsResult.reason);
  }

  let seedItems = [];
  let ownerCandidates = [];

  if (itemCatalogResult.status === "fulfilled") {
    const dataset = itemCatalogResult.value;
    sources.push(
      `Rolimon's limited catalog (${dataset.sourceUrl ?? "public API"})`,
    );

    const tradeAdItemIds =
      tradeAdsResult.status === "fulfilled"
        ? tradeAdsResult.value.itemIds
        : [];

    const tradeableSeeds = shuffle(
      tradeAdItemIds
        .map((itemId) => dataset.byId.get(String(itemId)))
        .filter(Boolean)
        .filter(
          (item) =>
            Math.max(Number(item.rap) || 0, Number(item.value) || 0) >=
            seedFloor,
        ),
    );

    const catalogSeeds = shuffle(
      dataset.items.filter(
        (item) =>
          Math.max(Number(item.rap) || 0, Number(item.value) || 0) >=
          seedFloor,
      ),
    );

    seedItems = takeUniqueItems(
      [...tradeableSeeds, ...catalogSeeds],
      seedItemCount,
    );

    const ownerDiscoveryPromise = discoverOwnersFromSeeds(
      seedItems,
      ownersPerItem,
    );

    ownerCandidates = await withTimeout(
      ownerDiscoveryPromise,
      OWNER_DISCOVERY_BUDGET_MS,
      [],
    );

    if (ownerCandidates.length > 0) {
      candidateSourceCounts.assetOwners = new Set(ownerCandidates).size;
      sources.push(
        process.env.ROBLOX_OWNER_USE_COOKIE === "true" &&
        process.env.ROBLOX_SESSION_COOKIE
          ? "Roblox asset owners (authenticated first, public fallback)"
          : "Roblox public asset owners",
      );
    } else {
      sources.push("Roblox asset owners (no candidates returned this pass)");
    }
  } else {
    console.warn("Rolimon's item catalog discovery failed:", itemCatalogResult.reason);
  }

  const now = Date.now();
  addCandidatesToPool(tradeAdCandidates, "Rolimon's recent trade ads", now);
  addCandidatesToPool(ownerCandidates, "Roblox asset owners", now);
  pruneCandidatePool(now);

  const selection = selectCandidatesFromPool(maxCandidates, now);
  const userIds = selection.userIds;

  console.info(
    `Target discovery: ${candidateSourceCounts.tradeAds} trade-ad candidates, ${candidateSourceCounts.assetOwners} owner candidates, ${candidatePool.size} pooled, ${selection.freshCount} fresh selected, ${selection.recentlyCheckedSkipped} cooling down.`,
  );

  return {
    userIds,
    seedItems: seedItems.map((item) => ({
      id: item.id,
      name: item.name,
      rap: item.rap,
      value: item.value,
    })),
    candidateSourceCounts,
    candidatePoolSize: candidatePool.size,
    freshCandidateCount: selection.freshCount,
    recentlyCheckedSkipped: selection.recentlyCheckedSkipped,
    sources,
  };
}

async function discoverOwnersFromSeeds(seedItems, ownersPerItem) {
  if (seedItems.length === 0) return [];

  const ownerResults = await mapWithConcurrency(
    seedItems,
    OWNER_CONCURRENCY,
    async (item) => {
      try {
        const result = await getAssetOwners(item.id, {
          limit: ownersPerItem,
        });
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
    }
  }

  return userIds;
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
  const presences = [];
  const checkedIds = [];

  for (let index = 0; index < userIds.length; index += PRESENCE_BATCH_SIZE) {
    const batch = userIds.slice(index, index + PRESENCE_BATCH_SIZE);
    try {
      const result = await getUsersPresence(batch);
      presences.push(...result);
      checkedIds.push(...batch);
    } catch (error) {
      console.warn("Roblox presence batch failed:", error);
    }
  }

  return { presences, checkedIds };
}

function addCandidatesToPool(userIds, source, now = Date.now()) {
  for (const rawUserId of userIds) {
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) continue;

    const existing = candidatePool.get(userId) ?? {
      userId,
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: 0,
      sources: new Set(),
    };

    existing.lastSeenAt = now;
    existing.sources.add(source);
    candidatePool.set(userId, existing);
  }
}

function pruneCandidatePool(now = Date.now()) {
  const ttlMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_POOL_TTL_MS",
    DEFAULT_POOL_TTL_MS,
  );
  const maxSize = getPositiveIntegerEnv(
    "ROBLOX_TARGET_POOL_MAX_SIZE",
    DEFAULT_POOL_MAX_SIZE,
  );

  for (const [userId, candidate] of candidatePool) {
    if (now - candidate.lastSeenAt > ttlMs) {
      candidatePool.delete(userId);
    }
  }

  if (candidatePool.size <= maxSize) return;

  const oldest = [...candidatePool.values()].sort(
    (left, right) => left.lastSeenAt - right.lastSeenAt,
  );

  for (const candidate of oldest.slice(0, candidatePool.size - maxSize)) {
    candidatePool.delete(candidate.userId);
  }
}

function selectCandidatesFromPool(limit, now = Date.now()) {
  const cooldownMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_RECENT_CHECK_COOLDOWN_MS",
    DEFAULT_RECENT_CHECK_COOLDOWN_MS,
  );

  const fresh = [];
  const coolingDown = [];

  for (const candidate of candidatePool.values()) {
    if (
      !candidate.lastCheckedAt ||
      now - candidate.lastCheckedAt >= cooldownMs
    ) {
      fresh.push(candidate);
    } else {
      coolingDown.push(candidate);
    }
  }

  const neverChecked = shuffle(
    fresh.filter((candidate) => !candidate.lastCheckedAt),
  );
  const previouslyChecked = fresh
    .filter((candidate) => candidate.lastCheckedAt)
    .sort((left, right) => left.lastCheckedAt - right.lastCheckedAt);

  const selected = [...neverChecked, ...previouslyChecked]
    .slice(0, limit)
    .map((candidate) => candidate.userId);

  return {
    userIds: selected,
    freshCount: selected.length,
    recentlyCheckedSkipped: coolingDown.length,
  };
}

function markCandidatesChecked(userIds, now = Date.now()) {
  for (const rawUserId of userIds) {
    const userId = Number(rawUserId);
    const candidate = candidatePool.get(userId);
    if (candidate) {
      candidate.lastCheckedAt = now;
    }
  }
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

function takeUniqueItems(items, limit) {
  const result = [];
  const seen = new Set();

  for (const item of items) {
    const id = Number(item?.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

function roundRobinUnique(buckets, limit) {
  const normalized = buckets.map((bucket) => [...bucket]);
  const result = [];
  const seen = new Set();
  let madeProgress = true;

  while (result.length < limit && madeProgress) {
    madeProgress = false;

    for (const bucket of normalized) {
      while (bucket.length > 0) {
        const value = Number(bucket.shift());
        if (!Number.isInteger(value) || value <= 0 || seen.has(value)) {
          continue;
        }

        seen.add(value);
        result.push(value);
        madeProgress = true;
        break;
      }

      if (result.length >= limit) break;
    }
  }

  return result;
}

async function withTimeout(promise, timeoutMs, fallback) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
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
