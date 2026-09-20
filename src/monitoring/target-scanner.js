import {
  getAvatarThumbnail,
  getAssetOwners,
  getFriendGroupRoles,
  getGameDetails,
  getRobloxGroupDetails,
  getRobloxGroupRelationships,
  getRobloxGroupUsers,
  getRobloxGroupWallPosters,
  getRobloxUserById,
  getUserFriends,
  getUserFollowers,
  getUserFollowings,
  getUserPrimaryGroup,
  getUserRobloxGroups,
  getUsersPresence,
  getUsersPresenceFallback,
  lookupRobloxUsers,
  searchMarketplaceItems,
  searchRobloxGroups,
  searchRobloxUsers,
} from "../roblox/api.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getFollowUserJoinUrl } from "../roblox/game-session.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import {
  enrichInventoryWithRolimons,
  getRolimonsItems,
} from "../sources/rolimons-items.js";
import { getRecentTradeAdPlayers } from "../sources/rolimons-trade-ads.js";
import { getJailbreakTradeCandidates } from "../sources/jailbreak-trading-network.js";
import { getRolimonsLeaderboardPlayers } from "../sources/rolimons-leaderboard.js";
import { searchRolimonsPlayers } from "../sources/rolimons-player-search.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";
import { getRblxValueProfile } from "../providers/rblxvalue.js";
import { getScanWatchlist } from "../storage/scan-watchlist.js";
import {
  addScanAttemptIds,
  addScanReservedIds,
  addSurfacedTargetIds,
  getTargetHistory,
  initializeTargetHistory,
} from "../storage/target-history.js";

export const DEFAULT_TARGET_RAP = 450_000;
export const DEFAULT_TARGET_VALUE = 150_000;
export const DEFAULT_MM2_VALUE = 150_000;
export const DEFAULT_TARGET_COUNT = 10;
export const MAX_TARGETS = 10;
export const MIN_TARGET_THRESHOLD = 450_000;
export const MAX_TARGET_THRESHOLD = 2_500_000;

const GAME_TARGETS = {
  mm2: {
    label: "Murder Mystery 2",
    universeId: 66654135,
    matches: ["murder mystery 2", "mm2"],
  },
  "adopt-me": {
    label: "Adopt Me",
    universeId: 383310974,
    matches: ["adopt me"],
  },
};

const DEFAULT_MAX_CANDIDATES = 500;
const DEFAULT_TARGET_MAX_PRESENCE_CANDIDATES = 2_500;
const DEFAULT_TARGET_SCAN_WAVE_SIZE = 500;
const DEFAULT_TARGET_SCAN_TIME_BUDGET_MS = 45_000;
const DEFAULT_TRUSTED_RAP_TTL_MS = 15 * 60 * 1000;
const FINAL_RECHECK_BATCH_SIZE = 10;
const DEFAULT_GAME_SCAN_CANDIDATES = 1_200;
const DEFAULT_GAME_SCAN_TIME_BUDGET_MS = 25_000;
const DEFAULT_GAME_SCAN_WAVE_SIZE = 300;
const DEFAULT_MAX_ACTIVE_TO_VERIFY = 160;
const DEFAULT_POOL_MAX_SIZE = 5_000;
const DEFAULT_POOL_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_RECENT_CHECK_COOLDOWN_MS = 15 * 60 * 1000;
const TARGET_POOL_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const LIMITED_OWNER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const GROUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MARKETPLACE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;
const DEFAULT_SEED_ITEM_COUNT = 12;
const DEFAULT_OWNERS_PER_ITEM = 20;
const DEFAULT_SEED_MIN_ITEM_RAP = 75_000;
const OWNER_CONCURRENCY = 4;
const OWNER_DISCOVERY_BUDGET_MS = 12_000;
const SEARCH_TERMS_PER_REFRESH = 12;
const SOCIAL_SEEDS_PER_REFRESH = 10;
const SEARCH_CONCURRENCY = 4;
const SOCIAL_CONCURRENCY = 4;
const FOLLOW_SEEDS_PER_REFRESH = 6;
const ROLIMONS_SEARCH_TERMS_PER_REFRESH = 6;
const ROLIMONS_LEADERBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const JAILBREAK_TRADE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_ROLIMONS_LEADERBOARD_PAGES_PER_REFRESH = 20;
const DEFAULT_TARGET_LIVE_CACHE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TARGET_LIVE_CACHE_TTL_MS = 8 * 60 * 1000;
const DEFAULT_TARGET_LIVE_CACHE_SCAN_LIMIT = 500;
const DEFAULT_TARGET_LIVE_CACHE_BATCH_DELAY_MS = 1_200;
const DEFAULT_TARGET_LIVE_CACHE_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_PRESENCE_API_BACKOFF_MS = 3 * 60 * 1000;
const GROUP_SEARCH_TERMS_PER_REFRESH = 3;
const GROUPS_PER_SEARCH_TERM = 2;
const GROUP_MEMBERSHIP_SEEDS_PER_REFRESH = 4;
const FRIEND_GROUP_SEEDS_PER_REFRESH = 4;
const PRIMARY_GROUP_SEEDS_PER_REFRESH = 6;
const GROUP_DETAIL_SEEDS_PER_REFRESH = 8;
const GROUP_WALL_SEEDS_PER_REFRESH = 6;
const GROUP_RELATIONSHIP_SEEDS_PER_REFRESH = 4;
const GROUP_MEMBER_LIMIT = 50;
const GROUP_CONCURRENCY = 3;
const MARKETPLACE_OWNER_SEEDS = 8;
const MARKETPLACE_GROUP_SEEDS = 6;
const MARKETPLACE_OWNER_LIMIT = 20;
const PRESENCE_BATCH_SIZE = 50;
const VERIFY_CONCURRENCY = 5;
const MM2_PROFILE_CHECK_LIMIT = 24;
const MM2_PROFILE_CONCURRENCY = 2;
const MM2_SCAN_WAVE_SIZE = 300;
const MM2_SCAN_TIME_BUDGET_MS = 45_000;

const SEARCH_TERMS = [
  "pro","king","queen","dark","shadow","cool","game","player","star","wolf",
  "dragon","ninja","blue","red","green","gold","fire","ice","the","boy",
  "girl","roblox","master","elite","legend","nova","sky","moon","sun","cat",
  "dog","max","ace","zero","neo","rex","leo","trade","trader","limited",
  "collector","gaming","ytb","ttv","xxl","dev","builder","rich","rare",
  "avatar","pixel","epic","super","mega","ultra","night","light","storm"
];

const GROUP_SEARCH_TERMS = [
  "roblox","gaming","community","trading","players","fans","clan","group",
  "mm2","adopt","limited","trade","roleplay","pvp","builders","collectors",
  "market","social","friends","games"
];

const candidatePool = new Map();
const liveTargetCache = new Map();

// /scan is an expansion command, not a replay command. Keep a runtime history
// of users already surfaced by /target and candidates already attempted by
// /scan at a given threshold. The persisted /scan watchlist remains the
// authoritative long-term dedupe source when durable storage is configured.
const surfacedTargetIds = new Set();
const scanReservedIds = new Set();
const scanAttemptedByThreshold = new Map();
let targetHistoryHydrated = false;
let targetHistoryHydratePromise = null;
let targetPoolWarmupTimer = null;
let targetLiveCacheTimer = null;
let liveTargetCursor = 0;
let lastLiveCacheRefreshAt = 0;
let liveCacheBackoffUntil = 0;
let presenceApiBackoffUntil = 0;
let searchTermCursor = 0;
let groupSearchTermCursor = 0;
let leaderboardPageCursor = 1;
let lastLimitedOwnerRefreshAt = 0;
let lastGroupRefreshAt = 0;
let lastLeaderboardRefreshAt = 0;
let lastMarketplaceRefreshAt = 0;
let lastJailbreakTradeRefreshAt = 0;
let limitedSeedCursor = 0;
let candidateRefreshPromise = null;
let lastCandidatePoolRefreshAt = 0;

async function ensureTargetHistoryHydrated() {
  if (targetHistoryHydrated) return;

  if (!targetHistoryHydratePromise) {
    targetHistoryHydratePromise = (async () => {
      await initializeTargetHistory();
      const history = await getTargetHistory();

      for (const id of history.surfacedTargets) surfacedTargetIds.add(id);
      for (const id of history.scanReserved) scanReservedIds.add(id);
      for (const [key, ids] of history.scanAttempts) {
        scanAttemptedByThreshold.set(key, new Set(ids));
      }

      targetHistoryHydrated = true;
      console.info(
        `Target history restored: ${surfacedTargetIds.size} surfaced targets, ${scanReservedIds.size} scan reservations.`,
      );
    })().finally(() => {
      targetHistoryHydratePromise = null;
    });
  }

  await targetHistoryHydratePromise;
}

async function refreshCandidatePoolLightweight() {
  const now = Date.now();
  const watchlistUserIds = await syncWatchlistCandidates(now);

  const tradeAdsResult = await getRecentTradeAdPlayers().catch((error) => {
    console.warn("Rolimon's trade-ad discovery failed:", error);
    return { players: [] };
  });
  const tradeAdUserIds = [
    ...new Set(
      (tradeAdsResult?.players ?? [])
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];
  addCandidatesToPool(tradeAdUserIds, "Rolimon's recent trade ads", now);

  let leaderboardUserIds = [];
  if (
    now - lastLeaderboardRefreshAt >=
    ROLIMONS_LEADERBOARD_REFRESH_INTERVAL_MS
  ) {
    leaderboardUserIds = await refreshRolimonsLeaderboardCandidates();
    lastLeaderboardRefreshAt = now;
  }

  pruneCandidatePool();
  lastCandidatePoolRefreshAt = now;

  return {
    ...getPoolSourceCounts(),
    watchlist: watchlistUserIds.length,
    tradeAds: tradeAdUserIds.length,
    leaderboard: leaderboardUserIds.length,
  };
}

export function startTargetCandidatePoolWarmup() {
  if (targetPoolWarmupTimer || targetLiveCacheTimer) return;

  const refreshCandidates = async () => {
    try {
      const stats = await refreshCandidatePool();
      console.info(
        `Target index refresh: ${candidatePool.size} pooled · ${stats.leaderboard ?? 0} leaderboard · ${stats.watchlist ?? 0} scan-watchlist.`,
      );
    } catch (error) {
      console.warn("Background target candidate refresh failed:", error);
    }
  };

  const warmCandidates = async () => {
    try {
      const stats = await refreshCandidatePoolLightweight();
      console.info(
        `Target index warmup: ${candidatePool.size} pooled · ${stats.leaderboard ?? 0} leaderboard · ${stats.watchlist ?? 0} scan-watchlist.`,
      );
    } catch (error) {
      console.warn("Lightweight target warmup failed:", error);
    }
  };

  const refreshLive = async () => {
    try {
      const stats = await refreshTargetLiveCache();
      console.info(
        `Target live cache: ${stats.liveCount} in-game · ${stats.checkedCount} checked · ${stats.verifiedIndexCount} verified 450k+ indexed.`,
      );
    } catch (error) {
      console.warn("Background target live-cache refresh failed:", error);
    }
  };

  // Restore durable dedupe history before warming the verified index.
  void ensureTargetHistoryHydrated()
    .then(warmCandidates)
    .then(refreshLive);

  targetPoolWarmupTimer = setInterval(
    refreshCandidates,
    TARGET_POOL_REFRESH_INTERVAL_MS,
  );
  targetPoolWarmupTimer.unref?.();

  const liveIntervalMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_LIVE_CACHE_INTERVAL_MS",
    DEFAULT_TARGET_LIVE_CACHE_INTERVAL_MS,
  );
  targetLiveCacheTimer = setInterval(refreshLive, liveIntervalMs);
  targetLiveCacheTimer.unref?.();
}

export async function refreshTargetLiveCache() {
  await syncWatchlistCandidates();

  const now = Date.now();
  if (now < liveCacheBackoffUntil || now < presenceApiBackoffUntil) {
    return {
      verifiedIndexCount: getTargetLiveCacheStats().verifiedIndexCount,
      checkedCount: 0,
      liveCount: liveTargetCache.size,
      backingOff: true,
    };
  }

  const minimumRap = getMinimumTargetRap();
  const scanLimit = Math.max(
    50,
    Math.min(
      2_500,
      getPositiveIntegerEnv(
        "ROBLOX_TARGET_LIVE_CACHE_SCAN_LIMIT",
        DEFAULT_TARGET_LIVE_CACHE_SCAN_LIMIT,
      ),
    ),
  );
  const ttlMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_LIVE_CACHE_TTL_MS",
    DEFAULT_TARGET_LIVE_CACHE_TTL_MS,
  );

  const verifiedCandidates = [...candidatePool.values()]
    .filter(
      (candidate) =>
        Number.isFinite(Number(candidate?.lastKnownRap)) &&
        Number(candidate.lastKnownRap) >= minimumRap,
    )
    .sort(
      (left, right) =>
        getCandidatePriority(
          right,
          { minimumValue: null, minimumRap },
        ) -
        getCandidatePriority(
          left,
          { minimumValue: null, minimumRap },
        ),
    );

  const verifiedIds = verifiedCandidates.map((candidate) => candidate.userId);
  if (verifiedIds.length === 0) {
    pruneLiveTargetCache(now, ttlMs);
    lastLiveCacheRefreshAt = now;
    return {
      verifiedIndexCount: 0,
      checkedCount: 0,
      liveCount: liveTargetCache.size,
    };
  }

  // Recheck currently-live users and /scan watchlist members every cycle.
  const mandatory = [];
  const mandatorySeen = new Set();
  const pushMandatory = (userId) => {
    const id = Number(userId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      mandatorySeen.has(id) ||
      !verifiedIds.includes(id)
    ) {
      return;
    }
    mandatorySeen.add(id);
    mandatory.push(id);
  };

  for (const userId of liveTargetCache.keys()) pushMandatory(userId);
  for (const candidate of verifiedCandidates) {
    if (candidate.sources?.has("Verified /scan RAP watchlist")) {
      pushMandatory(candidate.userId);
    }
  }

  const rotating = verifiedIds.filter((userId) => !mandatorySeen.has(userId));
  const remainingSlots = Math.max(0, scanLimit - mandatory.length);
  const selectedRotating = [];

  if (rotating.length > 0 && remainingSlots > 0) {
    const start = liveTargetCursor % rotating.length;
    for (
      let offset = 0;
      offset < Math.min(remainingSlots, rotating.length);
      offset += 1
    ) {
      selectedRotating.push(rotating[(start + offset) % rotating.length]);
    }
    liveTargetCursor =
      (start + selectedRotating.length) % rotating.length;
  }

  const selectedIds = [
    ...mandatory.slice(0, scanLimit),
    ...selectedRotating.slice(
      0,
      Math.max(0, scanLimit - mandatory.length),
    ),
  ];

  const presenceScan = await getPresenceBatched(selectedIds, {
    batchSize: PRESENCE_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: getPositiveIntegerEnv(
      "ROBLOX_TARGET_LIVE_CACHE_BATCH_DELAY_MS",
      DEFAULT_TARGET_LIVE_CACHE_BATCH_DELAY_MS,
    ),
  });
  const checked = new Set(presenceScan.checkedIds.map(Number));
  const presenceById = new Map(
    presenceScan.presences.map((presence) => [
      Number(presence?.userId),
      presence,
    ]),
  );

  for (const userId of selectedIds) {
    if (!checked.has(userId)) continue;
    const presence = presenceById.get(userId);
    if (Number(presence?.userPresenceType) === 2) {
      liveTargetCache.set(userId, {
        presence,
        checkedAt: now,
      });
    } else {
      liveTargetCache.delete(userId);
    }
  }

  const completionRatio =
    selectedIds.length > 0 ? checked.size / selectedIds.length : 1;
  if (selectedIds.length >= 50 && completionRatio < 0.5) {
    liveCacheBackoffUntil =
      Date.now() +
      getPositiveIntegerEnv(
        "ROBLOX_TARGET_LIVE_CACHE_BACKOFF_MS",
        DEFAULT_TARGET_LIVE_CACHE_BACKOFF_MS,
      );
    console.warn(
      `Target live cache backing off after low presence completion: ${checked.size}/${selectedIds.length}.`,
    );
  } else {
    liveCacheBackoffUntil = 0;
  }

  pruneLiveTargetCache(now, ttlMs);
  lastLiveCacheRefreshAt = now;

  return {
    verifiedIndexCount: verifiedIds.length,
    checkedCount: checked.size,
    liveCount: liveTargetCache.size,
    backingOff: liveCacheBackoffUntil > Date.now(),
  };
}

function pruneLiveTargetCache(
  now = Date.now(),
  ttlMs = DEFAULT_TARGET_LIVE_CACHE_TTL_MS,
) {
  for (const [userId, entry] of liveTargetCache) {
    if (
      !entry?.checkedAt ||
      now - Number(entry.checkedAt) > ttlMs
    ) {
      liveTargetCache.delete(userId);
    }
  }
}

function getFreshLiveCachePresences({
  minimumValue = null,
  minimumRap = null,
  limit = MAX_TARGETS + 5,
} = {}) {
  const ttlMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_LIVE_CACHE_TTL_MS",
    DEFAULT_TARGET_LIVE_CACHE_TTL_MS,
  );
  const now = Date.now();
  pruneLiveTargetCache(now, ttlMs);

  return [...liveTargetCache.entries()]
    .filter(([userId]) => {
      const candidate = candidatePool.get(Number(userId));
      if (!candidate) return false;

      if (
        minimumRap !== null &&
        minimumRap !== undefined &&
        (!Number.isFinite(Number(candidate.lastKnownRap)) ||
          Number(candidate.lastKnownRap) < Number(minimumRap))
      ) {
        return false;
      }

      if (
        minimumValue !== null &&
        minimumValue !== undefined &&
        (!Number.isFinite(Number(candidate.lastKnownValue)) ||
          Number(candidate.lastKnownValue) < Number(minimumValue))
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftCandidate = candidatePool.get(Number(left[0]));
      const rightCandidate = candidatePool.get(Number(right[0]));
      return (
        getCandidatePriority(
          rightCandidate,
          { minimumValue, minimumRap },
        ) -
        getCandidatePriority(
          leftCandidate,
          { minimumValue, minimumRap },
        )
      );
    })
    .slice(0, Math.max(1, Number(limit) || MAX_TARGETS))
    .map(([, entry]) => entry.presence);
}

function getFreshGameLiveCachePresences(
  game,
  { minimumRap = null, limit = MAX_TARGETS } = {},
) {
  const ttlMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_LIVE_CACHE_TTL_MS",
    DEFAULT_TARGET_LIVE_CACHE_TTL_MS,
  );
  pruneLiveTargetCache(Date.now(), ttlMs);

  return [...liveTargetCache.entries()]
    .filter(([userId, entry]) => {
      const candidate = candidatePool.get(Number(userId));
      if (!candidate || !isPresenceForGame(entry?.presence, game)) {
        return false;
      }

      if (
        minimumRap !== null &&
        minimumRap !== undefined &&
        (!Number.isFinite(Number(candidate.lastKnownRap)) ||
          Number(candidate.lastKnownRap) < Number(minimumRap))
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftCandidate = candidatePool.get(Number(left[0]));
      const rightCandidate = candidatePool.get(Number(right[0]));
      return (
        getCandidatePriority(
          rightCandidate,
          { minimumValue: null, minimumRap },
        ) -
        getCandidatePriority(
          leftCandidate,
          { minimumValue: null, minimumRap },
        )
      );
    })
    .slice(0, Math.max(1, Number(limit) || MAX_TARGETS))
    .map(([, entry]) => entry.presence);
}

export function getTargetLiveCacheStats() {
  const ttlMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_LIVE_CACHE_TTL_MS",
    DEFAULT_TARGET_LIVE_CACHE_TTL_MS,
  );
  pruneLiveTargetCache(Date.now(), ttlMs);
  return {
    liveCount: liveTargetCache.size,
    lastRefreshAt: lastLiveCacheRefreshAt || null,
    verifiedIndexCount: [...candidatePool.values()].filter(
      (candidate) =>
        Number.isFinite(Number(candidate?.lastKnownRap)) &&
        Number(candidate.lastKnownRap) >= getMinimumTargetRap(),
    ).length,
  };
}

async function rememberSurfacedTargets(players) {
  const ids = [];
  for (const player of players ?? []) {
    const userId = Number(player?.id ?? player?.userId);
    if (Number.isInteger(userId) && userId > 0) {
      surfacedTargetIds.add(userId);
      ids.push(userId);
    }
  }

  if (ids.length > 0) {
    await addSurfacedTargetIds(ids);
  }
}

function getScanAttemptKey(minimumRap, minimumValue) {
  return `${minimumRap ?? "none"}:${minimumValue ?? "none"}`;
}

function getScanAttemptSet(minimumRap, minimumValue) {
  const key = getScanAttemptKey(minimumRap, minimumValue);
  let attempted = scanAttemptedByThreshold.get(key);
  if (!attempted) {
    attempted = new Set();
    scanAttemptedByThreshold.set(key, attempted);
  }
  return attempted;
}

function countPoolMatches(ids) {
  let count = 0;
  for (const rawId of ids ?? []) {
    if (candidatePool.has(Number(rawId))) count += 1;
  }
  return count;
}

export async function scanDiscoveredTargets({
  minimumValue = null,
  minimumRap = getMinimumTargetRap(),
  limit = DEFAULT_TARGET_COUNT,
} = {}) {
  await ensureTargetHistoryHydrated();

  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );

  const cacheStartedAt = Date.now();
  const cachedPresences = getFreshLiveCachePresences({
    minimumValue,
    minimumRap,
    limit: Math.min(MAX_TARGETS + 5, requestedLimit + 5),
  });

  if (cachedPresences.length >= requestedLimit) {
    const cachedResults = await mapWithConcurrency(
      cachedPresences,
      VERIFY_CONCURRENCY,
      (presence) =>
        buildDiscoveredTargetPlayer(presence, {
          minimumValue,
          minimumRap,
        }).catch(() => null),
    );
    const cachedVerified = cachedResults
      .filter((player) => player?.qualifies)
      .slice(0, Math.min(MAX_TARGETS, requestedLimit + 2));
    const upstreamBackingOff = Date.now() < presenceApiBackoffUntil;
    const finalCached = upstreamBackingOff
      ? {
          players: cachedVerified,
          leftGameCount: 0,
          unavailableCount: 0,
          rateLimited: true,
          usedCachedPresenceFallback: true,
        }
      : await revalidateCurrentlyInGame(cachedVerified);

    const cachedFallback =
      finalCached.rateLimited === true &&
      cachedVerified.length > 0 &&
      finalCached.players.length < requestedLimit
        ? {
            ...finalCached,
            players: cachedVerified,
            usedCachedPresenceFallback: true,
          }
        : finalCached;

    if (
      cachedFallback.players.length >= requestedLimit ||
      (cachedFallback.usedCachedPresenceFallback &&
        cachedFallback.players.length > 0)
    ) {
      const selectedPlayers = shuffle(cachedFallback.players)
        .slice(0, requestedLimit)
        .map(({ qualifies, ...player }) => player);
      await rememberSurfacedTargets(selectedPlayers);

      return {
        minimumValue,
        minimumRap,
        players: selectedPlayers,
        candidateCount: cachedPresences.length,
        candidatePoolSize: candidatePool.size,
        freshCandidateCount: cachedPresences.length,
        recentlyCheckedSkipped: 0,
        candidateSourceCounts: getPoolSourceCounts(),
        presenceScannedCount: cachedPresences.length,
        activeCount: cachedPresences.length,
        verifiedCount: cachedFallback.players.length,
        finalPresenceLeftGameCount: cachedFallback.leftGameCount,
        finalPresenceUnavailableCount: cachedFallback.unavailableCount,
        presenceRateLimited: cachedFallback.rateLimited === true,
        usedCachedPresenceFallback:
          cachedFallback.usedCachedPresenceFallback === true,
        verificationAttempts: cachedResults.length,
        valueUnavailableCount: 0,
        belowValueCount: 0,
        rapUnavailableCount: 0,
        belowRapCount: 0,
        profileUnavailableCount: 0,
        verificationErrorCount: 0,
        preRecheckVerifiedCount: cachedVerified.length,
        joinReadyCount: cachedFallback.players.filter((player) => player.joinReady).length,
        publicServerConfirmedCount: cachedFallback.players.filter((player) => player.publicServerConfirmed).length,
        liveCacheHit: true,
        liveCacheSize: liveTargetCache.size,
        verifiedIndexCount: getTargetLiveCacheStats().verifiedIndexCount,
        liveCacheLastRefreshAt: lastLiveCacheRefreshAt || null,
        scanElapsedMs: Date.now() - cacheStartedAt,
        sources: [
          "Background verified RAP index",
          "Background Roblox live-presence cache",
          "Fresh Roblox final presence confirmation",
        ],
      };
    }
  }

  const maxPresenceCandidates = getPositiveIntegerEnv(
    "ROBLOX_TARGET_MAX_PRESENCE_CANDIDATES",
    DEFAULT_TARGET_MAX_PRESENCE_CANDIDATES,
  );
  const waveSize = Math.max(
    50,
    Math.min(
      1_000,
      getPositiveIntegerEnv(
        "ROBLOX_TARGET_SCAN_WAVE_SIZE",
        DEFAULT_TARGET_SCAN_WAVE_SIZE,
      ),
    ),
  );
  const timeBudgetMs = Math.max(
    10_000,
    getPositiveIntegerEnv(
      "ROBLOX_TARGET_SCAN_TIME_BUDGET_MS",
      DEFAULT_TARGET_SCAN_TIME_BUDGET_MS,
    ),
  );

  const discovery = await discoverCandidateUserIds({
    minimumValue,
    minimumRap,
    maxCandidatesOverride: maxPresenceCandidates,
  });

  if (discovery.userIds.length === 0) {
    return {
      minimumValue,
      minimumRap,
      players: [],
      candidateCount: 0,
      candidatePoolSize: discovery.candidatePoolSize,
      freshCandidateCount: discovery.freshCandidateCount,
      recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
      candidateSourceCounts: discovery.candidateSourceCounts,
      presenceScannedCount: 0,
      activeCount: 0,
      verifiedCount: 0,
      verificationAttempts: 0,
      valueUnavailableCount: 0,
      belowValueCount: 0,
      rapUnavailableCount: 0,
      belowRapCount: 0,
      sources: discovery.sources,
      skipped: "No candidates were returned by the discovery routes.",
    };
  }

  const startedAt = Date.now();
  const verifiedPlayers = [];
  const activeSeen = new Map();
  let presenceScannedCount = 0;
  let verificationAttempts = 0;
  let valueUnavailableCount = 0;
  let belowValueCount = 0;
  let rapUnavailableCount = 0;
  let belowRapCount = 0;
  let presenceRateLimited = false;
  let profileUnavailableCount = 0;
  let verificationErrorCount = 0;
  let presenceRateLimited = false;
  const maxActiveToVerify = getPositiveIntegerEnv(
    "ROBLOX_TARGET_MAX_ACTIVE_TO_VERIFY",
    DEFAULT_MAX_ACTIVE_TO_VERIFY,
  );
  const verificationBuffer = Math.min(MAX_TARGETS, requestedLimit + 2);

  for (
    let offset = 0;
    offset < discovery.userIds.length;
    offset += waveSize
  ) {
    if (Date.now() - startedAt >= timeBudgetMs) break;
    if (verifiedPlayers.length >= verificationBuffer) break;
    if (verificationAttempts >= maxActiveToVerify) break;

    const wave = discovery.userIds.slice(offset, offset + waveSize);
    const presenceScan = await getPresenceBatched(wave, {
      maxAttempts: 1,
      interBatchDelayMs: 1_000,
      stopOnRateLimit: true,
    });
    markCandidatesChecked(presenceScan.checkedIds);
    presenceScannedCount += presenceScan.checkedIds.length;
    if (presenceScan.rateLimited) presenceRateLimited = true;

    const inGamePresences = presenceScan.presences
      .filter(
        (presence) => Number(presence?.userPresenceType) === 2,
      )
      .sort(
        (left, right) =>
          getCandidatePriority(
            candidatePool.get(Number(right.userId)),
            { minimumValue, minimumRap },
          ) -
          getCandidatePriority(
            candidatePool.get(Number(left.userId)),
            { minimumValue, minimumRap },
          ),
      );

    for (const presence of inGamePresences) {
      activeSeen.set(Number(presence.userId), presence);
    }

    if (presenceScan.rateLimited && inGamePresences.length === 0) {
      break;
    }

    const remainingVerifyBudget =
      maxActiveToVerify - verificationAttempts;
    const activeWave = inGamePresences.slice(0, remainingVerifyBudget);
    verificationAttempts += activeWave.length;

    for (
      let index = 0;
      index < activeWave.length;
      index += VERIFY_CONCURRENCY
    ) {
      if (Date.now() - startedAt >= timeBudgetMs) break;
      if (verifiedPlayers.length >= verificationBuffer) break;

      const batch = activeWave.slice(index, index + VERIFY_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((presence) =>
          buildDiscoveredTargetPlayer(presence, {
            minimumValue,
            minimumRap,
            includeGameValue,
          }).catch((error) => {
            console.warn(
              `Target verification failed for Roblox user ${presence.userId}:`,
              error,
            );
            return {
              qualifies: false,
              id: Number(presence.userId),
              reason: "verification-error",
            };
          }),
        ),
      );

      for (const player of batchResults) {
        if (player?.qualifies) {
          verifiedPlayers.push(player);
        } else if (player?.reason === "value-unavailable") {
          valueUnavailableCount += 1;
        } else if (player?.reason === "below-value") {
          belowValueCount += 1;
        } else if (player?.reason === "rap-unavailable") {
          rapUnavailableCount += 1;
        } else if (player?.reason === "below-rap") {
          belowRapCount += 1;
        } else if (player?.reason === "profile-unavailable") {
          profileUnavailableCount += 1;
        } else if (player?.reason === "verification-error") {
          verificationErrorCount += 1;
        }
      }
    }
  }

  const stillInGamePlayers = await revalidateCurrentlyInGame(
    verifiedPlayers,
  );
  presenceRateLimited =
    presenceRateLimited || stillInGamePlayers.rateLimited === true;
  const selectedPlayers = shuffle(stillInGamePlayers.players)
    .slice(0, requestedLimit)
    .map(({ qualifies, ...player }) => player);
  await rememberSurfacedTargets(selectedPlayers);

  return {
    minimumValue,
    minimumRap,
    players: selectedPlayers,
    candidateCount: discovery.userIds.length,
    candidatePoolSize: discovery.candidatePoolSize,
    freshCandidateCount: discovery.freshCandidateCount,
    recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
    candidateSourceCounts: discovery.candidateSourceCounts,
    presenceScannedCount,
    activeCount: activeSeen.size,
    verifiedCount: stillInGamePlayers.players.length,
    finalPresenceLeftGameCount: stillInGamePlayers.leftGameCount,
    finalPresenceUnavailableCount: stillInGamePlayers.unavailableCount,
    presenceRateLimited,
    usedCachedPresenceFallback: false,
    verificationAttempts,
    valueUnavailableCount,
    belowValueCount,
    rapUnavailableCount,
    belowRapCount,
    profileUnavailableCount,
    verificationErrorCount,
    preRecheckVerifiedCount: verifiedPlayers.length,
    joinReadyCount: stillInGamePlayers.players.filter((player) => player.joinReady).length,
    publicServerConfirmedCount: stillInGamePlayers.players.filter((player) => player.publicServerConfirmed).length,
    liveCacheHit: false,
    liveCacheSize: liveTargetCache.size,
    verifiedIndexCount: getTargetLiveCacheStats().verifiedIndexCount,
    liveCacheLastRefreshAt: lastLiveCacheRefreshAt || null,
    scanElapsedMs: Date.now() - startedAt,
    sources: [
      ...new Set([
        ...discovery.sources,
        "Roblox public presence",
        "Roblox public collectibles inventory",
        "Rolimon's public player info (RAP/value cross-check only)",
      ]),
    ],
  };
}

export async function scanCandidatesForWatchlist({
  minimumRap = DEFAULT_TARGET_RAP,
  minimumValue = null,
  limit = 25,
} = {}) {
  await ensureTargetHistoryHydrated();

  const requestedLimit = Math.max(1, Math.min(50, Number(limit) || 25));
  // /scan is for expanding the verified pool. Exclude persisted watchlist
  // members, users already surfaced by /target in this runtime, users already
  // returned by a prior /scan, and candidates already attempted at this exact
  // threshold. This prevents repeated scans from looping over the same high-
  // priority candidates.
  const watchedIds = new Set(
    (await getScanWatchlist())
      .map((entry) => Number(entry?.userId))
      .filter((userId) => Number.isInteger(userId) && userId > 0),
  );
  const attemptedIds = getScanAttemptSet(minimumRap, minimumValue);
  const excludedIds = new Set([
    ...watchedIds,
    ...surfacedTargetIds,
    ...scanReservedIds,
    ...attemptedIds,
  ]);

  const watchedSkipped = countPoolMatches(watchedIds);
  const previousTargetSkipped = countPoolMatches(
    [...surfacedTargetIds].filter((id) => !watchedIds.has(id)),
  );
  const previousScanSkipped = countPoolMatches(
    [...new Set([...scanReservedIds, ...attemptedIds])].filter(
      (id) => !watchedIds.has(id) && !surfacedTargetIds.has(id),
    ),
  );

  const discovery = await discoverCandidateUserIds({
    minimumValue,
    minimumRap,
    respectCooldown: false,
    excludeUserIds: excludedIds,
    maxCandidatesOverride: getPositiveIntegerEnv(
      "ROBLOX_TARGET_MAX_PRESENCE_CANDIDATES",
      DEFAULT_TARGET_MAX_PRESENCE_CANDIDATES,
    ),
  });

  const startedAt = Date.now();
  const timeBudgetMs = Math.max(
    10_000,
    getPositiveIntegerEnv(
      "ROBLOX_TARGET_SCAN_TIME_BUDGET_MS",
      DEFAULT_TARGET_SCAN_TIME_BUDGET_MS,
    ),
  );
  const verified = [];
  const newAttemptIds = [];
  let checkedCount = 0;

  const candidates = discovery.userIds
    .sort((leftId, rightId) =>
      getCandidatePriority(
        candidatePool.get(Number(rightId)),
        { minimumValue, minimumRap },
      ) -
      getCandidatePriority(
        candidatePool.get(Number(leftId)),
        { minimumValue, minimumRap },
      ),
    );

  for (let index = 0; index < candidates.length; index += VERIFY_CONCURRENCY) {
    if (Date.now() - startedAt >= timeBudgetMs) break;
    if (verified.length >= requestedLimit) break;

    const batch = candidates.slice(index, index + VERIFY_CONCURRENCY);
    checkedCount += batch.length;
    for (const userId of batch) {
      attemptedIds.add(Number(userId));
      newAttemptIds.push(Number(userId));
    }

    const results = await Promise.all(
      batch.map((userId) =>
        buildDiscoveredTargetPlayer(
          {
            userId,
            userPresenceType: 0,
            lastLocation: null,
            universeId: null,
          },
          { minimumValue, minimumRap },
        ).catch((error) => {
          console.warn(
            `Scan watchlist verification failed for Roblox user ${userId}:`,
            error,
          );
          return null;
        }),
      ),
    );

    for (const player of results) {
      if (player?.qualifies) {
        verified.push(player);
        if (verified.length >= requestedLimit) break;
      }
    }
  }

  if (newAttemptIds.length > 0) {
    await addScanAttemptIds(
      getScanAttemptKey(minimumRap, minimumValue),
      newAttemptIds,
    );
  }

  const selectedPlayers = verified
    .slice(0, requestedLimit)
    .map(({ qualifies, ...player }) => player);

  const reservedIds = [];
  for (const player of selectedPlayers) {
    const userId = Number(player?.id ?? player?.userId);
    if (Number.isInteger(userId) && userId > 0) {
      scanReservedIds.add(userId);
      reservedIds.push(userId);
    }
  }

  if (reservedIds.length > 0) {
    await addScanReservedIds(reservedIds);
  }

  return {
    players: selectedPlayers,
    minimumRap,
    minimumValue,
    checkedCount,
    alreadyWatchedSkipped: watchedSkipped,
    previousTargetSkipped,
    previousScanSkipped,
    totalExcludedFromExpansion: discovery.excludedCandidateCount,
    candidatePoolSize: discovery.candidatePoolSize,
    candidateSourceCounts: discovery.candidateSourceCounts,
    scanElapsedMs: Date.now() - startedAt,
  };
}

export async function scanMm2ValueTargets({
  minimumGameValue = DEFAULT_MM2_VALUE,
  minimumRap = null,
  limit = DEFAULT_TARGET_COUNT,
} = {}) {
  const game = GAME_TARGETS.mm2;
  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );

  const discovery = await discoverCandidateUserIds({
    minimumValue: null,
    minimumRap: null,
    respectCooldown: false,
    maxCandidatesOverride: getPositiveIntegerEnv(
      "ROBLOX_GAME_TARGET_MAX_CANDIDATES",
      DEFAULT_GAME_SCAN_CANDIDATES,
    ),
  });

  const startedAt = Date.now();
  const verifiedPlayers = [];
  const activeSeen = new Map();
  let presenceScannedCount = 0;
  let profileChecks = 0;
  let valueUnavailableCount = 0;
  let belowGameValueCount = 0;

  for (
    let offset = 0;
    offset < discovery.userIds.length;
    offset += MM2_SCAN_WAVE_SIZE
  ) {
    if (Date.now() - startedAt >= MM2_SCAN_TIME_BUDGET_MS) break;
    if (verifiedPlayers.length >= requestedLimit) break;
    if (profileChecks >= MM2_PROFILE_CHECK_LIMIT) break;

    const wave = discovery.userIds.slice(
      offset,
      offset + MM2_SCAN_WAVE_SIZE,
    );
    const presenceScan = await getPresenceBatched(wave, {
      maxAttempts: 1,
      interBatchDelayMs: 1_000,
      stopOnRateLimit: true,
    });
    presenceScannedCount += presenceScan.checkedIds.length;

    const gamePresences = presenceScan.presences.filter((presence) =>
      isPresenceForGame(presence, game),
    );

    for (const presence of gamePresences) {
      activeSeen.set(Number(presence.userId), presence);
    }

    const remainingProfileBudget =
      MM2_PROFILE_CHECK_LIMIT - profileChecks;
    const profileTargets = gamePresences.slice(
      0,
      remainingProfileBudget,
    );
    profileChecks += profileTargets.length;

    const profileResults = await mapWithConcurrency(
      profileTargets,
      MM2_PROFILE_CONCURRENCY,
      async (presence) => {
        try {
          const profile = await getRblxValueProfile({
            userId: presence.userId,
          });
          return { presence, profile };
        } catch (error) {
          console.warn(
            `RBLXValue MM2 profile lookup failed for ${presence.userId}:`,
            error,
          );
          return { presence, profile: null };
        }
      },
    );

    for (const { presence, profile } of profileResults) {
      if (Date.now() - startedAt >= MM2_SCAN_TIME_BUDGET_MS) break;
      if (verifiedPlayers.length >= requestedLimit) break;

      if (
        profile?.status !== "verified" ||
        typeof profile?.totalValue !== "number"
      ) {
        valueUnavailableCount += 1;
        continue;
      }

      if (profile.totalValue < minimumGameValue) {
        belowGameValueCount += 1;
        continue;
      }

      const player = await buildMm2ValueTargetPlayer(
        presence,
        profile,
        minimumRap,
      ).catch((error) => {
        console.warn(
          `MM2 target build failed for ${presence.userId}:`,
          error,
        );
        return null;
      });

      if (player) {
        verifiedPlayers.push(player);
      }
    }
  }

  const stillInGamePlayers = await revalidatePlayersForGame(
    verifiedPlayers,
    game,
  );

  return {
    gameKey: "mm2",
    gameLabel: game.label,
    universeId: game.universeId,
    minimumGameValue,
    minimumRap,
    players: stillInGamePlayers.slice(0, requestedLimit),
    candidateCount: discovery.userIds.length,
    candidatePoolSize: discovery.candidatePoolSize,
    candidateSourceCounts: discovery.candidateSourceCounts,
    presenceScannedCount,
    gameActiveCount: activeSeen.size,
    profileChecks,
    valueUnavailableCount,
    belowGameValueCount,
    verifiedCount: stillInGamePlayers.length,
    scanElapsedMs: Date.now() - startedAt,
    sources: [
      ...new Set([
        ...discovery.sources,
        "Roblox public presence",
        "RBLXValue API v2 profile",
        "RBLXValue API v2 inventory",
      ]),
    ],
  };
}

async function buildMm2ValueTargetPlayer(
  presence,
  profile,
  minimumRap = null,
) {
  if (minimumRap !== null && minimumRap !== undefined) {
    const rapChecked = await buildDiscoveredTargetPlayer(presence, {
      minimumValue: null,
      minimumRap,
    });
    if (!rapChecked?.qualifies) {
      return null;
    }

    return {
      ...rapChecked,
      gameValue:
        rapChecked.gameValue?.status === "verified"
          ? rapChecked.gameValue
          : profile,
    };
  }

  const userId = Number(presence.userId);
  const [userResult, avatarResult] = await Promise.allSettled([
    getRobloxUserById(userId),
    getAvatarThumbnail(userId),
  ]);

  const user =
    userResult.status === "fulfilled" ? userResult.value : null;
  if (!user) return null;

  let gameValue = profile;
  try {
    const inventoryValue = await scanGameValue({
      gameName: "Murder Mystery 2",
      userId,
      username: user.name,
    });
    if (inventoryValue?.status === "verified") {
      gameValue = inventoryValue;
    }
  } catch (error) {
    console.warn(
      `MM2 full inventory lookup failed for ${userId}; using profile value:`,
      error,
    );
  }

  return {
    qualifies: true,
    id: userId,
    username: user.name ?? "Unavailable",
    displayName: user.displayName ?? "Unavailable",
    avatarUrl:
      avatarResult.status === "fulfilled" ? avatarResult.value : null,
    profileUrl: `https://www.roblox.com/users/${userId}/profile`,
    rolimonsUrl: getRolimonsProfileUrl(userId),
    presenceStatus: "In game",
    gameName: presence.lastLocation ?? "Murder Mystery 2",
    rapValue: null,
    rapSource: "Not required",
    rapIsPartial: false,
    totalValue: null,
    valueSource: "MM2 inventory value",
    premiumStatus: "Unavailable",
    gameValue,
    topLimiteds: [],
  };
}

async function revalidatePlayersForGame(players, game) {
  if (!Array.isArray(players) || players.length === 0) {
    return [];
  }

  // Every player entering this helper was already observed in the requested
  // game during the current pass. If Roblox is actively rate-limiting, keep
  // that recent observation rather than turning valid activity into zero.
  if (Date.now() < presenceApiBackoffUntil) {
    return players.map((player) => ({
      ...player,
      presenceStatus: "In game",
      presenceFreshness: "recent",
    }));
  }

  const userIds = players
    .map((player) => Number(player?.id))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  const liveCheck = await getPresenceBatched(userIds, {
    maxAttempts: 1,
    interBatchDelayMs: 500,
    stopOnRateLimit: true,
  });

  if (liveCheck.rateLimited) {
    return players.map((player) => ({
      ...player,
      presenceStatus: "In game",
      presenceFreshness: "recent",
    }));
  }

  const activeByUserId = new Map(
    liveCheck.presences
      .filter((presence) => isPresenceForGame(presence, game))
      .map((presence) => [Number(presence.userId), presence]),
  );

  return players
    .filter((player) => activeByUserId.has(Number(player.id)))
    .map((player) => {
      const presence = activeByUserId.get(Number(player.id));
      return {
        ...player,
        presenceStatus: "In game",
        gameName: presence?.lastLocation || player.gameName,
        placeId: presence?.placeId ?? player.placeId ?? null,
        gameId: presence?.gameId ?? player.gameId ?? null,
        followJoinUrl:
          player.followJoinUrl ?? getFollowUserJoinUrl(player.id),
        presenceFreshness: "fresh",
      };
    });
}

export async function scanMm2JoinActivity({
  minimumRap = DEFAULT_TARGET_RAP,
  limit = DEFAULT_TARGET_COUNT,
} = {}) {
  const game = GAME_TARGETS.mm2;
  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );

  await syncWatchlistCandidates();

  const cachedPresences = getFreshGameLiveCachePresences(game, {
    minimumRap,
    limit: requestedLimit,
  });

  if (cachedPresences.length > 0) {
    const cachedPlayers = (
      await mapWithConcurrency(
        cachedPresences,
        VERIFY_CONCURRENCY,
        (presence) =>
          buildDiscoveredTargetPlayer(presence, {
            minimumValue: null,
            minimumRap,
            includeGameValue: false,
          }).catch(() => null),
      )
    )
      .filter((player) => player?.qualifies)
      .map(({ qualifies, ...player }) => ({
        ...player,
        presenceFreshness: "recent",
      }))
      .slice(0, requestedLimit);

    if (
      cachedPlayers.length >= requestedLimit ||
      Date.now() < presenceApiBackoffUntil
    ) {
      return {
        gameKey: "mm2",
        gameLabel: game.label,
        universeId: game.universeId,
        minimumValue: null,
        minimumRap,
        players: cachedPlayers,
        candidateCount: candidatePool.size,
        candidatePoolSize: candidatePool.size,
        candidateSourceCounts: getPoolSourceCounts(),
        presenceScannedCount: 0,
        gameActiveCount: cachedPlayers.length,
        verificationAttempts: cachedPlayers.length,
        valueUnavailableCount: 0,
        belowValueCount: 0,
        rapUnavailableCount: 0,
        belowRapCount: 0,
        verifiedCount: cachedPlayers.length,
        scanElapsedMs: 0,
        liveCacheHit: true,
        presenceRateLimited: Date.now() < presenceApiBackoffUntil,
        sources: [
          "Background verified RAP index",
          "Background Roblox live-presence cache",
          "Murder Mystery 2 activity filter",
        ],
      };
    }
  }

  const fresh = await scanGameTargets({
    gameKey: "mm2",
    minimumValue: null,
    minimumRap,
    limit: requestedLimit,
    includeGameValue: false,
  });

  if (cachedPresences.length === 0) {
    return {
      ...fresh,
      liveCacheHit: false,
      presenceRateLimited:
        fresh.presenceScannedCount === 0 &&
        Date.now() < presenceApiBackoffUntil,
    };
  }

  const cachedPlayers = (
    await mapWithConcurrency(
      cachedPresences,
      VERIFY_CONCURRENCY,
      (presence) =>
        buildDiscoveredTargetPlayer(presence, {
          minimumValue: null,
          minimumRap,
          includeGameValue: false,
        }).catch(() => null),
    )
  ).filter((player) => player?.qualifies);

  const merged = new Map();
  for (const player of [...cachedPlayers, ...(fresh.players ?? [])]) {
    const id = Number(player?.id);
    if (Number.isInteger(id) && id > 0 && !merged.has(id)) {
      merged.set(id, player);
    }
  }

  return {
    ...fresh,
    players: [...merged.values()].slice(0, requestedLimit),
    verifiedCount: Math.min(requestedLimit, merged.size),
    liveCacheHit: cachedPlayers.length > 0,
    gameActiveCount: Math.max(
      fresh.gameActiveCount ?? 0,
      cachedPlayers.length,
    ),
  };
}

export async function scanGameTargets({
  gameKey,
  minimumValue = null,
  minimumRap = getMinimumTargetRap(),
  limit = DEFAULT_TARGET_COUNT,
  includeGameValue = true,
} = {}) {
  const game = GAME_TARGETS[gameKey];
  if (!game) {
    throw new Error(`Unsupported game target key: ${gameKey}`);
  }

  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );

  const discovery = await discoverCandidateUserIds({
    minimumRap,
    minimumValue,
    respectCooldown: false,
    maxCandidatesOverride: getPositiveIntegerEnv(
      "ROBLOX_GAME_TARGET_MAX_CANDIDATES",
      DEFAULT_GAME_SCAN_CANDIDATES,
    ),
  });

  const startedAt = Date.now();
  const verifiedPlayers = [];
  const activeSeen = new Map();
  let presenceScannedCount = 0;
  let verificationAttempts = 0;
  let valueUnavailableCount = 0;
  let belowValueCount = 0;
  let rapUnavailableCount = 0;
  let belowRapCount = 0;

  for (
    let offset = 0;
    offset < discovery.userIds.length;
    offset += DEFAULT_GAME_SCAN_WAVE_SIZE
  ) {
    if (Date.now() - startedAt >= DEFAULT_GAME_SCAN_TIME_BUDGET_MS) break;
    if (verifiedPlayers.length >= requestedLimit) break;

    const wave = discovery.userIds.slice(
      offset,
      offset + DEFAULT_GAME_SCAN_WAVE_SIZE,
    );
    const presenceScan = await getPresenceBatched(wave);
    presenceScannedCount += presenceScan.checkedIds.length;

    if (presenceScan.rateLimited) presenceRateLimited = true;

    const gamePresences = presenceScan.presences
      .filter((presence) => isPresenceForGame(presence, game))
      .sort(
        (left, right) =>
          getCandidatePriority(
            candidatePool.get(Number(right.userId)),
            { minimumValue, minimumRap },
          ) -
          getCandidatePriority(
            candidatePool.get(Number(left.userId)),
            { minimumValue, minimumRap },
          ),
      );

    for (const presence of gamePresences) {
      activeSeen.set(Number(presence.userId), presence);
    }

    if (presenceScan.rateLimited && gamePresences.length === 0) {
      break;
    }

    for (
      let index = 0;
      index < gamePresences.length;
      index += VERIFY_CONCURRENCY
    ) {
      if (Date.now() - startedAt >= DEFAULT_GAME_SCAN_TIME_BUDGET_MS) break;
      if (verifiedPlayers.length >= requestedLimit) break;

      const batch = gamePresences.slice(index, index + VERIFY_CONCURRENCY);
      verificationAttempts += batch.length;

      const batchResults = await Promise.all(
        batch.map((presence) =>
          buildDiscoveredTargetPlayer(presence, {
            minimumValue,
            minimumRap,
          }).catch((error) => {
            console.warn(
              `${game.label} target verification failed for Roblox user ${presence.userId}:`,
              error,
            );
            return null;
          }),
        ),
      );

      for (const player of batchResults) {
        if (player?.qualifies) {
          verifiedPlayers.push(player);
        } else if (player?.reason === "value-unavailable") {
          valueUnavailableCount += 1;
        } else if (player?.reason === "below-value") {
          belowValueCount += 1;
        } else if (player?.reason === "rap-unavailable") {
          rapUnavailableCount += 1;
        } else if (player?.reason === "below-rap") {
          belowRapCount += 1;
        }
      }
    }
  }

  const stillInGamePlayers = await revalidatePlayersForGame(
    verifiedPlayers,
    game,
  );

  return {
    gameKey,
    gameLabel: game.label,
    universeId: game.universeId,
    minimumValue,
    minimumRap,
    players: shuffle(stillInGamePlayers)
      .slice(0, requestedLimit)
      .map(({ qualifies, ...player }) => player),
    candidateCount: discovery.userIds.length,
    candidatePoolSize: discovery.candidatePoolSize,
    candidateSourceCounts: discovery.candidateSourceCounts,
    presenceScannedCount,
    gameActiveCount: activeSeen.size,
    verificationAttempts,
    valueUnavailableCount,
    belowValueCount,
    rapUnavailableCount,
    belowRapCount,
    verifiedCount: stillInGamePlayers.length,
    presenceRateLimited,
    scanElapsedMs: Date.now() - startedAt,
    sources: [
      ...new Set([
        ...discovery.sources,
        "Roblox public presence",
        "Roblox public collectibles inventory",
        "Rolimon's public player info/value enrichment",
        ...(gameKey === "mm2"
          ? ["RBLXValue profile/inventory enrichment when available"]
          : []),
      ]),
    ],
  };
}

function isPresenceForGame(presence, game) {
  if (Number(presence?.userPresenceType) !== 2) {
    return false;
  }

  if (Number(presence?.universeId) === Number(game.universeId)) {
    return true;
  }

  const location = String(presence?.lastLocation ?? "").toLowerCase();
  return game.matches.some((match) => location.includes(match));
}

async function discoverCandidateUserIds({
  minimumValue = null,
  minimumRap = null,
  respectCooldown = true,
  excludeUserIds = null,
  maxCandidatesOverride = null,
} = {}) {
  const maxCandidates =
    Number.isInteger(Number(maxCandidatesOverride)) &&
    Number(maxCandidatesOverride) > 0
      ? Number(maxCandidatesOverride)
      : getPositiveIntegerEnv(
          "ROBLOX_TARGET_MAX_CANDIDATES",
          DEFAULT_MAX_CANDIDATES,
        );

  // Newly verified /scan users must be available to the very next /target
  // call; the broader source refresh can continue in the background.
  await syncWatchlistCandidates();

  if (candidatePool.size === 0) {
    await withTimeout(refreshCandidatePoolLightweight(), 8_000, null);
  } else if (
    Date.now() - lastCandidatePoolRefreshAt >=
    TARGET_POOL_REFRESH_INTERVAL_MS
  ) {
    void refreshCandidatePool();
  }

  const candidateSourceCounts = getPoolSourceCounts();
  const now = Date.now();
  const selection = selectCandidatesFromPool(maxCandidates, now, {
    respectCooldown,
    minimumValue,
    minimumRap,
    excludeUserIds,
  });

  return {
    userIds: selection.userIds,
    candidateSourceCounts,
    candidatePoolSize: candidatePool.size,
    freshCandidateCount: selection.freshCount,
    recentlyCheckedSkipped: selection.recentlyCheckedSkipped,
    excludedCandidateCount: selection.excludedCandidateCount,
    sources: [
      "Verified /scan RAP watchlist",
      "Roblox public limited owners",
      "Roblox Marketplace collectible owners",
      "Rolimon's value leaderboard",
      "Rolimon's recent trade ads",
      "Jailbreak Trading Network public trade listings",
    ],
  };
}


async function refreshCandidatePool() {
  if (candidateRefreshPromise) {
    return candidateRefreshPromise;
  }

  candidateRefreshPromise = refreshGeneralCandidatePool()
    .catch((error) => {
      console.warn("Candidate pool refresh failed:", error);
      return getPoolSourceCounts();
    })
    .finally(() => {
      lastCandidatePoolRefreshAt = Date.now();
      candidateRefreshPromise = null;
    });

  return candidateRefreshPromise;
}

async function syncWatchlistCandidates(now = Date.now()) {
  const watchedPlayers = await getScanWatchlist().catch((error) => {
    console.warn("Could not load scan watchlist into target discovery:", error);
    return [];
  });

  const watchlistUserIds = watchedPlayers
    .map((player) => Number(player?.userId))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  addCandidatesToPool(
    watchlistUserIds,
    "Verified /scan RAP watchlist",
    now,
  );

  for (const player of watchedPlayers) {
    const candidate = candidatePool.get(Number(player?.userId));
    if (!candidate) continue;

    const verifiedAt = Date.parse(
      player?.rapVerifiedAt ?? player?.addedAt ?? "",
    );
    const rapVerifiedAt = Number.isFinite(verifiedAt) ? verifiedAt : 0;

    if (Number.isFinite(Number(player?.rapValue))) {
      candidate.lastKnownRap = Number(player.rapValue);
      candidate.lastKnownRapAt = rapVerifiedAt;
      candidate.lastKnownRapSource = "Verified /scan RAP watchlist";
    }

    if (Number.isFinite(Number(player?.totalValue))) {
      candidate.lastKnownValue = Number(player.totalValue);
      candidate.lastKnownValueAt = rapVerifiedAt;
      candidate.lastKnownValueSource = "Verified /scan RAP watchlist";
    }
  }

  return watchlistUserIds;
}

async function refreshGeneralCandidatePool() {
  const now = Date.now();

  // Highest-signal source: users already verified by /scan at the configured RAP threshold.
  // This turns the bot's accumulated watchlist into its own persistent discovery index.
  const watchlistUserIds = await syncWatchlistCandidates(now);

  // Keep trade ads as one signal, but no longer make discovery depend on them.
  const tradeAdsResult = await getRecentTradeAdPlayers().catch((error) => {
    console.warn("Rolimon's trade-ad discovery failed:", error);
    return { players: [], itemIds: [] };
  });

  const tradeAdUserIds = [
    ...new Set(
      (tradeAdsResult?.players ?? [])
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];
  addCandidatesToPool(tradeAdUserIds, "Rolimon's recent trade ads", now);

  // Public Roblox limited ownership is the main non-trade-ad discovery route.
  // Rolimon's is used only to choose high-value seed item IDs; ownership itself
  // is verified against Roblox's public asset-owner endpoint.
  let limitedOwnerUserIds = [];
  if (now - lastLimitedOwnerRefreshAt >= LIMITED_OWNER_REFRESH_INTERVAL_MS) {
    limitedOwnerUserIds = await refreshLimitedOwnerCandidates(
      tradeAdsResult?.itemIds ?? [],
    );
    addCandidatesToPool(
      limitedOwnerUserIds,
      "Rolimon's limited catalog + Roblox public asset owners",
      now,
    );
    lastLimitedOwnerRefreshAt = now;
  }

  // Value-leaderboard accounts give the pool another independent discovery
  // path and provide useful value/RAP hints before expensive inventory checks.
  let leaderboardUserIds = [];
  if (
    now - lastLeaderboardRefreshAt >=
    ROLIMONS_LEADERBOARD_REFRESH_INTERVAL_MS
  ) {
    leaderboardUserIds = await refreshRolimonsLeaderboardCandidates();
    lastLeaderboardRefreshAt = now;
  }

  // Public Roblox Marketplace collectible owners add Roblox-native candidates
  // that do not have to be advertising a trade.
  let marketplaceStats = {
    marketplaceCreators: 0,
    marketplaceOwners: 0,
    marketplaceGroupMembers: 0,
  };
  if (now - lastMarketplaceRefreshAt >= MARKETPLACE_REFRESH_INTERVAL_MS) {
    marketplaceStats = await refreshMarketplaceCandidateSources().catch(
      (error) => {
        console.warn("Roblox Marketplace discovery failed:", error);
        return marketplaceStats;
      },
    );
    lastMarketplaceRefreshAt = now;
  }

  let jailbreakTradeUserIds = [];
  if (now - lastJailbreakTradeRefreshAt >= JAILBREAK_TRADE_REFRESH_INTERVAL_MS) {
    jailbreakTradeUserIds = await refreshJailbreakTradeCandidates().catch(
      (error) => {
        console.warn("Jailbreak Trading Network discovery failed:", error);
        return [];
      },
    );
    lastJailbreakTradeRefreshAt = now;
  }

  pruneCandidatePool();

  return {
    ...getPoolSourceCounts(),
    watchlist: watchlistUserIds.length,
    tradeAds: tradeAdUserIds.length,
    limitedOwners: limitedOwnerUserIds.length,
    leaderboard: leaderboardUserIds.length,
    jailbreakTrades: jailbreakTradeUserIds.length,
    ...marketplaceStats,
  };
}

async function refreshJailbreakTradeCandidates() {
  const result = await getJailbreakTradeCandidates();
  const ids = new Set(
    (result?.userIds ?? [])
      .map(Number)
      .filter((userId) => Number.isInteger(userId) && userId > 0),
  );

  const usernames = [...new Set(
    (result?.usernames ?? [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )].slice(0, 200);

  if (usernames.length > 0) {
    try {
      const resolved = await lookupRobloxUsers(usernames);
      for (const user of resolved ?? []) {
        const userId = Number(user?.id);
        if (Number.isInteger(userId) && userId > 0) ids.add(userId);
      }
    } catch (error) {
      console.warn("Could not resolve Jailbreak trade usernames:", error);
    }
  }

  const userIds = [...ids];
  addCandidatesToPool(
    userIds,
    "Jailbreak Trading Network public trade listings",
    Date.now(),
  );
  return userIds;
}

async function refreshMarketplaceCandidateSources() {
  const queryPlans = [
    { sortType: 2, sortAggregation: 5 },
    { sortType: 1, sortAggregation: 5 },
    { sortType: 3, sortAggregation: 1 },
  ];

  const resultSets = await Promise.all(
    queryPlans.map(async (plan) => {
      try {
        const result = await searchMarketplaceItems({
          category: 2,
          subcategory: 2,
          sortType: plan.sortType,
          sortAggregation: plan.sortAggregation,
          limit: 30,
        });
        return result.items;
      } catch (error) {
        console.warn("Roblox Marketplace discovery failed:", error);
        return [];
      }
    }),
  );

  const items = resultSets.flat();

  const creatorUserIds = [
    ...new Set(
      items
        .filter(
          (item) =>
            String(item?.creatorType ?? "").toLowerCase() === "user",
        )
        .map((item) => Number(item?.creatorTargetId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    creatorUserIds,
    "Roblox Marketplace creators",
    Date.now(),
  );

  const ownerSeedAssets = shuffle(
    items.filter((item) => {
      const restrictions = Array.isArray(item?.itemRestrictions)
        ? item.itemRestrictions
        : [];
      return (
        Number.isInteger(Number(item?.id)) &&
        restrictions.some((value) =>
          ["collectible", "limited", "limitedunique"].includes(
            String(value).toLowerCase(),
          ),
        )
      );
    }),
  )
    .slice(0, MARKETPLACE_OWNER_SEEDS)
    .map((item) => Number(item.id));

  const ownerLists = await mapWithConcurrency(
    ownerSeedAssets,
    OWNER_CONCURRENCY,
    async (assetId) => {
      try {
        const result = await getAssetOwners(assetId, {
          limit: MARKETPLACE_OWNER_LIMIT,
        });
        return result.owners;
      } catch (error) {
        console.warn(
          `Roblox Marketplace owner discovery failed for asset ${assetId}:`,
          error,
        );
        return [];
      }
    },
  );

  const ownerUserIds = [
    ...new Set(
      ownerLists
        .flat()
        .map((owner) => Number(owner?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    ownerUserIds,
    "Roblox Marketplace collectible owners",
    Date.now(),
  );

  const creatorGroupIds = shuffle([
    ...new Set(
      items
        .filter(
          (item) =>
            String(item?.creatorType ?? "").toLowerCase() === "group",
        )
        .map((item) => Number(item?.creatorTargetId))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
    ),
  ]).slice(0, MARKETPLACE_GROUP_SEEDS);

  const groupMemberLists = await mapWithConcurrency(
    creatorGroupIds,
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        const result = await getRobloxGroupUsers(groupId, {
          limit: GROUP_MEMBER_LIMIT,
        });
        return result.users;
      } catch (error) {
        console.warn(
          `Roblox Marketplace creator-group discovery failed for group ${groupId}:`,
          error,
        );
        return [];
      }
    },
  );

  const marketplaceGroupUserIds = [
    ...new Set(
      groupMemberLists
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    marketplaceGroupUserIds,
    "Roblox Marketplace creator-group members",
    Date.now(),
  );

  return {
    marketplaceCreators: creatorUserIds.length,
    marketplaceOwners: ownerUserIds.length,
    marketplaceGroupMembers: marketplaceGroupUserIds.length,
  };
}

async function refreshGroupCandidateSources() {
  const terms = nextGroupSearchTerms(GROUP_SEARCH_TERMS_PER_REFRESH);

  const groupSearchResults = await mapWithConcurrency(
    terms,
    GROUP_CONCURRENCY,
    async (term) => {
      try {
        const result = await searchRobloxGroups(term, { limit: 10 });
        return result.groups.slice(0, GROUPS_PER_SEARCH_TERM);
      } catch (error) {
        console.warn(`Roblox group search failed for "${term}":`, error);
        return [];
      }
    },
  );

  const searchedGroupIds = [
    ...new Set(
      groupSearchResults
        .flat()
        .map((group) => Number(group?.id ?? group?.groupId))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
    ),
  ];

  const searchedMemberLists = await mapWithConcurrency(
    searchedGroupIds,
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        const result = await getRobloxGroupUsers(groupId, {
          limit: GROUP_MEMBER_LIMIT,
        });
        return result.users;
      } catch (error) {
        console.warn(
          `Roblox group-member discovery failed for group ${groupId}:`,
          error,
        );
        return [];
      }
    },
  );

  const groupSearchUserIds = [
    ...new Set(
      searchedMemberLists
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    groupSearchUserIds,
    "Roblox public group search + group members",
    Date.now(),
  );

  const groupSeeds = selectGroupExpansionSeeds(
    GROUP_MEMBERSHIP_SEEDS_PER_REFRESH,
  );
  const membershipResults = await mapWithConcurrency(
    groupSeeds,
    GROUP_CONCURRENCY,
    async (candidate) => {
      try {
        const groups = await getUserRobloxGroups(candidate.userId);
        candidate.lastGroupExpandedAt = Date.now();
        return groups;
      } catch (error) {
        candidate.lastGroupExpandedAt = Date.now();
        console.warn(
          `Roblox user-group expansion failed for user ${candidate.userId}:`,
          error,
        );
        return [];
      }
    },
  );

  const graphGroupIds = shuffle([
    ...new Set(
      membershipResults
        .flat()
        .map((group) => Number(group?.id))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
    ),
  ]).slice(0, 8);

  const graphMemberLists = await mapWithConcurrency(
    graphGroupIds,
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        const result = await getRobloxGroupUsers(groupId, {
          limit: GROUP_MEMBER_LIMIT,
        });
        return result.users;
      } catch (error) {
        console.warn(
          `Roblox group-graph member discovery failed for group ${groupId}:`,
          error,
        );
        return [];
      }
    },
  );

  const groupGraphUserIds = [
    ...new Set(
      graphMemberLists
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    groupGraphUserIds,
    "Roblox public user-group graph + group members",
    Date.now(),
  );

  const friendGroupSeeds = selectFriendGroupExpansionSeeds(
    FRIEND_GROUP_SEEDS_PER_REFRESH,
  );
  const friendGroupResults = await mapWithConcurrency(
    friendGroupSeeds,
    GROUP_CONCURRENCY,
    async (candidate) => {
      try {
        const groups = await getFriendGroupRoles(candidate.userId);
        candidate.lastFriendGroupExpandedAt = Date.now();
        return groups;
      } catch (error) {
        candidate.lastFriendGroupExpandedAt = Date.now();
        console.warn(
          `Roblox friends-group expansion failed for user ${candidate.userId}:`,
          error,
        );
        return [];
      }
    },
  );

  const friendGroupIds = shuffle([
    ...new Set(
      friendGroupResults
        .flat()
        .map((group) => Number(group?.id))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
    ),
  ]).slice(0, 8);

  const friendGroupMemberLists = await mapWithConcurrency(
    friendGroupIds,
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        const result = await getRobloxGroupUsers(groupId, {
          limit: GROUP_MEMBER_LIMIT,
        });
        return result.users;
      } catch (error) {
        console.warn(
          `Roblox friend-group member discovery failed for group ${groupId}:`,
          error,
        );
        return [];
      }
    },
  );

  const friendGroupUserIds = [
    ...new Set(
      friendGroupMemberLists
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    friendGroupUserIds,
    "Roblox friends' public groups + group members",
    Date.now(),
  );

  const primarySeeds = selectPrimaryGroupExpansionSeeds(
    PRIMARY_GROUP_SEEDS_PER_REFRESH,
  );
  const primaryGroupResults = await mapWithConcurrency(
    primarySeeds,
    GROUP_CONCURRENCY,
    async (candidate) => {
      try {
        const group = await getUserPrimaryGroup(candidate.userId);
        candidate.lastPrimaryGroupExpandedAt = Date.now();
        return group;
      } catch (error) {
        candidate.lastPrimaryGroupExpandedAt = Date.now();
        console.warn(
          `Roblox primary-group discovery failed for user ${candidate.userId}:`,
          error,
        );
        return null;
      }
    },
  );

  const primaryGroupIds = [
    ...new Set(
      primaryGroupResults
        .map((group) => Number(group?.id))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
    ),
  ];

  const primaryGroupMemberLists = await mapWithConcurrency(
    primaryGroupIds.slice(0, 8),
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        const result = await getRobloxGroupUsers(groupId, {
          limit: GROUP_MEMBER_LIMIT,
        });
        return result.users;
      } catch (error) {
        console.warn(
          `Roblox primary-group member discovery failed for group ${groupId}:`,
          error,
        );
        return [];
      }
    },
  );

  const primaryGroupUserIds = [
    ...new Set(
      primaryGroupMemberLists
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    primaryGroupUserIds,
    "Roblox public primary-group members",
    Date.now(),
  );

  const discoveredGroupIds = shuffle([
    ...new Set([
      ...searchedGroupIds,
      ...graphGroupIds,
      ...friendGroupIds,
      ...primaryGroupIds,
    ]),
  ]);

  const detailGroupIds = discoveredGroupIds.slice(
    0,
    GROUP_DETAIL_SEEDS_PER_REFRESH,
  );

  const groupDetails = await mapWithConcurrency(
    detailGroupIds,
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        return await getRobloxGroupDetails(groupId);
      } catch (error) {
        console.warn(
          `Roblox group-owner discovery failed for group ${groupId}:`,
          error,
        );
        return null;
      }
    },
  );

  const groupOwnerUserIds = [
    ...new Set(
      groupDetails
        .map((group) =>
          Number(
            group?.owner?.userId ??
            group?.owner?.id ??
            group?.ownerUserId,
          ),
        )
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    groupOwnerUserIds,
    "Roblox public group owners",
    Date.now(),
  );

  const wallGroupIds = discoveredGroupIds.slice(
    0,
    GROUP_WALL_SEEDS_PER_REFRESH,
  );
  const wallResults = await mapWithConcurrency(
    wallGroupIds,
    GROUP_CONCURRENCY,
    async (groupId) => {
      try {
        const result = await getRobloxGroupWallPosters(groupId, {
          limit: 50,
        });
        return result.users;
      } catch (error) {
        console.warn(
          `Roblox group-wall discovery failed for group ${groupId}:`,
          error,
        );
        return [];
      }
    },
  );

  const wallPosterUserIds = [
    ...new Set(
      wallResults
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    wallPosterUserIds,
    "Roblox public group wall posters",
    Date.now(),
  );

  const relationshipGroupIds = discoveredGroupIds.slice(
    0,
    GROUP_RELATIONSHIP_SEEDS_PER_REFRESH,
  );

  async function expandRelatedGroups(relationshipType, sourceLabel) {
    const relationshipResults = await mapWithConcurrency(
      relationshipGroupIds,
      GROUP_CONCURRENCY,
      async (groupId) => {
        try {
          const result = await getRobloxGroupRelationships(
            groupId,
            relationshipType,
            { limit: 50 },
          );
          return result.groups;
        } catch (error) {
          console.warn(
            `Roblox ${relationshipType} relationship discovery failed for group ${groupId}:`,
            error,
          );
          return [];
        }
      },
    );

    const relatedGroupIds = shuffle([
      ...new Set(
        relationshipResults
          .flat()
          .map((group) => Number(group?.id))
          .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
      ),
    ]).slice(0, 8);

    const memberResults = await mapWithConcurrency(
      relatedGroupIds,
      GROUP_CONCURRENCY,
      async (groupId) => {
        try {
          const result = await getRobloxGroupUsers(groupId, {
            limit: GROUP_MEMBER_LIMIT,
          });
          return result.users;
        } catch (error) {
          console.warn(
            `Roblox related-group member discovery failed for group ${groupId}:`,
            error,
          );
          return [];
        }
      },
    );

    const userIds = [
      ...new Set(
        memberResults
          .flat()
          .map((user) => Number(user?.id))
          .filter((userId) => Number.isInteger(userId) && userId > 0),
      ),
    ];

    addCandidatesToPool(userIds, sourceLabel, Date.now());
    return userIds;
  }

  const [allyGroupUserIds, enemyGroupUserIds] = await Promise.all([
    expandRelatedGroups(
      "Allies",
      "Roblox public allied-group members",
    ),
    expandRelatedGroups(
      "Enemies",
      "Roblox public enemy-group members",
    ),
  ]);

  return {
    groupSearchMembers: groupSearchUserIds.length,
    groupGraphMembers: groupGraphUserIds.length,
    friendGroupMembers: friendGroupUserIds.length,
    primaryGroupMembers: primaryGroupUserIds.length,
    groupOwners: groupOwnerUserIds.length,
    groupWallPosters: wallPosterUserIds.length,
    allyGroupMembers: allyGroupUserIds.length,
    enemyGroupMembers: enemyGroupUserIds.length,
  };
}

async function refreshRolimonsLeaderboardCandidates() {
  const pages = nextLeaderboardPages(
    Math.max(
      1,
      Math.min(
        50,
        getPositiveIntegerEnv(
          "ROBLOX_TARGET_LEADERBOARD_PAGES_PER_REFRESH",
          DEFAULT_ROLIMONS_LEADERBOARD_PAGES_PER_REFRESH,
        ),
      ),
    ),
  );

  const results = await mapWithConcurrency(
    pages,
    2,
    async (page) => {
      try {
        const result = await getRolimonsLeaderboardPlayers(page);
        return result.players;
      } catch (error) {
        console.warn(
          `Rolimon's leaderboard discovery failed for page ${page}:`,
          error,
        );
        return [];
      }
    },
  );

  const players = results.flat();
  const userIds = [
    ...new Set(
      players
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    userIds,
    "Rolimon's value leaderboard",
    Date.now(),
  );

  for (const player of players) {
    const userId = Number(player?.userId);
    const candidate = candidatePool.get(userId);
    if (!candidate) continue;

    if (Number.isFinite(Number(player?.totalRAP))) {
      candidate.lastKnownRap = Number(player.totalRAP);
      candidate.lastKnownRapAt = Date.now();
      candidate.lastKnownRapSource =
        "Rolimon's value leaderboard";
    }

    if (Number.isFinite(Number(player?.totalValue))) {
      candidate.lastKnownValue = Number(player.totalValue);
    }
  }

  return userIds;
}

function nextLeaderboardPages(count) {
  const pages = [];
  for (let index = 0; index < count; index += 1) {
    pages.push(leaderboardPageCursor);
    leaderboardPageCursor =
      leaderboardPageCursor >= 40 ? 1 : leaderboardPageCursor + 1;
  }
  return pages;
}

function selectFollowExpansionSeeds(limit) {
  return [...candidatePool.values()]
    .sort(
      (left, right) =>
        (left.lastFollowExpandedAt || 0) -
        (right.lastFollowExpandedAt || 0),
    )
    .slice(0, Math.max(1, limit));
}

function selectFriendGroupExpansionSeeds(limit) {
  return [...candidatePool.values()]
    .sort(
      (left, right) =>
        (left.lastFriendGroupExpandedAt || 0) -
        (right.lastFriendGroupExpandedAt || 0),
    )
    .slice(0, Math.max(1, limit));
}

function selectPrimaryGroupExpansionSeeds(limit) {
  return [...candidatePool.values()]
    .sort(
      (left, right) =>
        (left.lastPrimaryGroupExpandedAt || 0) -
        (right.lastPrimaryGroupExpandedAt || 0),
    )
    .slice(0, Math.max(1, limit));
}

function selectGroupExpansionSeeds(limit) {
  return [...candidatePool.values()]
    .sort(
      (left, right) =>
        (left.lastGroupExpandedAt || 0) -
        (right.lastGroupExpandedAt || 0),
    )
    .slice(0, Math.max(1, limit));
}

function nextGroupSearchTerms(count) {
  const terms = [];
  for (let index = 0; index < count; index += 1) {
    terms.push(
      GROUP_SEARCH_TERMS[groupSearchTermCursor % GROUP_SEARCH_TERMS.length],
    );
    groupSearchTermCursor += 1;
  }
  return terms;
}

async function refreshLimitedOwnerCandidates(tradeAdItemIds = []) {
  try {
    const dataset = await getRolimonsItems();
    const seedItemCount = getPositiveIntegerEnv(
      "ROBLOX_TARGET_SEED_ITEM_COUNT",
      DEFAULT_SEED_ITEM_COUNT,
    );
    const ownersPerItem = getPositiveIntegerEnv(
      "ROBLOX_TARGET_OWNERS_PER_ITEM",
      DEFAULT_OWNERS_PER_ITEM,
    );
    const seedFloor = getPositiveIntegerEnv(
      "ROBLOX_TARGET_SEED_MIN_ITEM_RAP",
      DEFAULT_SEED_MIN_ITEM_RAP,
    );

    const tradeAdSeeds = shuffle(
      tradeAdItemIds
        .map((itemId) => dataset.byId.get(String(itemId)))
        .filter(Boolean)
        .filter(
          (item) =>
            Math.max(Number(item.rap) || 0, Number(item.value) || 0) >=
            seedFloor,
        ),
    );

    const eligibleSeeds = dataset.items
      .filter(
        (item) =>
          Math.max(Number(item.rap) || 0, Number(item.value) || 0) >=
          seedFloor,
      )
      .sort(
        (left, right) =>
          Math.max(Number(right.rap) || 0, Number(right.value) || 0) -
          Math.max(Number(left.rap) || 0, Number(left.value) || 0),
      );

    const rotatingSeeds = [];
    if (eligibleSeeds.length > 0) {
      const rotatingCount = Math.max(seedItemCount * 2, 24);
      for (let index = 0; index < rotatingCount; index += 1) {
        rotatingSeeds.push(
          eligibleSeeds[(limitedSeedCursor + index) % eligibleSeeds.length],
        );
      }
      limitedSeedCursor =
        (limitedSeedCursor + rotatingCount) % eligibleSeeds.length;
    }

    const seedItems = takeUniqueItems(
      [...tradeAdSeeds, ...rotatingSeeds],
      seedItemCount,
    );

    const ownerPromise = mapWithConcurrency(
      seedItems,
      OWNER_CONCURRENCY,
      async (item) => {
        try {
          const result = await getAssetOwners(item.id, {
            limit: ownersPerItem,
          });
          return result.owners;
        } catch (error) {
          console.warn(
            `Limited-owner discovery failed for ${item.name} (${item.id}):`,
            error,
          );
          return [];
        }
      },
    );

    const ownerLists = await withTimeout(
      ownerPromise,
      OWNER_DISCOVERY_BUDGET_MS,
      [],
    );

    return [
      ...new Set(
        ownerLists
          .flat()
          .map((owner) => Number(owner?.userId))
          .filter((userId) => Number.isInteger(userId) && userId > 0),
      ),
    ];
  } catch (error) {
    console.warn("Rolimon's limited-owner discovery failed:", error);
    return [];
  }
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

function selectSocialExpansionSeeds(limit) {
  return [...candidatePool.values()]
    .sort(
      (left, right) =>
        (left.lastSocialExpandedAt || 0) -
        (right.lastSocialExpandedAt || 0),
    )
    .slice(0, Math.max(1, limit));
}

function nextSearchTerms(count) {
  const terms = [];
  for (let index = 0; index < count; index += 1) {
    terms.push(SEARCH_TERMS[searchTermCursor % SEARCH_TERMS.length]);
    searchTermCursor += 1;
  }
  return terms;
}

async function buildDiscoveredTargetPlayer(
  presence,
  {
    minimumValue = null,
    minimumRap = null,
    includeGameValue = true,
  } = {},
) {
  const userId = Number(presence.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  const candidate = candidatePool.get(userId);
  const trustedRapTtlMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_TRUSTED_RAP_TTL_MS",
    DEFAULT_TRUSTED_RAP_TTL_MS,
  );
  const hasFreshTrustedRap =
    minimumValue === null &&
    minimumRap !== null &&
    Number.isFinite(Number(candidate?.lastKnownRap)) &&
    Number(candidate.lastKnownRap) >= Number(minimumRap) &&
    Number.isFinite(Number(candidate?.lastKnownRapAt)) &&
    Date.now() - Number(candidate.lastKnownRapAt) <= trustedRapTtlMs;

  if (hasFreshTrustedRap) {
    const [userResult, avatarResult] = await Promise.allSettled([
      getRobloxUserById(userId),
      getAvatarThumbnail(userId),
    ]);

    const user =
      userResult.status === "fulfilled" && userResult.value
        ? userResult.value
        : {
            id: userId,
            name: `user-${userId}`,
            displayName: `Roblox user ${userId}`,
          };

    let gameName = presence.lastLocation ?? "Online";
    if (presence.universeId) {
      try {
        const game = await getGameDetails(presence.universeId);
        gameName = game?.name ?? gameName;
      } catch (error) {
        console.warn(`Could not load target game ${presence.universeId}:`, error);
      }
    }
    const joinability = buildTargetJoinability(presence, userId);

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
      ...joinability,
      rapValue: Number(candidate.lastKnownRap),
      rapSource:
        candidate.lastKnownRapSource ?? "Recently verified public RAP",
      rapIsPartial: false,
      totalValue: Number.isFinite(Number(candidate?.lastKnownValue))
        ? Number(candidate.lastKnownValue)
        : null,
      valueSource: candidate.lastKnownValueSource ?? "Unavailable",
      premiumStatus: "Unavailable",
      gameValue: null,
      topLimiteds: [],
    };
  }

  const [userResult, avatarResult, inventoryResult, rolimonsResult] =
    await Promise.allSettled([
      getRobloxUserById(userId),
      getAvatarThumbnail(userId),
      getInventorySummary(userId),
      getRolimonsPlayerSource(userId),
    ]);

  const user =
    userResult.status === "fulfilled" && userResult.value
      ? userResult.value
      : {
          id: userId,
          name: `user-${userId}`,
          displayName: `Roblox user ${userId}`,
        };

  let inventory =
    inventoryResult.status === "fulfilled" ? inventoryResult.value : null;
  const rolimons =
    rolimonsResult.status === "fulfilled" ? rolimonsResult.value : null;

  if (inventory?.status === "public" && inventory?.items?.length > 0) {
    try {
      inventory = await enrichInventoryWithRolimons(inventory);
    } catch (error) {
      console.warn(
        `Could not enrich Roblox inventory with Rolimon's values for ${userId}:`,
        error,
      );
    }
  }

  let { rapValue, rapSource, rapIsPartial } = chooseRapSource(
    inventory,
    rolimons,
  );

  let totalValue =
    typeof rolimons?.totalValue === "number"
      ? rolimons.totalValue
      : typeof inventory?.totalValue === "number"
        ? inventory.totalValue
        : Number.isFinite(Number(candidate?.lastKnownValue))
          ? Number(candidate.lastKnownValue)
          : null;

  let valueSource =
    typeof rolimons?.totalValue === "number"
      ? "Rolimon's public player info"
      : typeof inventory?.totalValue === "number"
        ? "Roblox public inventory + Rolimon's item values"
        : Number.isFinite(Number(candidate?.lastKnownValue))
          ? "Rolimon's value leaderboard"
          : "Unavailable";

  if (
    typeof rapValue !== "number" &&
    Number.isFinite(Number(candidate?.lastKnownRap))
  ) {
    rapValue = Number(candidate.lastKnownRap);
    rapSource =
      candidate.lastKnownRapSource ??
      "Rolimon's value leaderboard";
    rapIsPartial = false;
  }

  if (candidate) {
    if (typeof rapValue === "number") {
      candidate.lastKnownRap = rapValue;
      candidate.lastKnownRapAt = Date.now();
      candidate.lastKnownRapSource = rapSource;
    }
    if (typeof totalValue === "number") {
      candidate.lastKnownValue = totalValue;
      candidate.lastKnownValueAt = Date.now();
      candidate.lastKnownValueSource = valueSource;
    }
  }

  if (minimumValue !== null && minimumValue !== undefined) {
    if (typeof totalValue !== "number") {
      return {
        qualifies: false,
        id: userId,
        reason: "value-unavailable",
      };
    }
    if (totalValue < minimumValue) {
      return {
        qualifies: false,
        id: userId,
        reason: "below-value",
      };
    }
  }

  if (minimumRap !== null && minimumRap !== undefined) {
    if (typeof rapValue !== "number") {
      return {
        qualifies: false,
        id: userId,
        reason: "rap-unavailable",
      };
    }
    if (rapValue < minimumRap) {
      return {
        qualifies: false,
        id: userId,
        reason: "below-rap",
      };
    }
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

  const joinability = buildTargetJoinability(presence, userId);

  let gameValue = null;
  if (includeGameValue) {
    const gameValueResult = await Promise.allSettled([
      scanGameValue({
        gameName,
        userId,
        username: user.name,
      }),
    ]);
    gameValue =
      gameValueResult[0].status === "fulfilled"
        ? gameValueResult[0].value
        : null;
  }

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
    ...joinability,
    rapValue,
    rapSource,
    rapIsPartial,
    totalValue,
    valueSource,
    premiumStatus: rolimons?.premiumStatus ?? "Unavailable",
    gameValue,
    topLimiteds: getTopLimiteds(inventory),
  };
}

function buildTargetJoinability(presence, userId) {
  const normalizedUserId = Number(userId);
  const placeId = Number(presence?.placeId);
  const gameId = presence?.gameId ? String(presence.gameId) : null;
  const followJoinUrl = getFollowUserJoinUrl(normalizedUserId);

  // /target uses the profile-follow join route that mirrors the Join button
  // users see on Roblox profiles. Do not paginate public server lists here:
  // that made target verification slow and contributed unnecessary API load.
  return {
    placeId: Number.isInteger(placeId) && placeId > 0 ? placeId : null,
    gameId,
    followJoinUrl,
    exactJoinUrl: null,
    joinReady: Boolean(followJoinUrl),
    publicServerConfirmed: false,
    joinabilityStatus: followJoinUrl
      ? "Profile follow-join available"
      : "Unavailable",
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

async function revalidateCurrentlyInGame(players) {
  if (!Array.isArray(players) || players.length === 0) {
    return {
      players: [],
      leftGameCount: 0,
      unavailableCount: 0,
      rateLimited: false,
    };
  }

  const userIds = players
    .map((player) => Number(player?.id))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  if (Date.now() < presenceApiBackoffUntil) {
    return {
      players: [],
      leftGameCount: 0,
      unavailableCount: userIds.length,
      rateLimited: true,
    };
  }

  const check = await getPresenceBatched(userIds, {
    batchSize: FINAL_RECHECK_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 500,
    stopOnRateLimit: true,
  });

  const presenceByUserId = new Map(
    check.presences.map((presence) => [
      Number(presence.userId),
      presence,
    ]),
  );
  const checkedIds = new Set(check.checkedIds.map(Number));

  const inGameByUserId = new Map(
    [...presenceByUserId.entries()].filter(
      ([, presence]) => Number(presence?.userPresenceType) === 2,
    ),
  );

  const confirmedPlayers = players
    .filter((player) => inGameByUserId.has(Number(player.id)))
    .map((player) => {
      const presence = inGameByUserId.get(Number(player.id));
      return {
        ...player,
        presenceStatus: "In game",
        gameName: presence?.lastLocation || player.gameName,
        placeId: presence?.placeId ?? player.placeId ?? null,
        gameId: presence?.gameId ?? player.gameId ?? null,
        followJoinUrl:
          player.followJoinUrl ?? getFollowUserJoinUrl(player.id),
        presenceVerifiedAt: Date.now(),
      };
    })
    .sort((left, right) => {
      if (left.publicServerConfirmed !== right.publicServerConfirmed) {
        return Number(right.publicServerConfirmed) -
          Number(left.publicServerConfirmed);
      }
      if (left.joinReady !== right.joinReady) {
        return Number(right.joinReady) - Number(left.joinReady);
      }
      return 0;
    });

  return {
    players: confirmedPlayers,
    leftGameCount: players.filter((player) => {
      const id = Number(player.id);
      return checkedIds.has(id) && !inGameByUserId.has(id);
    }).length,
    unavailableCount: players.filter(
      (player) => !checkedIds.has(Number(player.id)),
    ).length,
    rateLimited: check.rateLimited === true,
  };
}

export async function getPresenceBatched(
  userIds,
  optionsOrFetcher = getUsersPresence,
) {
  const options =
    typeof optionsOrFetcher === "function" ? {} : (optionsOrFetcher ?? {});
  const presenceFetcher =
    typeof optionsOrFetcher === "function"
      ? optionsOrFetcher
      : options.presenceFetcher ?? getUsersPresence;
  const batchSize = Math.max(
    1,
    Number(options.batchSize) || PRESENCE_BATCH_SIZE,
  );
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
  const interBatchDelayMs = Math.max(
    0,
    Number(options.interBatchDelayMs) || 0,
  );
  const individualFallback = options.individualFallback === true;
  const fallbackFetcher =
    typeof options.fallbackFetcher === "function"
      ? options.fallbackFetcher
      : null;
  const stopOnRateLimit = options.stopOnRateLimit !== false;

  const presences = [];
  const checkedIds = [];
  let rateLimited = false;

  for (let index = 0; index < userIds.length; index += batchSize) {
    const batch = userIds
      .slice(index, index + batchSize)
      .map(Number)
      .filter((userId) => Number.isInteger(userId) && userId > 0);

    const pending = new Set(batch);
    const resolved = new Map();

    for (
      let attempt = 0;
      attempt < maxAttempts && pending.size > 0;
      attempt += 1
    ) {
      const requestedIds = [...pending];

      try {
        const result = await presenceFetcher(requestedIds);
        const returned = Array.isArray(result) ? result : [];

        for (const presence of returned) {
          const userId = Number(presence?.userId);
          if (!pending.has(userId)) continue;
          resolved.set(userId, presence);
          pending.delete(userId);
        }

        // Roblox can occasionally answer 200 with an empty/partial presence
        // list. Treat missing requested IDs as transient and retry them.
        if (pending.size > 0 && attempt < maxAttempts - 1) {
          await sleep(250 * 2 ** attempt);
        }
      } catch (error) {
        const status = Number(error?.status);
        if (status === 429) {
          rateLimited = true;
          presenceApiBackoffUntil = Math.max(
            presenceApiBackoffUntil,
            Date.now() +
              getPositiveIntegerEnv(
                "ROBLOX_PRESENCE_API_BACKOFF_MS",
                DEFAULT_PRESENCE_API_BACKOFF_MS,
              ),
          );
          console.warn(
            "Roblox presence API rate-limited; entering shared backoff.",
          );
          break;
        }

        const retryable = status === 408 || status >= 500;

        if (!retryable || attempt >= maxAttempts - 1) {
          console.warn("Roblox presence batch failed:", error);
          break;
        }

        const delayMs = 400 * 2 ** attempt;
        console.warn(
          `Roblox presence batch unavailable (HTTP ${status || "?"}); retrying in ${delayMs}ms.`,
        );
        await sleep(delayMs);
      }
    }

    if (!rateLimited && individualFallback && pending.size > 0) {
      for (const userId of [...pending]) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const result = await presenceFetcher([userId]);
            const presence = (Array.isArray(result) ? result : []).find(
              (entry) => Number(entry?.userId) === userId,
            );

            if (presence) {
              resolved.set(userId, presence);
              pending.delete(userId);
              break;
            }
          } catch (error) {
            const status = Number(error?.status);
            const retryable =
              status === 429 ||
              status === 408 ||
              status >= 500;
            if (!retryable || attempt >= 1) break;
          }

          await sleep(200 * (attempt + 1));
        }
      }
    }

    // If the official Roblox presence route omitted an ID even after retries,
    // use a separate public Roblox API proxy as a final fresh signal. We still
    // require an explicit InGame presence before returning a target.
    if (!rateLimited && fallbackFetcher && pending.size > 0) {
      try {
        const fallbackResult = await fallbackFetcher([...pending]);
        for (const presence of Array.isArray(fallbackResult) ? fallbackResult : []) {
          const userId = Number(presence?.userId);
          if (!pending.has(userId)) continue;
          resolved.set(userId, {
            ...presence,
            presenceSource: "RoProxy public Roblox API proxy",
          });
          pending.delete(userId);
        }
      } catch (error) {
        console.warn("Secondary public presence route failed:", error);
      }
    }

    presences.push(...resolved.values());
    checkedIds.push(...resolved.keys());

    if (rateLimited && stopOnRateLimit) {
      break;
    }

    if (index + batchSize < userIds.length) {
      await sleep(interBatchDelayMs || 120);
    }
  }

  return {
    presences,
    checkedIds: [...new Set(checkedIds)],
    rateLimited,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPoolSourceCounts() {
  const counts = {
    userSearch: 0,
    socialGraph: 0,
    followers: 0,
    followings: 0,
    watchlist: 0,
    tradeAds: 0,
    jailbreakTrades: 0,
    rolimonsSearch: 0,
    leaderboard: 0,
    limitedOwners: 0,
    marketplaceCreators: 0,
    marketplaceOwners: 0,
    marketplaceGroupMembers: 0,
    groupSearchMembers: 0,
    groupGraphMembers: 0,
    friendGroupMembers: 0,
    primaryGroupMembers: 0,
    groupOwners: 0,
    groupWallPosters: 0,
    allyGroupMembers: 0,
    enemyGroupMembers: 0,
  };

  const sourceToKey = new Map([
    ["Verified /scan RAP watchlist", "watchlist"],
    ["Roblox public user search", "userSearch"],
    ["Roblox public friends graph", "socialGraph"],
    ["Roblox public followers", "followers"],
    ["Roblox public followings", "followings"],
    ["Rolimon's recent trade ads", "tradeAds"],
    ["Jailbreak Trading Network public trade listings", "jailbreakTrades"],
    ["Rolimon's player search", "rolimonsSearch"],
    ["Rolimon's value leaderboard", "leaderboard"],
    [
      "Rolimon's limited catalog + Roblox public asset owners",
      "limitedOwners",
    ],
    ["Roblox Marketplace creators", "marketplaceCreators"],
    ["Roblox Marketplace collectible owners", "marketplaceOwners"],
    [
      "Roblox Marketplace creator-group members",
      "marketplaceGroupMembers",
    ],
    [
      "Roblox public group search + group members",
      "groupSearchMembers",
    ],
    [
      "Roblox public user-group graph + group members",
      "groupGraphMembers",
    ],
    [
      "Roblox friends' public groups + group members",
      "friendGroupMembers",
    ],
    ["Roblox public primary-group members", "primaryGroupMembers"],
    ["Roblox public group owners", "groupOwners"],
    ["Roblox public group wall posters", "groupWallPosters"],
    ["Roblox public allied-group members", "allyGroupMembers"],
    ["Roblox public enemy-group members", "enemyGroupMembers"],
  ]);

  for (const candidate of candidatePool.values()) {
    for (const source of candidate.sources ?? []) {
      const key = sourceToKey.get(source);
      if (key) counts[key] += 1;
    }
  }

  return counts;
}

function getCandidatePriority(
  candidate,
  { minimumValue = null, minimumRap = null } = {},
) {
  const sources = candidate?.sources ?? new Set();
  let score = 0;

  if (liveTargetCache.has(Number(candidate?.userId))) {
    score += 1_000;
  }

  if (
    minimumValue !== null &&
    Number.isFinite(Number(candidate?.lastKnownValue)) &&
    Number(candidate.lastKnownValue) >= Number(minimumValue)
  ) {
    score += 320;
  }

  if (
    minimumRap !== null &&
    Number.isFinite(Number(candidate?.lastKnownRap)) &&
    Number(candidate.lastKnownRap) >= Number(minimumRap)
  ) {
    score += 250;
  }

  const weights = new Map([
    ["Verified /scan RAP watchlist", 500],
    ["Rolimon's value leaderboard", 120],
    [
      "Rolimon's limited catalog + Roblox public asset owners",
      110,
    ],
    ["Roblox Marketplace collectible owners", 100],
    ["Rolimon's recent trade ads", 95],
    ["Rolimon's player search", 80],
    ["Roblox Marketplace creators", 55],
    ["Roblox public group owners", 45],
    ["Roblox public user search", 30],
    ["Roblox public followers", 25],
    ["Roblox public followings", 25],
    ["Roblox public friends graph", 20],
  ]);

  for (const source of sources) {
    score += weights.get(source) ?? 10;
  }

  score += Math.max(0, sources.size - 1) * 15;
  return score;
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
      lastSocialExpandedAt: 0,
      lastFollowExpandedAt: 0,
      lastGroupExpandedAt: 0,
      lastFriendGroupExpandedAt: 0,
      lastPrimaryGroupExpandedAt: 0,
      lastKnownRap: null,
      lastKnownRapAt: 0,
      lastKnownRapSource: null,
      lastKnownValue: null,
      lastKnownValueAt: 0,
      lastKnownValueSource: null,
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

function selectCandidatesFromPool(
  limit,
  now = Date.now(),
  {
    respectCooldown = true,
    minimumValue = null,
    minimumRap = null,
    excludeUserIds = null,
  } = {},
) {
  const cooldownMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_RECENT_CHECK_COOLDOWN_MS",
    DEFAULT_RECENT_CHECK_COOLDOWN_MS,
  );

  const hotWatchlist = [];
  const fresh = [];
  const coolingDown = [];
  let excludedCandidateCount = 0;
  const excluded =
    excludeUserIds instanceof Set
      ? excludeUserIds
      : new Set(excludeUserIds ?? []);

  for (const candidate of candidatePool.values()) {
    if (excluded.has(Number(candidate.userId))) {
      excludedCandidateCount += 1;
      continue;
    }

    // Known 450k+ /scan hits are the hot pool for /target.
    // They bypass the normal cooldown so every /target run checks them first.
    if (
      candidate.sources?.has("Verified /scan RAP watchlist") &&
      (minimumRap === null ||
        minimumRap === undefined ||
        (Number.isFinite(Number(candidate.lastKnownRap)) &&
          Number(candidate.lastKnownRap) >= Number(minimumRap)))
    ) {
      hotWatchlist.push(candidate);
      continue;
    }

    if (
      !respectCooldown ||
      !candidate.lastCheckedAt ||
      now - candidate.lastCheckedAt >= cooldownMs
    ) {
      fresh.push(candidate);
    } else {
      coolingDown.push(candidate);
    }
  }

  const prioritizedWatchlist = shuffle(hotWatchlist).sort((left, right) => {
    const priorityDelta =
      getCandidatePriority(right, { minimumValue, minimumRap }) -
      getCandidatePriority(left, { minimumValue, minimumRap });
    if (priorityDelta !== 0) return priorityDelta;
    return (left.lastCheckedAt || 0) - (right.lastCheckedAt || 0);
  });

  const neverChecked = shuffle(
    fresh.filter((candidate) => !candidate.lastCheckedAt),
  ).sort(
    (left, right) =>
      getCandidatePriority(right, { minimumValue, minimumRap }) -
      getCandidatePriority(left, { minimumValue, minimumRap }),
  );

  const previouslyChecked = shuffle(
    fresh.filter((candidate) => candidate.lastCheckedAt),
  ).sort((left, right) => {
    const priorityDelta =
      getCandidatePriority(right, { minimumValue, minimumRap }) -
      getCandidatePriority(left, { minimumValue, minimumRap });
    if (priorityDelta !== 0) return priorityDelta;
    return left.lastCheckedAt - right.lastCheckedAt;
  });

  const preferred = [
    ...prioritizedWatchlist,
    ...neverChecked,
    ...previouslyChecked,
  ];
  const fallbackCooling = [...coolingDown].sort(
    (left, right) => left.lastCheckedAt - right.lastCheckedAt,
  );

  const selectedCandidates = [
    ...preferred,
    ...fallbackCooling.slice(
      0,
      Math.max(0, limit - preferred.length),
    ),
  ].slice(0, limit);

  return {
    userIds: selectedCandidates.map((candidate) => candidate.userId),
    freshCount: Math.min(preferred.length, limit),
    excludedCandidateCount,
    recentlyCheckedSkipped: Math.max(
      0,
      coolingDown.length -
        Math.max(0, limit - preferred.length),
    ),
  };
}

function markCandidatesChecked(userIds, now = Date.now()) {
  for (const rawUserId of userIds) {
    const userId = Number(rawUserId);
    const candidate = candidatePool.get(userId);
    if (candidate) candidate.lastCheckedAt = now;
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

function getMinimumTargetValue() {
  return getPositiveIntegerEnv(
    "ROBLOX_TARGET_MIN_VALUE",
    DEFAULT_TARGET_VALUE,
  );
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
