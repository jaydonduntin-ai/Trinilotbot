import {
  getAvatarThumbnail,
  getAssetOwners,
  getFriendGroupRoles,
  getGameDetails,
  getPublicGameInstanceMatches,
  getRobloxGroupDetails,
  getRobloxGroupRelationships,
  getRobloxGroupUsers,
  getRobloxGroupWallPosters,
  getRobloxUserById,
  getRobloxUsersByIds,
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
import {
  getFollowUserJoinUrl,
  getGameInstanceJoinUrl,
  getVerifiedPlayerJoinUrl,
} from "../roblox/game-session.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import {
  enrichInventoryWithRolimons,
  getRolimonsItems,
} from "../sources/rolimons-items.js";
import { getRecentTradeAdPlayers } from "../sources/rolimons-trade-ads.js";
import { getJailbreakTradeCandidates } from "../sources/jailbreak-trading-network.js";
import { getPs99PublicCandidateUserIds } from "../sources/ps99-public-players.js";
import { getRolimonsLeaderboardPlayers } from "../sources/rolimons-leaderboard.js";
import { searchRolimonsPlayers } from "../sources/rolimons-player-search.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";
import { getRblxValueProfile } from "../providers/rblxvalue.js";
import { getScanWatchlist } from "../storage/scan-watchlist.js";
import {
  loadCandidateDatabase,
  saveCandidateDatabase,
} from "../storage/candidate-database.js";
import { addMm2ValuePlayers } from "../storage/mm2-value-watchlist.js";
import {
  addScanAttemptIds,
  addScanReservedIds,
  addSurfacedTargetIds,
  getTargetHistory,
  initializeTargetHistory,
} from "../storage/target-history.js";

export const DEFAULT_TARGET_RAP = 150_000;
export const DEFAULT_TARGET_VALUE = 150_000;
export const DEFAULT_MM2_VALUE = 50_000;
export const DEFAULT_MM2_RAP = 150_000;
export const DEFAULT_TARGET_COUNT = 10;
export const MAX_TARGETS = 50;
export const MIN_TARGET_THRESHOLD = 150_000;
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
  "blade-ball": {
    label: "Blade Ball",
    universeId: 4777817887,
    matches: ["blade ball"],
  },
  ps99: {
    label: "Pet Simulator 99",
    universeId: 3317771874,
    matches: ["pet simulator 99", "pet sim 99", "ps99"],
  },
};

const PRIORITY_GAME_KEYS = [
  "mm2",
  "adopt-me",
  "blade-ball",
  "ps99",
];

const DEFAULT_MAX_CANDIDATES = 500;
const DEFAULT_TARGET_MAX_PRESENCE_CANDIDATES = 500;
const DEFAULT_TARGET_SCAN_WAVE_SIZE = 250;
const DEFAULT_TARGET_SCAN_TIME_BUDGET_MS = 45_000;
const DEFAULT_TRUSTED_RAP_TTL_MS = 15 * 60 * 1000;
const FINAL_RECHECK_BATCH_SIZE = 10;
const PUBLIC_SERVER_VERIFY_CONCURRENCY = 2;
const DEFAULT_PUBLIC_SERVER_VERIFY_MAX_PAGES = 10;
const DEFAULT_GAME_SCAN_CANDIDATES = 500;
const DEFAULT_GAME_SCAN_TIME_BUDGET_MS = 25_000;
const DEFAULT_GAME_SCAN_WAVE_SIZE = 250;
const DEFAULT_MAX_ACTIVE_TO_VERIFY = 160;
const DEFAULT_POOL_MAX_SIZE = 25_000;
const DEFAULT_POOL_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_RECENT_CHECK_COOLDOWN_MS = 15 * 60 * 1000;
const TARGET_POOL_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const LIMITED_OWNER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const GROUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MARKETPLACE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;
const DEFAULT_SEED_ITEM_COUNT = 4;
const DEFAULT_OWNERS_PER_ITEM = 10;
const DEFAULT_SEED_MIN_ITEM_RAP = 75_000;

const MANUAL_LIMITED_OWNER_SEEDS = [
  { id: 1365767, name: "Valkyrie Helm" },
  { id: 439945661, name: "SKOTN" },
  { id: 1744060292, name: "Poisoned Horns" },
  { id: 553970961, name: "Green Queen of the Night" },
];
const OWNER_CONCURRENCY = 1;
const OWNER_DISCOVERY_BUDGET_MS = 18_000;
const DEFAULT_LIMITED_OWNER_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_LIMITED_OWNER_INTER_ITEM_DELAY_MS = 2_500;
const DEFAULT_MARKETPLACE_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_GROUP_DISCOVERY_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_USER_SEARCH_BACKOFF_MS = 10 * 60 * 1000;
const SEARCH_TERMS_PER_REFRESH = 12;
const SOCIAL_SEEDS_PER_REFRESH = 10;
const SEARCH_CONCURRENCY = 4;
const SOCIAL_CONCURRENCY = 4;
const FOLLOW_SEEDS_PER_REFRESH = 6;
const ROLIMONS_SEARCH_TERMS_PER_REFRESH = 6;
const ROLIMONS_LEADERBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const JAILBREAK_TRADE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PS99_PUBLIC_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const SEARCH_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_ROLIMONS_LEADERBOARD_PAGES_PER_REFRESH = 20;
const DEFAULT_TARGET_LIVE_CACHE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TARGET_LIVE_CACHE_TTL_MS = 8 * 60 * 1000;
const DEFAULT_TARGET_LIVE_CACHE_SCAN_LIMIT = 100;
const DEFAULT_TARGET_LIVE_CACHE_BATCH_DELAY_MS = 2_500;
const DEFAULT_TARGET_LIVE_CACHE_BACKOFF_MS = 10 * 60 * 1000;
const DEFAULT_PRESENCE_API_BACKOFF_MS = 3 * 60 * 1000;
const DEFAULT_FALLBACK_PRESENCE_BACKOFF_MS = 5 * 60 * 1000;
const DEFAULT_PRESENCE_TIMEOUT_BACKOFF_MS = 90_000;
const DEFAULT_FALLBACK_TIMEOUT_BACKOFF_MS = 2 * 60 * 1000;
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
const MARKETPLACE_OWNER_SEEDS = 3;
const MARKETPLACE_GROUP_SEEDS = 6;
const MARKETPLACE_OWNER_LIMIT = 20;
const PRESENCE_BATCH_SIZE = 50;
const VERIFY_CONCURRENCY = 5;
const MM2_PROFILE_CHECK_LIMIT = 8;
const MM2_PROFILE_CONCURRENCY = 4;
const MM2_SCAN_WAVE_SIZE = 300;
const MM2_SCAN_TIME_BUDGET_MS = 30_000;
const MM2_ACTIVITY_SWEEP_TIME_BUDGET_MS = 28_000;
const MM2_ACTIVITY_SWEEP_CHUNK_SIZE = 250;
const MM2_ACTIVITY_THROTTLE_PAUSE_MS = 3_000;
const MM2_VALUE_DISCOVERY_BATCH_SIZE = 15;
const MM2_VALUE_INDEX_TTL_MS = 30 * 60 * 1000;

const SEARCH_TERMS = [
  "mm2","murdermystery2","adoptme","bladeball","petsim99","ps99",
  "limited","trade","trader","collector","rich","rap",
  "pro","king","queen","dark","shadow","cool","game","player","star","wolf",
  "dragon","ninja","blue","red","green","gold","fire","ice","the","boy",
  "girl","roblox","master","elite","legend","nova","sky","moon","sun","cat",
  "dog","max","ace","zero","neo","rex","leo","trade","trader","limited",
  "collector","gaming","ytb","ttv","xxl","dev","builder","rich","rare",
  "avatar","pixel","epic","super","mega","ultra","night","light","storm"
];

const GROUP_SEARCH_TERMS = [
  "mm2","murder mystery","adopt me","blade ball","pet simulator 99","ps99",
  "roblox","gaming","community","trading","players","fans","clan","group",
  "adopt","limited","trade","roleplay","pvp","builders","collectors",
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
let candidateDatabaseHydrated = false;
let candidateDatabaseHydratePromise = null;
let candidateDatabaseWritePromise = Promise.resolve();
let targetPoolWarmupTimer = null;
let targetLiveCacheTimer = null;
let liveTargetCursor = 0;
let lastLiveCacheRefreshAt = 0;
let liveCacheBackoffUntil = 0;
let presenceApiBackoffUntil = 0;
let fallbackPresenceBackoffUntil = 0;
let limitedOwnerBackoffUntil = 0;
let marketplaceBackoffUntil = 0;
let groupBackoffUntil = 0;
let userSearchBackoffUntil = 0;
let searchTermCursor = 0;
let groupSearchTermCursor = 0;
let leaderboardPageCursor = 1;
let lastLimitedOwnerRefreshAt = Date.now();
let lastGroupRefreshAt = 0;
let lastLeaderboardRefreshAt = 0;
let lastMarketplaceRefreshAt = 0;
let lastJailbreakTradeRefreshAt = 0;
let lastPs99PublicRefreshAt = 0;
let lastSearchRefreshAt = 0;
let limitedSeedCursor = 0;
const limitedOwnerUnavailableAssetIds = new Set();
let jailbreakDisabledLogged = false;
let candidateRefreshPromise = null;
let lastCandidatePoolRefreshAt = 0;
let mm2PresenceCursor = 0;
let mm2ValueDiscoveryCursor = 0;
let activeInteractivePresenceScans = 0;
const presenceInteractiveQueue = [];
const presenceBackgroundQueue = [];
let presenceSchedulerRunning = false;

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

async function ensureCandidateDatabaseHydrated() {
  if (candidateDatabaseHydrated) return;

  if (!candidateDatabaseHydratePromise) {
    candidateDatabaseHydratePromise = (async () => {
      const database = await loadCandidateDatabase();

      for (const raw of database.candidates ?? []) {
        const userId = Number(raw?.userId);
        if (!Number.isInteger(userId) || userId <= 0) continue;

        candidatePool.set(userId, {
          userId,
          firstSeenAt: Number(raw?.firstSeenAt) || Date.now(),
          lastSeenAt: Number(raw?.lastSeenAt) || Date.now(),
          lastCheckedAt: Number(raw?.lastCheckedAt) || 0,
          lastSocialExpandedAt: Number(raw?.lastSocialExpandedAt) || 0,
          lastFollowExpandedAt: Number(raw?.lastFollowExpandedAt) || 0,
          lastGroupExpandedAt: Number(raw?.lastGroupExpandedAt) || 0,
          lastFriendGroupExpandedAt:
            Number(raw?.lastFriendGroupExpandedAt) || 0,
          lastPrimaryGroupExpandedAt:
            Number(raw?.lastPrimaryGroupExpandedAt) || 0,
          lastKnownRap: Number.isFinite(Number(raw?.lastKnownRap))
            ? Number(raw.lastKnownRap)
            : null,
          lastKnownRapAt: Number(raw?.lastKnownRapAt) || 0,
          lastKnownRapSource: raw?.lastKnownRapSource ?? null,
          lastKnownValue: Number.isFinite(Number(raw?.lastKnownValue))
            ? Number(raw.lastKnownValue)
            : null,
          lastKnownValueAt: Number(raw?.lastKnownValueAt) || 0,
          lastKnownValueSource: raw?.lastKnownValueSource ?? null,
          sources: new Set(
            Array.isArray(raw?.sources)
              ? raw.sources.filter(Boolean).map(String)
              : [],
          ),
        });
      }

      pruneCandidatePool();
      candidateDatabaseHydrated = true;
      console.info(
        `Candidate database restored: ${candidatePool.size} active candidates from ${database.candidates?.length ?? 0} stored.`,
      );
    })().finally(() => {
      candidateDatabaseHydratePromise = null;
    });
  }

  await candidateDatabaseHydratePromise;
}

function serializeCandidate(candidate) {
  return {
    userId: Number(candidate.userId),
    firstSeenAt: Number(candidate.firstSeenAt) || 0,
    lastSeenAt: Number(candidate.lastSeenAt) || 0,
    lastCheckedAt: Number(candidate.lastCheckedAt) || 0,
    lastSocialExpandedAt: Number(candidate.lastSocialExpandedAt) || 0,
    lastFollowExpandedAt: Number(candidate.lastFollowExpandedAt) || 0,
    lastGroupExpandedAt: Number(candidate.lastGroupExpandedAt) || 0,
    lastFriendGroupExpandedAt:
      Number(candidate.lastFriendGroupExpandedAt) || 0,
    lastPrimaryGroupExpandedAt:
      Number(candidate.lastPrimaryGroupExpandedAt) || 0,
    lastKnownRap: Number.isFinite(Number(candidate.lastKnownRap))
      ? Number(candidate.lastKnownRap)
      : null,
    lastKnownRapAt: Number(candidate.lastKnownRapAt) || 0,
    lastKnownRapSource: candidate.lastKnownRapSource ?? null,
    lastKnownValue: Number.isFinite(Number(candidate.lastKnownValue))
      ? Number(candidate.lastKnownValue)
      : null,
    lastKnownValueAt: Number(candidate.lastKnownValueAt) || 0,
    lastKnownValueSource: candidate.lastKnownValueSource ?? null,
    sources: [...(candidate.sources ?? [])],
  };
}

async function persistCandidateDatabaseSnapshot() {
  pruneCandidatePool();
  const snapshot = [...candidatePool.values()]
    .sort((left, right) => {
      const priorityDelta =
        getCandidatePriority(
          right,
          {
            minimumValue: getMinimumTargetValue(),
            minimumRap: getMinimumTargetRap(),
          },
        ) -
        getCandidatePriority(
          left,
          {
            minimumValue: getMinimumTargetValue(),
            minimumRap: getMinimumTargetRap(),
          },
        );
      if (priorityDelta !== 0) return priorityDelta;
      return Number(right.lastSeenAt || 0) - Number(left.lastSeenAt || 0);
    })
    .map(serializeCandidate);

  candidateDatabaseWritePromise = candidateDatabaseWritePromise
    .catch(() => undefined)
    .then(() => saveCandidateDatabase(snapshot));

  return candidateDatabaseWritePromise;
}

async function refreshCandidatePoolLightweight() {
  await ensureCandidateDatabaseHydrated();
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

  const ps99PublicUserIds = await refreshPs99PublicCandidates(now);

  pruneCandidatePool();
  await persistCandidateDatabaseSnapshot();
  lastCandidatePoolRefreshAt = now;

  return {
    ...getPoolSourceCounts(),
    watchlist: watchlistUserIds.length,
    tradeAds: tradeAdUserIds.length,
    leaderboard: leaderboardUserIds.length,
    ps99Public: ps99PublicUserIds.length,
  };
}

export function startTargetCandidatePoolWarmup() {
  if (targetPoolWarmupTimer || targetLiveCacheTimer) return;

  const refreshCandidates = async () => {
    try {
      const stats = await refreshCandidatePool();
      const populations = stats.sourceCounts ?? {};
      const yieldStats = stats.refreshYield ?? {};
      console.info(
        `Target source populations: ${candidatePool.size}/${getPositiveIntegerEnv("ROBLOX_TARGET_POOL_MAX_SIZE", DEFAULT_POOL_MAX_SIZE)} pooled · ${populations.watchlist ?? 0} watchlist · ${populations.leaderboard ?? 0} leaderboard · ${populations.ps99Public ?? 0} PS99 · ${populations.tradeAds ?? 0} trade-ads · ${populations.limitedOwners ?? 0} limited-owners · ${populations.marketplaceOwners ?? 0} marketplace-owners · ${populations.marketplaceCreators ?? 0} marketplace-creators · ${populations.marketplaceGroupMembers ?? 0} marketplace-group-members · ${populations.userSearch ?? 0} Roblox-search · ${populations.rolimonsSearch ?? 0} Rolimon-search · ${populations.groupSearchMembers ?? 0} group-search · ${populations.groupGraphMembers ?? 0} group-graph.`,
      );
      console.info(
        `Target refresh yield: ${yieldStats.tradeAds ?? 0} trade-ads · ${yieldStats.limitedOwners ?? 0} limited-owners · ${yieldStats.marketplaceOwners ?? 0} marketplace-owners · ${yieldStats.marketplaceCreators ?? 0} marketplace-creators · ${yieldStats.marketplaceGroupMembers ?? 0} marketplace-group-members · ${yieldStats.userSearch ?? 0} Roblox-search · ${yieldStats.rolimonsSearch ?? 0} Rolimon-search · ${yieldStats.groupSearchMembers ?? 0} group-search · ${yieldStats.groupGraphMembers ?? 0} group-graph · ${yieldStats.jailbreakTrades ?? 0} jailbreak.`,
      );
    } catch (error) {
      console.warn("Background target candidate refresh failed:", error);
    }
  };

  const warmCandidates = async () => {
    try {
      const stats = await refreshCandidatePoolLightweight();
      console.info(
        `Target index warmup: ${candidatePool.size} pooled · ${stats.leaderboard ?? 0} leaderboard · ${stats.ps99Public ?? 0} PS99-public · ${stats.watchlist ?? 0} scan-watchlist.`,
      );
    } catch (error) {
      console.warn("Lightweight target warmup failed:", error);
    }
  };

  const refreshLive = async () => {
    try {
      const stats = await refreshTargetLiveCache();
      console.info(
        `Target live cache: ${stats.liveCount} in-game · ${stats.checkedCount} checked · ${stats.verifiedIndexCount} verified ${getMinimumTargetRap().toLocaleString()}+ RAP indexed.`,
      );
    } catch (error) {
      console.warn("Background target live-cache refresh failed:", error);
    }
  };

  // Restore durable dedupe history before warming the verified index.
  // Give candidate discovery time to settle, then seed the live cache before
  // the slower recurring background loop begins.
  void Promise.all([
    ensureTargetHistoryHydrated(),
    ensureCandidateDatabaseHydrated(),
  ])
    .then(warmCandidates)
    .then(() => {
      const initialLiveTimer = setTimeout(refreshLive, 30_000);
      initialLiveTimer.unref?.();
    });

  const initialFullRefreshTimer = setTimeout(
    refreshCandidates,
    45_000,
  );
  initialFullRefreshTimer.unref?.();

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
  if (activeInteractivePresenceScans > 0) {
    return {
      verifiedIndexCount: getTargetLiveCacheStats().verifiedIndexCount,
      checkedCount: 0,
      liveCount: liveTargetCache.size,
      backingOff: false,
      skippedForInteractive: true,
    };
  }
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
    priority: "background",
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
      const gamePriorityDelta =
        Number(Boolean(getPriorityGameKey(right?.[1]?.presence))) -
        Number(Boolean(getPriorityGameKey(left?.[1]?.presence)));
      if (gamePriorityDelta !== 0) return gamePriorityDelta;

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

export async function scanDiscoveredTargets(options = {}) {
  activeInteractivePresenceScans += 1;
  try {
    return await scanDiscoveredTargetsInternal(options);
  } finally {
    activeInteractivePresenceScans = Math.max(
      0,
      activeInteractivePresenceScans - 1,
    );
  }
}

async function scanDiscoveredTargetsInternal({
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
    const finalCached = await revalidateCurrentlyInGame(
      cachedVerified,
    );

    if (finalCached.players.length >= requestedLimit) {
      const selectedPlayers = sortTargetPlayersForPriority(
        finalCached.players,
      )
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
        verifiedCount: finalCached.players.length,
        finalPresenceLeftGameCount: finalCached.leftGameCount,
        finalPresenceUnavailableCount: finalCached.unavailableCount,
        nonPublicServerCount: finalCached.nonPublicServerCount ?? 0,
        publicServerVerificationErrorCount:
          finalCached.publicServerVerificationErrorCount ?? 0,
        presenceRateLimited: finalCached.rateLimited === true,
        usedCachedPresenceFallback:
          false === true,
        verificationAttempts: cachedResults.length,
        valueUnavailableCount: 0,
        belowValueCount: 0,
        rapUnavailableCount: 0,
        belowRapCount: 0,
        profileUnavailableCount: 0,
        verificationErrorCount: 0,
        preRecheckVerifiedCount: cachedVerified.length,
        joinReadyCount: finalCached.players.filter((player) => player.joinReady).length,
        publicServerConfirmedCount: finalCached.players.filter((player) => player.publicServerConfirmed).length,
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

  const configuredPresenceCandidates = getPositiveIntegerEnv(
    "ROBLOX_TARGET_MAX_PRESENCE_CANDIDATES",
    DEFAULT_TARGET_MAX_PRESENCE_CANDIDATES,
  );
  // Large target requests need a wider live-presence window. Scale only the
  // interactive request, while leaving the background live cache at its
  // conservative 150-user cycle.
  const maxPresenceCandidates = Math.min(
    1_000,
    Math.max(configuredPresenceCandidates, requestedLimit * 20),
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
      presenceFallbackUsed: false,
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
  let presenceFallbackUsed = false;
  let profileUnavailableCount = 0;
  let verificationErrorCount = 0;
  const maxActiveToVerify = getPositiveIntegerEnv(
    "ROBLOX_TARGET_MAX_ACTIVE_TO_VERIFY",
    DEFAULT_MAX_ACTIVE_TO_VERIFY,
  );
  const verificationBuffer = Math.min(MAX_TARGETS + 5, requestedLimit + 5);

  for (
    let offset = 0;
    offset < discovery.userIds.length;
    offset += waveSize
  ) {
    if (Date.now() - startedAt >= timeBudgetMs) break;
    if (verifiedPlayers.length >= verificationBuffer) break;
    if (verificationAttempts >= maxActiveToVerify) break;

    const wave = discovery.userIds.slice(offset, offset + waveSize);
    const route = getInteractivePresenceRoute();

    if (!route) {
      presenceRateLimited = true;
      break;
    }

    const presenceScan = await getPresenceBatched(wave, {
      maxAttempts: 1,
      interBatchDelayMs: 1_000,
      stopOnRateLimit: true,
      presenceFetcher: route.presenceFetcher,
      fallbackFetcher: route.fallbackFetcher,
      fallbackOnRateLimit: route.fallbackOnRateLimit,
    });
    markCandidatesChecked(presenceScan.checkedIds);
    presenceScannedCount += presenceScan.checkedIds.length;
    if (presenceScan.rateLimited) presenceRateLimited = true;
    presenceFallbackUsed =
      presenceFallbackUsed ||
      (route.usingFallback && presenceScan.checkedIds.length > 0) ||
      presenceScan.usedFallback === true;

    const inGamePresences = presenceScan.presences
      .filter(
        (presence) => Number(presence?.userPresenceType) === 2,
      )
      .sort((left, right) =>
        compareTargetPresences(
          left,
          right,
          { minimumValue, minimumRap },
        ),
      );

    for (const presence of inGamePresences) {
      const userId = Number(presence.userId);
      activeSeen.set(userId, presence);
      liveTargetCache.set(userId, {
        presence,
        checkedAt: Date.now(),
      });
    }

    if (
      presenceScan.rateLimited &&
      !presenceScan.usedFallback &&
      !route.usingFallback &&
      inGamePresences.length === 0
    ) {
      continue;
    }

    if (
      presenceScan.rateLimited &&
      presenceScan.checkedIds.length === 0 &&
      inGamePresences.length === 0
    ) {
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
  const selectedPlayers = sortTargetPlayersForPriority(
    stillInGamePlayers.players,
  )
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
    nonPublicServerCount: stillInGamePlayers.nonPublicServerCount ?? 0,
    publicServerVerificationErrorCount:
      stillInGamePlayers.publicServerVerificationErrorCount ?? 0,
    presenceRateLimited,
    presenceFallbackUsed:
      presenceFallbackUsed ||
      stillInGamePlayers.usedFallback === true,
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

export async function scanDeveloperTargets({
  minimumRap = DEFAULT_TARGET_RAP,
  minimumValue = DEFAULT_TARGET_VALUE,
  limit = MAX_TARGETS,
} = {}) {
  activeInteractivePresenceScans += 1;
  try {
    return await scanDeveloperTargetsInternal({
      minimumRap,
      minimumValue,
      limit,
    });
  } finally {
    activeInteractivePresenceScans = Math.max(
      0,
      activeInteractivePresenceScans - 1,
    );
  }
}

async function scanDeveloperTargetsInternal({
  minimumRap,
  minimumValue,
  limit,
}) {
  await ensureTargetHistoryHydrated();

  const requestedLimit = Math.max(
    1,
    Math.min(MAX_TARGETS, Number(limit) || DEFAULT_TARGET_COUNT),
  );
  const discoveryLimit = Math.max(
    250,
    Math.min(
      getPositiveIntegerEnv(
        "ROBLOX_TARGET_POOL_MAX_SIZE",
        DEFAULT_POOL_MAX_SIZE,
      ),
      getPositiveIntegerEnv("ROBLOX_DEV_DISCOVERY_CANDIDATES", 1_500),
    ),
  );

  const discovery = await discoverCandidateUserIds({
    minimumValue: null,
    minimumRap: null,
    respectCooldown: false,
    maxCandidatesOverride: discoveryLimit,
  });

  const initialRoute = getInteractivePresenceRoute();
  if (!initialRoute || discovery.userIds.length === 0) {
    return {
      minimumRap,
      minimumValue,
      players: [],
      observedGames: 0,
      developerCandidates: 0,
      presenceChecked: 0,
      presenceRateLimited: !initialRoute,
      presenceFallbackUsed: false,
      sources: [
        "Roblox public presence",
        "Roblox public experience creator metadata",
        "Roblox public group ownership",
      ],
    };
  }

  const observedPresence = await getPresenceBatched(discovery.userIds, {
    batchSize: PRESENCE_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 1_000,
    stopOnRateLimit: true,
    presenceFetcher: initialRoute.presenceFetcher,
    fallbackFetcher: initialRoute.fallbackFetcher,
    fallbackOnRateLimit: initialRoute.fallbackOnRateLimit,
  });

  const universeIds = [
    ...new Set(
      observedPresence.presences
        .filter(
          (presence) =>
            Number(presence?.userPresenceType) === 2 &&
            Number.isInteger(Number(presence?.universeId)) &&
            Number(presence.universeId) > 0,
        )
        .map((presence) => Number(presence.universeId)),
    ),
  ].slice(0, 120);

  const games = await mapWithConcurrency(
    universeIds,
    4,
    async (universeId) => {
      try {
        return await getGameDetails(universeId);
      } catch (error) {
        console.warn(
          `Developer discovery could not load universe ${universeId}:`,
          error,
        );
        return null;
      }
    },
  );

  const directCreatorIds = new Set();
  const groupGames = new Map();
  const evidenceByUser = new Map();

  const addEvidence = (userId, evidence) => {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return;
    const list = evidenceByUser.get(id) ?? [];
    if (
      !list.some(
        (entry) =>
          Number(entry.universeId) === Number(evidence.universeId) &&
          entry.kind === evidence.kind,
      )
    ) {
      list.push(evidence);
      evidenceByUser.set(id, list.slice(0, 4));
    }
  };

  for (const game of games.filter(Boolean)) {
    const universeId = Number(game?.id ?? game?.universeId);
    const creator = game?.creator ?? {};
    const creatorId = Number(
      creator?.id ??
      creator?.creatorTargetId ??
      game?.creatorTargetId,
    );
    const creatorType = String(
      creator?.type ??
      creator?.creatorType ??
      game?.creatorType ??
      "",
    ).toLowerCase();

    if (!Number.isInteger(creatorId) || creatorId <= 0) continue;

    const evidence = {
      universeId,
      gameName: game?.name ?? `Universe ${universeId}`,
      creatorName: creator?.name ?? null,
    };

    if (creatorType === "user") {
      directCreatorIds.add(creatorId);
      addEvidence(creatorId, {
        ...evidence,
        kind: "experience-creator",
      });
    } else if (creatorType === "group") {
      const entries = groupGames.get(creatorId) ?? [];
      entries.push(evidence);
      groupGames.set(creatorId, entries);
    }
  }

  const groupIds = [...groupGames.keys()];
  const groupDetails = await mapWithConcurrency(
    groupIds,
    3,
    async (groupId) => {
      try {
        return {
          groupId,
          details: await getRobloxGroupDetails(groupId),
        };
      } catch (error) {
        console.warn(
          `Developer discovery could not load creator group ${groupId}:`,
          error,
        );
        return { groupId, details: null };
      }
    },
  );

  const groupOwnerIds = new Set();
  for (const { groupId, details } of groupDetails) {
    const ownerId = Number(
      details?.owner?.userId ??
      details?.owner?.id ??
      details?.ownerUserId,
    );
    if (!Number.isInteger(ownerId) || ownerId <= 0) continue;
    groupOwnerIds.add(ownerId);
    for (const evidence of groupGames.get(groupId) ?? []) {
      addEvidence(ownerId, {
        ...evidence,
        kind: "creator-group-owner",
        groupId,
        groupName: details?.name ?? evidence.creatorName ?? null,
      });
    }
  }

  const directIds = [...directCreatorIds];
  const ownerIds = [...groupOwnerIds];
  addCandidatesToPool(
    directIds,
    "Roblox public experience creators",
    Date.now(),
  );
  addCandidatesToPool(
    ownerIds,
    "Roblox public experience creator-group owners",
    Date.now(),
  );

  const developerIds = [...new Set([...directIds, ...ownerIds])];
  if (developerIds.length === 0) {
    return {
      minimumRap,
      minimumValue,
      players: [],
      observedGames: universeIds.length,
      developerCandidates: 0,
      presenceChecked: observedPresence.checkedIds.length,
      presenceRateLimited: observedPresence.rateLimited === true,
      presenceFallbackUsed:
        initialRoute.usingFallback || observedPresence.usedFallback === true,
      sources: [
        "Roblox public presence",
        "Roblox public experience creator metadata",
        "Roblox public group ownership",
      ],
    };
  }

  const creatorRoute = getInteractivePresenceRoute();
  if (!creatorRoute) {
    return {
      minimumRap,
      minimumValue,
      players: [],
      observedGames: universeIds.length,
      developerCandidates: developerIds.length,
      presenceChecked: observedPresence.checkedIds.length,
      presenceRateLimited: true,
      presenceFallbackUsed:
        initialRoute.usingFallback || observedPresence.usedFallback === true,
      sources: [
        "Roblox public presence",
        "Roblox public experience creator metadata",
        "Roblox public group ownership",
      ],
    };
  }

  const creatorPresence = await getPresenceBatched(developerIds, {
    batchSize: PRESENCE_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 1_000,
    stopOnRateLimit: true,
    presenceFetcher: creatorRoute.presenceFetcher,
    fallbackFetcher: creatorRoute.fallbackFetcher,
    fallbackOnRateLimit: creatorRoute.fallbackOnRateLimit,
  });

  const inGameCreators = creatorPresence.presences
    .filter((presence) => Number(presence?.userPresenceType) === 2)
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
    )
    .slice(0, Math.max(200, requestedLimit * 4));

  const verificationGoal = Math.min(
    inGameCreators.length,
    Math.max(requestedLimit * 3, requestedLimit + 20),
  );
  const verified = [];
  for (
    let index = 0;
    index < inGameCreators.length && verified.length < verificationGoal;
    index += VERIFY_CONCURRENCY
  ) {
    const batch = inGameCreators.slice(index, index + VERIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map((presence) =>
        buildDiscoveredTargetPlayer(
          presence,
          {
            minimumValue,
            minimumRap,
            includeGameValue: false,
          },
        ).catch((error) => {
          console.warn(
            `Developer target verification failed for Roblox user ${presence.userId}:`,
            error,
          );
          return null;
        }),
      ),
    );

    for (const player of results) {
      if (!player?.qualifies) continue;
      verified.push({
        ...player,
        developerEvidence:
          evidenceByUser.get(Number(player.id)) ?? [],
      });
      if (verified.length >= verificationGoal) break;
    }
  }

  const finalJoinability = await revalidateCurrentlyInGame(verified);
  const publicPlayers = finalJoinability.players.slice(0, requestedLimit);

  return {
    minimumRap,
    minimumValue,
    players: publicPlayers,
    observedGames: universeIds.length,
    developerCandidates: developerIds.length,
    presenceChecked:
      observedPresence.checkedIds.length +
      creatorPresence.checkedIds.length,
    inGameDeveloperCandidates: inGameCreators.length,
    nonPublicServerCount: finalJoinability.nonPublicServerCount ?? 0,
    finalPresenceLeftGameCount: finalJoinability.leftGameCount ?? 0,
    finalPresenceUnavailableCount: finalJoinability.unavailableCount ?? 0,
    presenceRateLimited:
      observedPresence.rateLimited === true ||
      creatorPresence.rateLimited === true ||
      finalJoinability.rateLimited === true,
    presenceFallbackUsed:
      initialRoute.usingFallback ||
      creatorRoute.usingFallback ||
      observedPresence.usedFallback === true ||
      creatorPresence.usedFallback === true ||
      finalJoinability.usedFallback === true,
    sources: [
      "Roblox public presence",
      "Roblox public experience creator metadata",
      "Roblox public group ownership",
      "Roblox public collectibles inventory",
      "Rolimon's public player info (RAP/value cross-check only)",
    ],
  };
}

export async function scanCandidatesForWatchlist({
  minimumRap = DEFAULT_TARGET_RAP,
  minimumValue = DEFAULT_TARGET_VALUE,
  limit = null,
  deepScan = true,
} = {}) {
  await ensureTargetHistoryHydrated();

  const requestedLimit =
    limit === null || limit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.min(5_000, Number(limit) || 1));
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
    maxCandidatesOverride: deepScan
      ? getPositiveIntegerEnv(
          "ROBLOX_SCAN_MAX_CANDIDATES_PER_PASS",
          getPositiveIntegerEnv(
            "ROBLOX_TARGET_POOL_MAX_SIZE",
            DEFAULT_POOL_MAX_SIZE,
          ),
        )
      : getPositiveIntegerEnv(
          "ROBLOX_TARGET_MAX_PRESENCE_CANDIDATES",
          DEFAULT_TARGET_MAX_PRESENCE_CANDIDATES,
        ),
  });

  const startedAt = Date.now();
  const timeBudgetMs = Math.max(
    10_000,
    getPositiveIntegerEnv(
      deepScan
        ? "ROBLOX_SCAN_TIME_BUDGET_MS"
        : "ROBLOX_TARGET_SCAN_TIME_BUDGET_MS",
      deepScan ? 120_000 : DEFAULT_TARGET_SCAN_TIME_BUDGET_MS,
    ),
  );
  const verified = [];
  const newAttemptIds = [];
  let checkedCount = 0;
  let stopReason = "candidate-selection-exhausted";

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
    if (Date.now() - startedAt >= timeBudgetMs) {
      stopReason = "time-budget";
      break;
    }
    if (
      Number.isFinite(requestedLimit) &&
      verified.length >= requestedLimit
    ) {
      stopReason = "qualified-cap";
      break;
    }

    const batch = candidates.slice(index, index + VERIFY_CONCURRENCY);
    checkedCount += batch.length;

    const results = await Promise.all(
      batch.map(async (userId) => {
        try {
          const player = await buildDiscoveredTargetPlayer(
            {
              userId,
              userPresenceType: 0,
              lastLocation: null,
              universeId: null,
            },
            { minimumValue, minimumRap },
          );
          return { userId: Number(userId), player };
        } catch (error) {
          console.warn(
            `Scan watchlist verification failed for Roblox user ${userId}:`,
            error,
          );
          return {
            userId: Number(userId),
            player: {
              qualifies: false,
              reason: "verification-error",
            },
          };
        }
      }),
    );

    for (const { userId, player } of results) {
      const definitive =
        player?.qualifies === true ||
        player?.reason === "below-rap" ||
        player?.reason === "below-value";

      if (definitive) {
        attemptedIds.add(userId);
        newAttemptIds.push(userId);
      }

      if (player?.qualifies) {
        verified.push(player);
        if (
          Number.isFinite(requestedLimit) &&
          verified.length >= requestedLimit
        ) {
          stopReason = "qualified-cap";
          break;
        }
      }
    }
  }

  if (newAttemptIds.length > 0) {
    await addScanAttemptIds(
      getScanAttemptKey(minimumRap, minimumValue),
      newAttemptIds,
    );
  }

  const selectedPlayers = (
    Number.isFinite(requestedLimit)
      ? verified.slice(0, requestedLimit)
      : verified
  ).map(({ qualifies, ...player }) => player);

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

  await persistCandidateDatabaseSnapshot();

  return {
    players: selectedPlayers,
    minimumRap,
    minimumValue,
    checkedCount,
    candidateCount: candidates.length,
    stopReason,
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

  const userIds = players
    .map((player) => Number(player?.id))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  const route = getInteractivePresenceRoute();
  if (!route) return [];

  const liveCheck = await getPresenceBatched(userIds, {
    maxAttempts: 1,
    interBatchDelayMs: 500,
    stopOnRateLimit: true,
    presenceFetcher: route.presenceFetcher,
    fallbackFetcher: route.fallbackFetcher,
    fallbackOnRateLimit: route.fallbackOnRateLimit,
  });

  const activeByUserId = new Map(
    liveCheck.presences
      .filter((presence) => isPresenceForGame(presence, game))
      .map((presence) => [Number(presence.userId), presence]),
  );

  const refreshed = players
    .filter((player) => activeByUserId.has(Number(player.id)))
    .map((player) => {
      const presence = activeByUserId.get(Number(player.id));
      return {
        ...player,
        presenceStatus: "In game",
        gameName: presence?.lastLocation || player.gameName,
        ...buildTargetJoinability(presence, player.id),
        presenceFreshness: "fresh",
      };
    });

  const publicJoinability = await filterPublicJoinablePlayers(refreshed);
  return publicJoinability.players;
}

export async function scanMm2RapActivity({
  minimumRap = DEFAULT_MM2_RAP,
  limit = MAX_TARGETS,
} = {}) {
  return scanGameTargets({
    gameKey: "mm2",
    minimumValue: null,
    minimumRap,
    limit,
    includeGameValue: false,
    maxCandidatesOverride: getPositiveIntegerEnv(
      "ROBLOX_MM2_SCAN_MAX_CANDIDATES",
      getPositiveIntegerEnv(
        "ROBLOX_TARGET_POOL_MAX_SIZE",
        DEFAULT_POOL_MAX_SIZE,
      ),
    ),
    timeBudgetMs: getPositiveIntegerEnv(
      "ROBLOX_MM2_SCAN_TIME_BUDGET_MS",
      120_000,
    ),
  });
}

export async function scanMm2JoinActivity({
  minimumMm2Value = DEFAULT_MM2_VALUE,
  minimumRap = null,
  limit = DEFAULT_TARGET_COUNT,
} = {}) {
  const game = GAME_TARGETS.mm2;
  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );
  const parsedMm2Value = Number(minimumMm2Value);
  const mm2ValueFloor = Number.isFinite(parsedMm2Value)
    ? Math.max(0, parsedMm2Value)
    : DEFAULT_MM2_VALUE;

  activeInteractivePresenceScans += 1;
  try {
    await syncWatchlistCandidates();

    // Cache-first: if we recently observed MM2 activity, verify MM2 inventory
    // value before returning the user. Roblox RAP is optional and is never used
    // as the primary MM2 qualification criterion.
    const cachedPresences = getFreshGameLiveCachePresences(game, {
      minimumRap,
      limit: Math.max(requestedLimit, MM2_PROFILE_CHECK_LIMIT),
    });

    if (cachedPresences.length > 0) {
      const cachedValueChecks = await mapWithConcurrency(
        cachedPresences.slice(0, MM2_PROFILE_CHECK_LIMIT),
        MM2_PROFILE_CONCURRENCY,
        (presence) =>
          buildMm2ValueTarget(presence, {
            minimumMm2Value: mm2ValueFloor,
            minimumRap,
          }).catch((error) => {
            console.warn(
              `MM2 cached-value verification failed for Roblox user ${presence?.userId}:`,
              error,
            );
            return {
              qualifies: false,
              reason: "mm2-value-unavailable",
            };
          }),
      );

      const cachedPlayers = cachedValueChecks
        .filter((player) => player?.qualifies)
        .map(({ qualifies, ...player }) => ({
          ...player,
          presenceFreshness: "recent",
        }))
        .slice(0, requestedLimit);

      if (
        cachedPlayers.length >= requestedLimit ||
        (Date.now() < presenceApiBackoffUntil &&
          cachedPlayers.length > 0)
      ) {
        return buildMm2ValueScanResult({
          game,
          minimumMm2Value: mm2ValueFloor,
          minimumRap,
          players: cachedPlayers,
          candidateIds: getMm2CandidateIds(minimumRap),
          presenceScannedCount: 0,
          totalInGameSeen: cachedPresences.length,
          mm2Presences: cachedPresences,
          valueChecks: cachedValueChecks,
          scanElapsedMs: 0,
          liveCacheHit: true,
          presenceRateLimited: Date.now() < presenceApiBackoffUntil,
          presenceFallbackUsed: false,
          scanComplete: false,
          throttlePauses: 0,
          mm2ProfilesCheckedThisPass: 0,
          mm2ProfilesAvailableThisPass: 0,
          mm2ProfilesUnavailableThisPass: 0,
          mm2ValueIndexQualifiedCount:
            getIndexedMm2ValueCandidateIds({
              minimumMm2Value: mm2ValueFloor,
              minimumRap,
            }).length,
          mm2ValueIndexKnownCount: getKnownMm2ValueCandidateCount(),
        });
      }
    }

    const mm2IndexRefresh = await refreshMm2ValueIndex({
      minimumMm2Value: mm2ValueFloor,
      minimumRap,
    });

    const candidateIds = getIndexedMm2ValueCandidateIds({
      minimumMm2Value: mm2ValueFloor,
      minimumRap,
    });

    if (candidateIds.length === 0) {
      return buildMm2ValueScanResult({
        game,
        minimumMm2Value: mm2ValueFloor,
        minimumRap,
        players: [],
        candidateIds,
        presenceScannedCount: 0,
        totalInGameSeen: 0,
        mm2Presences: [],
        valueChecks: [],
        scanElapsedMs: mm2IndexRefresh.elapsedMs,
        liveCacheHit: false,
        presenceRateLimited: false,
        presenceFallbackUsed: false,
        scanComplete: false,
        throttlePauses: 0,
        mm2ProfilesCheckedThisPass: mm2IndexRefresh.checked,
        mm2ProfilesAvailableThisPass: mm2IndexRefresh.available,
        mm2ProfilesUnavailableThisPass: mm2IndexRefresh.unavailable,
        mm2UsernameResolutionUnavailable:
          mm2IndexRefresh.usernameResolutionUnavailable ?? 0,
        mm2IndexTransientFailure:
          mm2IndexRefresh.transientFailure === true,
        mm2ValueIndexQualifiedCount: 0,
        mm2ValueIndexKnownCount: mm2IndexRefresh.knownCount,
      });
    }

    const startedAt = Date.now();
    const orderedIds = [];
    const scanStart = mm2PresenceCursor % candidateIds.length;
    for (let offset = 0; offset < candidateIds.length; offset += 1) {
      orderedIds.push(
        candidateIds[(scanStart + offset) % candidateIds.length],
      );
    }

    const mm2PresenceByUserId = new Map();
    let totalChecked = 0;
    let totalInGameSeen = 0;
    let presenceRateLimited = false;
    let presenceFallbackUsed = false;
    let throttlePauses = 0;

    // First find actual MM2 players. Only those users are sent to RBLXValue,
    // which keeps MM2-value lookups cheap and avoids wasting API quota.
    for (
      let offset = 0;
      offset < orderedIds.length &&
      Date.now() - startedAt < MM2_ACTIVITY_SWEEP_TIME_BUDGET_MS &&
      mm2PresenceByUserId.size < MM2_PROFILE_CHECK_LIMIT;
      offset += MM2_ACTIVITY_SWEEP_CHUNK_SIZE
    ) {
      const chunk = orderedIds.slice(
        offset,
        offset + MM2_ACTIVITY_SWEEP_CHUNK_SIZE,
      );
      const usingDirectFallback = Date.now() < presenceApiBackoffUntil;

      const presenceScan = await getPresenceBatched(chunk, {
        maxAttempts: 1,
        interBatchDelayMs: 1_100,
        stopOnRateLimit: true,
        presenceFetcher: usingDirectFallback
          ? getUsersPresenceFallback
          : getUsersPresence,
        fallbackFetcher: usingDirectFallback
          ? null
          : getUsersPresenceFallback,
        fallbackOnRateLimit: !usingDirectFallback,
      });

      totalChecked += presenceScan.checkedIds.length;
      presenceRateLimited =
        presenceRateLimited || presenceScan.rateLimited === true;
      presenceFallbackUsed =
        presenceFallbackUsed ||
        usingDirectFallback ||
        presenceScan.usedFallback === true;

      const inGamePresences = presenceScan.presences.filter(
        (presence) => Number(presence?.userPresenceType) === 2,
      );
      totalInGameSeen += inGamePresences.length;

      for (const presence of inGamePresences) {
        if (isPresenceForGame(presence, game)) {
          mm2PresenceByUserId.set(Number(presence.userId), presence);
        }
      }

      const incompleteChunk =
        presenceScan.checkedIds.length < chunk.length;
      const proxyBacked =
        usingDirectFallback || presenceScan.usedFallback === true;

      if (incompleteChunk && presenceScan.rateLimited) {
        const canPauseAgain =
          throttlePauses < 3 &&
          Date.now() - startedAt + MM2_ACTIVITY_THROTTLE_PAUSE_MS <
            MM2_ACTIVITY_SWEEP_TIME_BUDGET_MS;

        if (!canPauseAgain) break;

        throttlePauses += 1;
        await sleep(MM2_ACTIVITY_THROTTLE_PAUSE_MS);
        offset +=
          presenceScan.checkedIds.length -
          MM2_ACTIVITY_SWEEP_CHUNK_SIZE;
        continue;
      }

      if (incompleteChunk) break;

      if (
        proxyBacked &&
        offset + MM2_ACTIVITY_SWEEP_CHUNK_SIZE < orderedIds.length &&
        Date.now() - startedAt + MM2_ACTIVITY_THROTTLE_PAUSE_MS <
          MM2_ACTIVITY_SWEEP_TIME_BUDGET_MS
      ) {
        throttlePauses += 1;
        await sleep(MM2_ACTIVITY_THROTTLE_PAUSE_MS);
      }
    }

    mm2PresenceCursor =
      (scanStart + Math.max(totalChecked, PRESENCE_BATCH_SIZE)) %
      candidateIds.length;

    const mm2Presences = [...mm2PresenceByUserId.values()];
    const valueChecks = await mapWithConcurrency(
      mm2Presences.slice(0, MM2_PROFILE_CHECK_LIMIT),
      MM2_PROFILE_CONCURRENCY,
      (presence) =>
        buildMm2ValueTarget(presence, {
          minimumMm2Value: mm2ValueFloor,
          minimumRap,
        }).catch((error) => {
          console.warn(
            `MM2 value verification failed for Roblox user ${presence?.userId}:`,
            error,
          );
          return {
            qualifies: false,
            reason: "mm2-value-unavailable",
          };
        }),
    );

    const players = valueChecks
      .filter((player) => player?.qualifies)
      .sort(
        (left, right) =>
          Number(right?.mm2Value ?? 0) - Number(left?.mm2Value ?? 0),
      )
      .map(({ qualifies, ...player }) => ({
        ...player,
        presenceFreshness: "fresh",
      }))
      .slice(0, requestedLimit);

    return buildMm2ValueScanResult({
      game,
      minimumMm2Value: mm2ValueFloor,
      minimumRap,
      players,
      candidateIds,
      presenceScannedCount: totalChecked,
      totalInGameSeen,
      mm2Presences,
      valueChecks,
      scanElapsedMs: Date.now() - startedAt,
      liveCacheHit: false,
      presenceRateLimited,
      presenceFallbackUsed,
      scanComplete:
        totalChecked >= candidateIds.length ||
        mm2PresenceByUserId.size >= MM2_PROFILE_CHECK_LIMIT,
      throttlePauses,
      scanCursorStart: scanStart,
      scanCursorNext: mm2PresenceCursor,
      mm2ProfilesCheckedThisPass: mm2IndexRefresh.checked,
      mm2ProfilesAvailableThisPass: mm2IndexRefresh.available,
      mm2ProfilesUnavailableThisPass: mm2IndexRefresh.unavailable,
      mm2UsernameResolutionUnavailable:
        mm2IndexRefresh.usernameResolutionUnavailable ?? 0,
      mm2IndexTransientFailure:
        mm2IndexRefresh.transientFailure === true,
      mm2ValueIndexQualifiedCount: candidateIds.length,
      mm2ValueIndexKnownCount: mm2IndexRefresh.knownCount,
    });
  } finally {
    activeInteractivePresenceScans = Math.max(
      0,
      activeInteractivePresenceScans - 1,
    );
  }
}

async function refreshMm2ValueIndex({
  minimumMm2Value,
  minimumRap = null,
} = {}) {
  const startedAt = Date.now();
  const allCandidates = getMm2CandidateIds(minimumRap);
  if (allCandidates.length === 0) {
    return {
      checked: 0,
      available: 0,
      unavailable: 0,
      knownCount: getKnownMm2ValueCandidateCount(),
      elapsedMs: 0,
    };
  }

  const now = Date.now();
  const staleOrUnknown = allCandidates.filter((userId) => {
    const candidate = candidatePool.get(Number(userId));
    const checkedAt = Number(candidate?.lastKnownMm2ValueAt ?? 0);
    return !checkedAt || now - checkedAt >= MM2_VALUE_INDEX_TTL_MS;
  });

  if (staleOrUnknown.length === 0) {
    return {
      checked: 0,
      available: 0,
      unavailable: 0,
      knownCount: getKnownMm2ValueCandidateCount(),
      elapsedMs: 0,
    };
  }

  const ordered = staleOrUnknown
    .map((userId) => candidatePool.get(Number(userId)))
    .filter(Boolean)
    .sort((left, right) => {
      const leftSources = [...(left.sources ?? [])].join(" ").toLowerCase();
      const rightSources = [...(right.sources ?? [])].join(" ").toLowerCase();
      const leftMm2Signal =
        leftSources.includes("mm2") ||
        leftSources.includes("murder mystery")
          ? 1
          : 0;
      const rightMm2Signal =
        rightSources.includes("mm2") ||
        rightSources.includes("murder mystery")
          ? 1
          : 0;

      if (leftMm2Signal !== rightMm2Signal) {
        return rightMm2Signal - leftMm2Signal;
      }

      return (
        getCandidatePriority(
          right,
          { minimumValue: null, minimumRap },
        ) -
        getCandidatePriority(
          left,
          { minimumValue: null, minimumRap },
        )
      );
    })
    .map((candidate) => Number(candidate.userId));

  const batch = ordered.slice(
    0,
    Math.min(MM2_VALUE_DISCOVERY_BATCH_SIZE, ordered.length),
  );

  mm2ValueDiscoveryCursor += batch.length;

  let robloxUsers;
  try {
    robloxUsers = await getRobloxUsersByIds(batch);
  } catch (error) {
    const status = Number(error?.status);
    console.warn(
      `MM2 username batch resolution failed${status ? ` (HTTP ${status})` : ""}; leaving candidates eligible for retry.`,
      error,
    );

    return {
      checked: 0,
      available: 0,
      unavailable: 0,
      usernameResolutionUnavailable: batch.length,
      transientFailure: true,
      qualified: 0,
      persisted: 0,
      watchlistTotal: 0,
      knownCount: getKnownMm2ValueCandidateCount(),
      elapsedMs: Date.now() - startedAt,
    };
  }

  const robloxUserById = new Map(
    (robloxUsers ?? [])
      .map((user) => [Number(user?.id), user])
      .filter(([userId]) => Number.isInteger(userId) && userId > 0),
  );

  const results = await mapWithConcurrency(
    batch,
    MM2_PROFILE_CONCURRENCY,
    async (userId) => {
      const candidate = candidatePool.get(Number(userId));
      if (!candidate) {
        return { userId, available: false };
      }

      const robloxUser = robloxUserById.get(Number(userId));
      const username = String(robloxUser?.name ?? "").trim();

      if (!username) {
        return {
          userId,
          available: false,
          reason: "username-unavailable",
        };
      }

      try {
        const profile = await getRblxValueProfile({
          username,
          requestTimeoutMs: 3_500,
          maxRetries: 0,
        });

        candidate.lastKnownMm2ValueAt = Date.now();

        if (
          profile?.status !== "verified" ||
          !Number.isFinite(Number(profile?.totalValue))
        ) {
          candidate.lastKnownMm2Value = null;
          candidate.lastKnownMm2ItemCount = null;
          candidate.lastKnownMm2ValueSource =
            profile?.source ?? "RBLXValue API v2 profile";
          return {
            userId,
            available: false,
            reason: "mm2-profile-unavailable",
          };
        }

        candidate.lastKnownMm2Value = Number(profile.totalValue);
        candidate.lastKnownMm2ItemCount =
          Number.isFinite(Number(profile?.itemCount))
            ? Number(profile.itemCount)
            : null;
        candidate.lastKnownMm2ValueSource =
          profile?.source ?? "RBLXValue API v2 profile";

        return {
          userId,
          username,
          displayName: robloxUser?.displayName ?? null,
          available: true,
          qualifies:
            Number(profile.totalValue) >= Number(minimumMm2Value),
          mm2Value: Number(profile.totalValue),
          mm2ItemCount:
            Number.isFinite(Number(profile?.itemCount))
              ? Number(profile.itemCount)
              : null,
          mm2ValueSource:
            profile?.source ?? "RBLXValue API v2 profile",
        };
      } catch (error) {
        const status = Number(error?.status);
        console.warn(
          `MM2 value source lookup failed for Roblox user ${userId}${status ? ` (HTTP ${status})` : ""}:`,
          error,
        );

        // Do not poison the 30-minute cache on transient provider failures.
        if (status === 408 || status === 429 || status >= 500) {
          return {
            userId,
            available: false,
            reason: "mm2-profile-transient",
          };
        }

        candidate.lastKnownMm2ValueAt = Date.now();
        candidate.lastKnownMm2Value = null;
        candidate.lastKnownMm2ItemCount = null;
        candidate.lastKnownMm2ValueSource =
          "RBLXValue API v2 profile";

        return {
          userId,
          available: false,
          reason: "mm2-profile-unavailable",
        };
      }
    },
  );

  const watchablePlayers = results
    .filter(
      (result) =>
        result?.available &&
        Number.isFinite(Number(result?.mm2Value)) &&
        Number(result.mm2Value) >= DEFAULT_MM2_VALUE,
    )
    .map((result) => ({
      userId: result.userId,
      username: result.username ?? null,
      displayName: result.displayName ?? null,
      mm2Value: Number(result.mm2Value),
      mm2ItemCount: result.mm2ItemCount ?? null,
      mm2ValueSource:
        result.mm2ValueSource ?? "RBLXValue API v2 profile",
    }));

  const persisted =
    watchablePlayers.length > 0
      ? await addMm2ValuePlayers(watchablePlayers)
      : { added: 0, updated: 0, total: 0 };

  return {
    checked: results.length,
    available: results.filter((result) => result?.available).length,
    unavailable: results.filter(
      (result) =>
        !result?.available &&
        result?.reason !== "username-unavailable",
    ).length,
    usernameResolutionUnavailable: results.filter(
      (result) => result?.reason === "username-unavailable",
    ).length,
    qualified: results.filter((result) => result?.qualifies).length,
    persisted: watchablePlayers.length,
    watchlistTotal: persisted.total ?? 0,
    knownCount: getKnownMm2ValueCandidateCount(),
    elapsedMs: Date.now() - startedAt,
  };
}

export async function refreshMm2ValueWatchCandidates() {
  await syncWatchlistCandidates();

  if (candidatePool.size === 0) {
    await withTimeout(refreshCandidatePoolLightweight(), 8_000, null);
  }

  return refreshMm2ValueIndex({
    minimumMm2Value: DEFAULT_MM2_VALUE,
    minimumRap: null,
  });
}

function getIndexedMm2ValueCandidateIds({
  minimumMm2Value,
  minimumRap = null,
} = {}) {
  const now = Date.now();

  return [...candidatePool.values()]
    .filter((candidate) => {
      if (
        minimumRap !== null &&
        minimumRap !== undefined &&
        (!Number.isFinite(Number(candidate?.lastKnownRap)) ||
          Number(candidate.lastKnownRap) < Number(minimumRap))
      ) {
        return false;
      }

      if (
        typeof candidate?.lastKnownMm2Value !== "number" ||
        !Number.isFinite(candidate.lastKnownMm2Value) ||
        candidate.lastKnownMm2Value <
          Number(minimumMm2Value)
      ) {
        return false;
      }

      const checkedAt = Number(candidate?.lastKnownMm2ValueAt ?? 0);
      return checkedAt > 0 && now - checkedAt < MM2_VALUE_INDEX_TTL_MS;
    })
    .sort((left, right) => {
      const valueDelta =
        Number(right.lastKnownMm2Value ?? 0) -
        Number(left.lastKnownMm2Value ?? 0);
      if (valueDelta !== 0) return valueDelta;

      return (
        getCandidatePriority(
          right,
          { minimumValue: null, minimumRap },
        ) -
        getCandidatePriority(
          left,
          { minimumValue: null, minimumRap },
        )
      );
    })
    .map((candidate) => Number(candidate.userId));
}

function getKnownMm2ValueCandidateCount() {
  const now = Date.now();

  return [...candidatePool.values()].filter((candidate) => {
    const checkedAt = Number(candidate?.lastKnownMm2ValueAt ?? 0);
    return (
      checkedAt > 0 &&
      now - checkedAt < MM2_VALUE_INDEX_TTL_MS &&
      typeof candidate?.lastKnownMm2Value === "number" &&
      Number.isFinite(candidate.lastKnownMm2Value)
    );
  }).length;
}

function getMm2CandidateIds(minimumRap = null) {
  return [...candidatePool.values()]
    .filter((candidate) => {
      if (minimumRap === null || minimumRap === undefined) return true;
      return (
        Number.isFinite(Number(candidate?.lastKnownRap)) &&
        Number(candidate.lastKnownRap) >= Number(minimumRap)
      );
    })
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
    )
    .map((candidate) => Number(candidate.userId))
    .filter((userId) => Number.isInteger(userId) && userId > 0);
}

async function buildMm2ValueTarget(
  presence,
  { minimumMm2Value, minimumRap = null } = {},
) {
  const userId = Number(presence?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return {
      qualifies: false,
      reason: "invalid-user",
    };
  }

  const candidate = candidatePool.get(userId);
  if (
    minimumRap !== null &&
    minimumRap !== undefined &&
    (!Number.isFinite(Number(candidate?.lastKnownRap)) ||
      Number(candidate.lastKnownRap) < Number(minimumRap))
  ) {
    return {
      qualifies: false,
      id: userId,
      reason: "below-rap",
    };
  }

  const hasFreshIndexedMm2Value =
    typeof candidate?.lastKnownMm2Value === "number" &&
    Number.isFinite(candidate.lastKnownMm2Value) &&
    Number(candidate?.lastKnownMm2ValueAt ?? 0) > 0 &&
    Date.now() - Number(candidate.lastKnownMm2ValueAt) <
      MM2_VALUE_INDEX_TTL_MS;

  const userPromise = getRobloxUserById(userId);
  const avatarPromise = getAvatarThumbnail(userId);
  const userForProfile = await userPromise.catch(() => null);
  const usernameForProfile = String(userForProfile?.name ?? "").trim();

  const [userResult, avatarResult, mm2ProfileResult] =
    await Promise.allSettled([
      Promise.resolve(userForProfile),
      avatarPromise,
      hasFreshIndexedMm2Value
        ? Promise.resolve({
            status: "verified",
            totalValue: Number(candidate.lastKnownMm2Value),
            itemCount:
              candidate.lastKnownMm2ItemCount ?? null,
            source:
              candidate.lastKnownMm2ValueSource ??
              "RBLXValue API v2 profile",
            sourceUrl: "https://rblxvalue.com",
          })
        : usernameForProfile
          ? getRblxValueProfile({
              username: usernameForProfile,
              requestTimeoutMs: 3_500,
              maxRetries: 0,
            })
          : Promise.resolve(null),
    ]);

  const mm2Profile =
    mm2ProfileResult.status === "fulfilled"
      ? mm2ProfileResult.value
      : null;
  const mm2Value = Number(mm2Profile?.totalValue);

  if (
    candidate &&
    mm2Profile?.status === "verified" &&
    Number.isFinite(mm2Value)
  ) {
    candidate.lastKnownMm2Value = mm2Value;
    candidate.lastKnownMm2ValueAt = Date.now();
    candidate.lastKnownMm2ItemCount =
      Number.isFinite(Number(mm2Profile?.itemCount))
        ? Number(mm2Profile.itemCount)
        : null;
    candidate.lastKnownMm2ValueSource =
      mm2Profile?.source ?? "RBLXValue API v2 profile";
  }

  if (
    mm2Profile?.status !== "verified" ||
    !Number.isFinite(mm2Value)
  ) {
    return {
      qualifies: false,
      id: userId,
      reason: "mm2-value-unavailable",
    };
  }

  if (mm2Value < Number(minimumMm2Value)) {
    return {
      qualifies: false,
      id: userId,
      reason: "below-mm2-value",
      mm2Value,
    };
  }

  const user =
    userResult.status === "fulfilled" && userResult.value
      ? userResult.value
      : {
          id: userId,
          name: `user-${userId}`,
          displayName: `Roblox user ${userId}`,
        };

  const joinability = buildTargetJoinability(presence, userId);

  return {
    qualifies: true,
    id: userId,
    username: user.name ?? "Unavailable",
    displayName: user.displayName ?? "Unavailable",
    avatarUrl:
      avatarResult.status === "fulfilled" ? avatarResult.value : null,
    profileUrl: `https://www.roblox.com/users/${userId}/profile`,
    presenceStatus: "In game",
    gameName: presence?.lastLocation || "Murder Mystery 2",
    ...joinability,
    mm2Value,
    mm2ItemCount:
      Number.isFinite(Number(mm2Profile?.itemCount))
        ? Number(mm2Profile.itemCount)
        : null,
    mm2ValueSource:
      mm2Profile?.source ?? "RBLXValue API v2 profile",
    mm2ValueSourceUrl:
      mm2Profile?.sourceUrl ?? "https://rblxvalue.com",
    rapValue:
      Number.isFinite(Number(candidate?.lastKnownRap))
        ? Number(candidate.lastKnownRap)
        : null,
    rapSource:
      candidate?.lastKnownRapSource ?? null,
  };
}

function buildMm2ValueScanResult({
  game,
  minimumMm2Value,
  minimumRap,
  players,
  candidateIds,
  presenceScannedCount,
  totalInGameSeen,
  mm2Presences,
  valueChecks,
  scanElapsedMs,
  liveCacheHit,
  presenceRateLimited,
  presenceFallbackUsed,
  scanComplete,
  throttlePauses,
  scanCursorStart = null,
  scanCursorNext = null,
  mm2ProfilesCheckedThisPass = 0,
  mm2ProfilesAvailableThisPass = 0,
  mm2ProfilesUnavailableThisPass = 0,
  mm2UsernameResolutionUnavailable = 0,
  mm2IndexTransientFailure = false,
  mm2ValueIndexQualifiedCount = 0,
  mm2ValueIndexKnownCount = 0,
}) {
  const checks = Array.isArray(valueChecks) ? valueChecks : [];

  return {
    gameKey: "mm2",
    gameLabel: game.label,
    universeId: game.universeId,
    minimumMm2Value,
    minimumRap,
    players,
    candidateCount: candidateIds.length,
    candidatePoolSize: candidatePool.size,
    candidateSourceCounts: getPoolSourceCounts(),
    presenceScannedCount,
    totalInGameSeen,
    gameActiveCount: mm2Presences.length,
    mm2ValueChecksAttempted: checks.length,
    mm2ProfilesCheckedThisPass,
    mm2ProfilesAvailableThisPass,
    mm2ProfilesUnavailableThisPass,
    mm2UsernameResolutionUnavailable,
    mm2IndexTransientFailure,
    mm2ValueIndexQualifiedCount,
    mm2ValueIndexKnownCount,
    mm2ValueUnavailableCount: checks.filter(
      (player) => player?.reason === "mm2-value-unavailable",
    ).length,
    belowMm2ValueCount: checks.filter(
      (player) => player?.reason === "below-mm2-value",
    ).length,
    verifiedCount: players.length,
    scanElapsedMs,
    liveCacheHit,
    presenceRateLimited,
    presenceFallbackUsed,
    scanComplete,
    throttlePauses,
    scanCursorStart,
    scanCursorNext,
    sources: [
      "SE TARG public candidate discovery pool",
      "Roblox public live presence",
      "Murder Mystery 2 universe/activity filter",
      "RBLXValue API v2 MM2 profile value",
    ],
  };
}

export async function scanGameTargets({
  gameKey,
  minimumValue = null,
  minimumRap = getMinimumTargetRap(),
  limit = DEFAULT_TARGET_COUNT,
  includeGameValue = true,
  maxCandidatesOverride = null,
  timeBudgetMs = null,
} = {}) {
  const game = GAME_TARGETS[gameKey];
  if (!game) {
    throw new Error(`Unsupported game target key: ${gameKey}`);
  }

  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );
  const scanTimeBudgetMs =
    Number.isFinite(Number(timeBudgetMs)) && Number(timeBudgetMs) > 0
      ? Number(timeBudgetMs)
      : DEFAULT_GAME_SCAN_TIME_BUDGET_MS;
  const qualificationGoal = Math.min(
    200,
    Math.max(requestedLimit * 4, requestedLimit + 25),
  );

  activeInteractivePresenceScans += 1;
  try {
    await syncWatchlistCandidates();

    const cacheStartedAt = Date.now();
    const cachedPresences = getFreshGameLiveCachePresences(game, {
      minimumRap,
      limit: Math.min(MAX_TARGETS + 5, requestedLimit + 5),
    });

    if (cachedPresences.length > 0) {
      const cachedResults = await mapWithConcurrency(
        cachedPresences,
        VERIFY_CONCURRENCY,
        (presence) =>
          buildDiscoveredTargetPlayer(presence, {
            minimumValue,
            minimumRap,
            includeGameValue,
          }).catch((error) => {
            console.warn(
              `${game.label} cached target verification failed for Roblox user ${presence?.userId}:`,
              error,
            );
            return null;
          }),
      );

      const cachedVerified = cachedResults
        .filter((player) => player?.qualifies)
        .slice(0, Math.min(MAX_TARGETS + 10, requestedLimit + 10));
      const cachedJoinable = await revalidatePlayersForGame(
        cachedVerified,
        game,
      );

      if (cachedJoinable.length >= requestedLimit) {
        return {
          gameKey,
          gameLabel: game.label,
          universeId: game.universeId,
          minimumValue,
          minimumRap,
          players: cachedJoinable
            .slice(0, requestedLimit)
            .map(({ qualifies, ...player }) => ({
              ...player,
              presenceFreshness: "fresh",
            })),
          candidateCount: cachedPresences.length,
          candidatePoolSize: candidatePool.size,
          candidateSourceCounts: getPoolSourceCounts(),
          presenceScannedCount: 0,
          gameActiveCount: cachedPresences.length,
          verificationAttempts: cachedResults.length,
          valueUnavailableCount: cachedResults.filter(
            (player) => player?.reason === "value-unavailable",
          ).length,
          belowValueCount: cachedResults.filter(
            (player) => player?.reason === "below-value",
          ).length,
          rapUnavailableCount: cachedResults.filter(
            (player) => player?.reason === "rap-unavailable",
          ).length,
          belowRapCount: cachedResults.filter(
            (player) => player?.reason === "below-rap",
          ).length,
          verifiedCount: cachedJoinable.length,
          presenceRateLimited: Date.now() < presenceApiBackoffUntil,
          presenceFallbackUsed: false,
          liveCacheHit: true,
          scanElapsedMs: Date.now() - cacheStartedAt,
          sources: [
            "Background verified RAP index",
            "Background Roblox live-presence cache",
            "Public Roblox/Rolimon's RAP verification",
          ],
        };
      }
    }

    const discovery = await discoverCandidateUserIds({
      minimumRap,
      minimumValue,
      respectCooldown: false,
      maxCandidatesOverride:
        Number.isInteger(Number(maxCandidatesOverride)) &&
        Number(maxCandidatesOverride) > 0
          ? Number(maxCandidatesOverride)
          : getPositiveIntegerEnv(
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
    let presenceRateLimited = false;
    let presenceFallbackUsed = false;
    let offset = 0;

    while (
      offset < discovery.userIds.length &&
      Date.now() - startedAt < scanTimeBudgetMs &&
      verifiedPlayers.length < qualificationGoal
    ) {
      const wave = discovery.userIds.slice(
        offset,
        offset + DEFAULT_GAME_SCAN_WAVE_SIZE,
      );
      const route = getInteractivePresenceRoute();

      if (!route) {
        presenceRateLimited = true;
        break;
      }

      const presenceScan = await getPresenceBatched(wave, {
        maxAttempts: 1,
        interBatchDelayMs: 1_000,
        stopOnRateLimit: true,
        presenceFetcher: route.presenceFetcher,
        fallbackFetcher: route.fallbackFetcher,
        fallbackOnRateLimit: route.fallbackOnRateLimit,
      });

      presenceScannedCount += presenceScan.checkedIds.length;
      presenceRateLimited =
        presenceRateLimited || presenceScan.rateLimited === true;
      presenceFallbackUsed =
        presenceFallbackUsed ||
        (route.usingFallback && presenceScan.checkedIds.length > 0) ||
        presenceScan.usedFallback === true;

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

      for (
        let index = 0;
        index < gamePresences.length;
        index += VERIFY_CONCURRENCY
      ) {
        if (
          Date.now() - startedAt >= scanTimeBudgetMs ||
          verifiedPlayers.length >= qualificationGoal
        ) {
          break;
        }

        const batch = gamePresences.slice(
          index,
          index + VERIFY_CONCURRENCY,
        );
        verificationAttempts += batch.length;

        const batchResults = await Promise.all(
          batch.map((presence) =>
            buildDiscoveredTargetPlayer(presence, {
              minimumValue,
              minimumRap,
              includeGameValue,
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

      if (presenceScan.checkedIds.length > 0) {
        offset += presenceScan.checkedIds.length;
      } else if (
        presenceScan.rateLimited &&
        !route.usingFallback &&
        Date.now() - startedAt < scanTimeBudgetMs
      ) {
        // Roblox just entered shared backoff. Retry the same slice through
        // the public fallback route instead of skipping unobserved users.
        continue;
      } else {
        break;
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
      presenceFallbackUsed,
      liveCacheHit: false,
      scanElapsedMs: Date.now() - startedAt,
      sources: [
        ...new Set([
          ...discovery.sources,
          "Roblox public presence",
          ...(presenceFallbackUsed
            ? ["Secondary public Roblox presence fallback"]
            : []),
          "Roblox public collectibles inventory",
          "Rolimon's public player info/value enrichment",
          ...(gameKey === "mm2" && includeGameValue
            ? ["RBLXValue profile/inventory enrichment when available"]
            : []),
        ]),
      ],
    };
  } finally {
    activeInteractivePresenceScans = Math.max(
      0,
      activeInteractivePresenceScans - 1,
    );
  }
}

export function isMm2Presence(presence) {
  return isPresenceForGame(presence, GAME_TARGETS.mm2);
}

export function getPriorityGameKey(presence) {
  if (Number(presence?.userPresenceType) !== 2) return null;

  for (const key of PRIORITY_GAME_KEYS) {
    if (isPresenceForGame(presence, GAME_TARGETS[key])) {
      return key;
    }
  }
  return null;
}

function getPriorityGameLabel(key) {
  return key ? GAME_TARGETS[key]?.label ?? null : null;
}

function compareTargetPresences(
  left,
  right,
  { minimumValue = null, minimumRap = null } = {},
) {
  const leftPriority = getPriorityGameKey(left) ? 1 : 0;
  const rightPriority = getPriorityGameKey(right) ? 1 : 0;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  return (
    getCandidatePriority(
      candidatePool.get(Number(right?.userId)),
      { minimumValue, minimumRap },
    ) -
    getCandidatePriority(
      candidatePool.get(Number(left?.userId)),
      { minimumValue, minimumRap },
    )
  );
}

function sortTargetPlayersForPriority(players) {
  return [...(players ?? [])].sort((left, right) => {
    const leftPriority = left?.priorityGameKey ? 1 : 0;
    const rightPriority = right?.priorityGameKey ? 1 : 0;
    return rightPriority - leftPriority;
  });
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
  await ensureCandidateDatabaseHydrated();

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
      "Pet Simulator 99 official public API",
      ...(process.env.JBTN_PUBLIC_FEED_URL?.trim()
        ? ["Jailbreak Trading Network public trade listings"]
        : []),
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

async function refreshSearchCandidateSources() {
  const terms = nextSearchTerms(SEARCH_TERMS_PER_REFRESH);

  const robloxResults = [];
  if (Date.now() >= userSearchBackoffUntil) {
    for (const term of terms) {
      try {
        const result = await searchRobloxUsers(term, { limit: 25 });
        robloxResults.push(result.users ?? []);
        await sleep(300);
      } catch (error) {
        if (Number(error?.status) === 429) {
          userSearchBackoffUntil = Math.max(
            userSearchBackoffUntil,
            Date.now() +
              getPositiveIntegerEnv(
                "ROBLOX_USER_SEARCH_BACKOFF_MS",
                DEFAULT_USER_SEARCH_BACKOFF_MS,
              ),
          );
          console.warn(
            `Roblox user search rate-limited at "${term}"; stopping this search sweep.`,
          );
          break;
        }
        console.warn(`Roblox user search failed for "${term}":`, error);
      }
    }
  }

  const robloxUserIds = [
    ...new Set(
      robloxResults
        .flat()
        .map((user) => Number(user?.id ?? user?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];
  addCandidatesToPool(
    robloxUserIds,
    "Roblox public user search",
    Date.now(),
  );

  const rolimonsResults = await mapWithConcurrency(
    terms.slice(0, ROLIMONS_SEARCH_TERMS_PER_REFRESH),
    SEARCH_CONCURRENCY,
    async (term) => {
      try {
        const result = await searchRolimonsPlayers(term);
        return result.players ?? [];
      } catch (error) {
        console.warn(`Rolimon's player search failed for "${term}":`, error);
        return [];
      }
    },
  );

  const rolimonsUserIds = [
    ...new Set(
      rolimonsResults
        .flat()
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];
  addCandidatesToPool(
    rolimonsUserIds,
    "Rolimon's player search",
    Date.now(),
  );

  return {
    userSearch: robloxUserIds.length,
    rolimonsSearch: rolimonsUserIds.length,
  };
}

async function refreshGeneralCandidatePool() {
  await ensureCandidateDatabaseHydrated();
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
  if (
    now >= limitedOwnerBackoffUntil &&
    now - lastLimitedOwnerRefreshAt >= LIMITED_OWNER_REFRESH_INTERVAL_MS
  ) {
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

  let searchStats = {
    userSearch: 0,
    rolimonsSearch: 0,
  };
  if (now - lastSearchRefreshAt >= SEARCH_REFRESH_INTERVAL_MS) {
    searchStats = await refreshSearchCandidateSources().catch((error) => {
      console.warn("Public player-search discovery failed:", error);
      return searchStats;
    });
    lastSearchRefreshAt = now;
  }

  let groupStats = {
    groupSearchMembers: 0,
    groupGraphMembers: 0,
    friendGroupMembers: 0,
    primaryGroupMembers: 0,
    groupOwners: 0,
    groupWallPosters: 0,
    allyGroupMembers: 0,
    enemyGroupMembers: 0,
  };
  if (
    now >= groupBackoffUntil &&
    now - lastGroupRefreshAt >= GROUP_REFRESH_INTERVAL_MS
  ) {
    groupStats = await refreshGroupCandidateSources().catch((error) => {
      if (Number(error?.status) === 429) {
        groupBackoffUntil = Math.max(
          groupBackoffUntil,
          Date.now() +
            getPositiveIntegerEnv(
              "ROBLOX_GROUP_DISCOVERY_BACKOFF_MS",
              DEFAULT_GROUP_DISCOVERY_BACKOFF_MS,
            ),
        );
      }
      console.warn("Roblox group discovery failed:", error);
      return groupStats;
    });
    lastGroupRefreshAt = now;
  }

  // Public Roblox Marketplace collectible owners add Roblox-native candidates
  // that do not have to be advertising a trade.
  let marketplaceStats = {
    marketplaceCreators: 0,
    marketplaceOwners: 0,
    marketplaceGroupMembers: 0,
  };
  if (
    now >= marketplaceBackoffUntil &&
    now - lastMarketplaceRefreshAt >= MARKETPLACE_REFRESH_INTERVAL_MS
  ) {
    marketplaceStats = await refreshMarketplaceCandidateSources().catch(
      (error) => {
        if (Number(error?.status) === 429) {
          marketplaceBackoffUntil = Math.max(
            marketplaceBackoffUntil,
            Date.now() +
              getPositiveIntegerEnv(
                "ROBLOX_MARKETPLACE_BACKOFF_MS",
                DEFAULT_MARKETPLACE_BACKOFF_MS,
              ),
          );
        }
        console.warn("Roblox Marketplace discovery failed:", error);
        return marketplaceStats;
      },
    );
    lastMarketplaceRefreshAt = now;
  }

  let jailbreakTradeUserIds = [];
  const jailbreakFeedConfigured = Boolean(
    process.env.JBTN_PUBLIC_FEED_URL?.trim(),
  );
  if (
    jailbreakFeedConfigured &&
    now - lastJailbreakTradeRefreshAt >=
      JAILBREAK_TRADE_REFRESH_INTERVAL_MS
  ) {
    jailbreakTradeUserIds = await refreshJailbreakTradeCandidates().catch(
      (error) => {
        console.warn("Jailbreak Trading Network discovery failed:", error);
        return [];
      },
    );
    lastJailbreakTradeRefreshAt = now;
  } else if (!jailbreakFeedConfigured && !jailbreakDisabledLogged) {
    jailbreakDisabledLogged = true;
    console.info(
      "Jailbreak Trading Network discovery disabled: no verified JBTN_PUBLIC_FEED_URL is configured.",
    );
  }

  const ps99PublicUserIds = await refreshPs99PublicCandidates(now);

  pruneCandidatePool();
  await persistCandidateDatabaseSnapshot();

  const sourceCounts = getPoolSourceCounts();
  return {
    ...sourceCounts,
    sourceCounts,
    refreshYield: {
      watchlist: watchlistUserIds.length,
      tradeAds: tradeAdUserIds.length,
      limitedOwners: limitedOwnerUserIds.length,
      leaderboard: leaderboardUserIds.length,
      jailbreakTrades: jailbreakTradeUserIds.length,
      ps99Public: ps99PublicUserIds.length,
      ...searchStats,
      ...groupStats,
      ...marketplaceStats,
    },
  };
}

async function refreshPs99PublicCandidates(now = Date.now()) {
  if (
    now - lastPs99PublicRefreshAt <
    PS99_PUBLIC_REFRESH_INTERVAL_MS
  ) {
    return [];
  }

  try {
    const result = await getPs99PublicCandidateUserIds();
    const userIds = result.userIds ?? [];
    addCandidatesToPool(
      userIds,
      "Pet Simulator 99 official public API",
      now,
    );
    lastPs99PublicRefreshAt = now;
    return userIds;
  } catch (error) {
    // Keep the source independent. A PS99 outage must never break /target.
    lastPs99PublicRefreshAt = now;
    console.warn("PS99 public candidate discovery failed:", error);
    return [];
  }
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
  if (Date.now() < marketplaceBackoffUntil) {
    return {
      marketplaceCreators: 0,
      marketplaceOwners: 0,
      marketplaceGroupMembers: 0,
    };
  }

  const noteMarketplaceError = (error) => {
    if (Number(error?.status) === 429) {
      marketplaceBackoffUntil = Math.max(
        marketplaceBackoffUntil,
        Date.now() +
          getPositiveIntegerEnv(
            "ROBLOX_MARKETPLACE_BACKOFF_MS",
            DEFAULT_MARKETPLACE_BACKOFF_MS,
          ),
      );
    }
  };

  let items = [];
  try {
    const result = await searchMarketplaceItems({
      category: 2,
      subcategory: null,
      sortType: 2,
      sortAggregation: 5,
      limit: 30,
    });
    items = result.items ?? [];
  } catch (error) {
    noteMarketplaceError(error);
    console.warn("Roblox Marketplace discovery failed:", error);
  }

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

  const deepMarketplaceExpansion =
    String(
      process.env.ROBLOX_MARKETPLACE_DEEP_EXPANSION_ENABLED ?? "false",
    ).toLowerCase() === "true";

  if (!deepMarketplaceExpansion) {
    return {
      marketplaceCreators: creatorUserIds.length,
      marketplaceOwners: 0,
      marketplaceGroupMembers: 0,
    };
  }

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
        noteMarketplaceError(error);
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
        noteMarketplaceError(error);
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
  if (Date.now() < groupBackoffUntil) {
    return {
      groupSearchMembers: 0,
      groupGraphMembers: 0,
      friendGroupMembers: 0,
      primaryGroupMembers: 0,
      groupOwners: 0,
      groupWallPosters: 0,
      allyGroupMembers: 0,
      enemyGroupMembers: 0,
    };
  }

  const noteGroupError = (error) => {
    if (Number(error?.status) === 429) {
      groupBackoffUntil = Math.max(
        groupBackoffUntil,
        Date.now() +
          getPositiveIntegerEnv(
            "ROBLOX_GROUP_DISCOVERY_BACKOFF_MS",
            DEFAULT_GROUP_DISCOVERY_BACKOFF_MS,
          ),
      );
    }
  };

  const terms = nextGroupSearchTerms(GROUP_SEARCH_TERMS_PER_REFRESH);

  const groupSearchResults = await mapWithConcurrency(
    terms,
    GROUP_CONCURRENCY,
    async (term) => {
      try {
        const result = await searchRobloxGroups(term, { limit: 10 });
        return result.groups.slice(0, GROUPS_PER_SEARCH_TERM);
      } catch (error) {
        noteGroupError(error);
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
        noteGroupError(error);
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
        noteGroupError(error);
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

  const deepGroupExpansion =
    String(
      process.env.ROBLOX_GROUP_DEEP_EXPANSION_ENABLED ?? "false",
    ).toLowerCase() === "true";

  if (!deepGroupExpansion) {
    return {
      groupSearchMembers: groupSearchUserIds.length,
      groupGraphMembers: groupGraphUserIds.length,
      friendGroupMembers: 0,
      primaryGroupMembers: 0,
      groupOwners: 0,
      groupWallPosters: 0,
      allyGroupMembers: 0,
      enemyGroupMembers: 0,
    };
  }

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
        noteGroupError(error);
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
        noteGroupError(error);
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
        noteGroupError(error);
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
        noteGroupError(error);
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
      [
        ...MANUAL_LIMITED_OWNER_SEEDS,
        ...tradeAdSeeds,
        ...rotatingSeeds,
      ].filter(
        (item) =>
          !limitedOwnerUnavailableAssetIds.has(Number(item?.id)),
      ),
      seedItemCount,
    );

    let stopLimitedOwnerSweep = false;
    const ownerPromise = mapWithConcurrency(
      seedItems,
      OWNER_CONCURRENCY,
      async (item, index) => {
        if (index > 0) {
          await sleep(
            getPositiveIntegerEnv(
              "ROBLOX_LIMITED_OWNER_INTER_ITEM_DELAY_MS",
              DEFAULT_LIMITED_OWNER_INTER_ITEM_DELAY_MS,
            ),
          );
        }

        if (
          stopLimitedOwnerSweep ||
          Date.now() < limitedOwnerBackoffUntil
        ) {
          return [];
        }

        try {
          const result = await getAssetOwners(item.id, {
            limit: ownersPerItem,
          });
          return result.owners;
        } catch (error) {
          if (Number(error?.status) === 403) {
            limitedOwnerUnavailableAssetIds.add(Number(item.id));
            console.warn(
              `Limited-owner asset ${item.id} returned HTTP 403; quarantining it for this runtime.`,
            );
            return [];
          }
          if (Number(error?.status) === 429) {
            stopLimitedOwnerSweep = true;
            limitedOwnerBackoffUntil = Math.max(
              limitedOwnerBackoffUntil,
              Date.now() +
                getPositiveIntegerEnv(
                  "ROBLOX_LIMITED_OWNER_BACKOFF_MS",
                  DEFAULT_LIMITED_OWNER_BACKOFF_MS,
                ),
            );
            console.warn(
              "Roblox limited-owner endpoint rate-limited; stopping this owner sweep and entering backoff.",
            );
          }
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
  const universeId = Number(presence?.universeId);
  const priorityGameKey = getPriorityGameKey(presence);
  const normalizedPlaceId =
    Number.isInteger(placeId) && placeId > 0 ? placeId : null;
  const exactJoinUrl =
    normalizedPlaceId && gameId
      ? getGameInstanceJoinUrl(normalizedPlaceId, gameId)
      : null;
  const followJoinUrl = getFollowUserJoinUrl(normalizedUserId);
  const verifiedJoinUrl = getVerifiedPlayerJoinUrl(normalizedUserId);

  // Presence can expose a JobId that is private/reserved or stale by click
  // time. The displayed join button therefore resolves the user again and
  // verifies the current JobId against Roblox's public-server list on click.
  return {
    placeId: normalizedPlaceId,
    gameId,
    universeId:
      Number.isInteger(universeId) && universeId > 0 ? universeId : null,
    priorityGameKey,
    priorityGameLabel: getPriorityGameLabel(priorityGameKey),
    followJoinUrl,
    exactJoinUrl,
    verifiedJoinUrl,
    joinReady: Boolean(verifiedJoinUrl),
    publicServerConfirmed: false,
    joinabilityStatus: verifiedJoinUrl
      ? "Public server will be reverified on click"
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

function getInteractivePresenceRoute() {
  const now = Date.now();
  const officialBackingOff = now < presenceApiBackoffUntil;
  const fallbackBackingOff = now < fallbackPresenceBackoffUntil;

  if (officialBackingOff && fallbackBackingOff) {
    return null;
  }

  const usingFallback = officialBackingOff && !fallbackBackingOff;

  return {
    usingFallback,
    officialBackingOff,
    fallbackBackingOff,
    presenceFetcher: usingFallback
      ? getUsersPresenceFallback
      : getUsersPresence,
    fallbackFetcher:
      !usingFallback && !fallbackBackingOff
        ? getUsersPresenceFallback
        : null,
    fallbackOnRateLimit:
      !usingFallback && !fallbackBackingOff,
  };
}

async function filterPublicJoinablePlayers(players) {
  const valid = (players ?? []).filter(
    (player) =>
      Number.isInteger(Number(player?.placeId)) &&
      Number(player.placeId) > 0 &&
      String(player?.gameId ?? "").trim(),
  );

  if (valid.length === 0) {
    return {
      players: [],
      nonPublicServerCount: (players ?? []).length,
      verificationErrorCount: 0,
    };
  }

  const byPlace = new Map();
  for (const player of valid) {
    const placeId = Number(player.placeId);
    const list = byPlace.get(placeId) ?? [];
    list.push(player);
    byPlace.set(placeId, list);
  }

  const groups = [...byPlace.entries()];
  const maxPages = getPositiveIntegerEnv(
    "ROBLOX_JOIN_VERIFY_MAX_PAGES",
    DEFAULT_PUBLIC_SERVER_VERIFY_MAX_PAGES,
  );

  const checkedGroups = await mapWithConcurrency(
    groups,
    PUBLIC_SERVER_VERIFY_CONCURRENCY,
    async ([placeId, groupPlayers]) => {
      try {
        const wantedIds = groupPlayers.map((player) =>
          String(player.gameId),
        );
        const matches = await getPublicGameInstanceMatches(
          placeId,
          wantedIds,
          { maxPages },
        );

        return {
          players: groupPlayers
            .filter((player) => matches.has(String(player.gameId)))
            .map((player) => ({
              ...player,
              exactJoinUrl: getGameInstanceJoinUrl(
                player.placeId,
                player.gameId,
              ),
              publicServerConfirmed: true,
              joinReady: true,
              joinabilityStatus: "Public server confirmed",
            })),
          rejected:
            groupPlayers.length -
            groupPlayers.filter((player) =>
              matches.has(String(player.gameId)),
            ).length,
          error: false,
        };
      } catch (error) {
        console.warn(
          `Public-server verification failed for place ${placeId}:`,
          error,
        );
        return {
          players: [],
          rejected: groupPlayers.length,
          error: true,
        };
      }
    },
  );

  return {
    players: checkedGroups.flatMap((group) => group.players),
    nonPublicServerCount:
      (players ?? []).length -
      checkedGroups.flatMap((group) => group.players).length,
    verificationErrorCount: checkedGroups.filter((group) => group.error).length,
  };
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

  const route = getInteractivePresenceRoute();
  if (!route) {
    return {
      players: [],
      leftGameCount: 0,
      unavailableCount: userIds.length,
      rateLimited: true,
      usedFallback: false,
    };
  }

  const check = await getPresenceBatched(userIds, {
    batchSize: FINAL_RECHECK_BATCH_SIZE,
    maxAttempts: 1,
    interBatchDelayMs: 500,
    stopOnRateLimit: true,
    presenceFetcher: route.presenceFetcher,
    fallbackFetcher: route.fallbackFetcher,
    fallbackOnRateLimit: route.fallbackOnRateLimit,
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
      const freshJoinability = buildTargetJoinability(
        presence,
        player.id,
      );
      return {
        ...player,
        presenceStatus: "In game",
        gameName: presence?.lastLocation || player.gameName,
        ...freshJoinability,
        presenceVerifiedAt: Date.now(),
      };
    });

  const publicJoinability = await filterPublicJoinablePlayers(
    confirmedPlayers,
  );
  const joinablePlayers = sortTargetPlayersForPriority(
    publicJoinability.players,
  );

  return {
    players: joinablePlayers,
    leftGameCount: players.filter((player) => {
      const id = Number(player.id);
      return checkedIds.has(id) && !inGameByUserId.has(id);
    }).length,
    unavailableCount: players.filter(
      (player) => !checkedIds.has(Number(player.id)),
    ).length,
    nonPublicServerCount: publicJoinability.nonPublicServerCount,
    publicServerVerificationErrorCount:
      publicJoinability.verificationErrorCount,
    rateLimited: check.rateLimited === true,
    usedFallback:
      (route.usingFallback && check.checkedIds.length > 0) ||
      check.usedFallback === true,
  };
}

export async function getPresenceBatched(
  userIds,
  optionsOrFetcher = getUsersPresence,
) {
  const options =
    typeof optionsOrFetcher === "function"
      ? {}
      : (optionsOrFetcher ?? {});
  const priority =
    options.priority === "background"
      ? "background"
      : "interactive";
  const batchSize = Math.max(
    1,
    Number(options.batchSize) || PRESENCE_BATCH_SIZE,
  );
  const interBatchDelayMs = Math.max(
    0,
    Number(options.interBatchDelayMs) || 0,
  );
  const stopOnRateLimit = options.stopOnRateLimit !== false;

  const normalizedIds = [
    ...new Set(
      (userIds ?? [])
        .map(Number)
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  const configuredFetcher =
    typeof optionsOrFetcher === "function"
      ? optionsOrFetcher
      : options.presenceFetcher ?? getUsersPresence;

  if (
    priority === "background" &&
    configuredFetcher === getUsersPresence &&
    Date.now() < presenceApiBackoffUntil
  ) {
    return {
      presences: [],
      checkedIds: [],
      rateLimited: true,
      usedFallback: false,
    };
  }

  if (normalizedIds.length === 0) {
    return {
      presences: [],
      checkedIds: [],
      rateLimited: false,
      usedFallback: false,
    };
  }

  const presences = [];
  const checkedIds = [];
  let rateLimited = false;
  let usedFallback = false;
  let forceFallbackForRemaining = false;

  for (
    let index = 0;
    index < normalizedIds.length;
    index += batchSize
  ) {
    const chunk = normalizedIds.slice(index, index + batchSize);
    const baseOptions =
      typeof optionsOrFetcher === "function"
        ? null
        : {
            ...options,
            batchSize: chunk.length,
            interBatchDelayMs: 0,
          };

    const canForceFallback =
      forceFallbackForRemaining &&
      typeof baseOptions?.fallbackFetcher === "function" &&
      Date.now() >= fallbackPresenceBackoffUntil;

    const chunkOptions =
      typeof optionsOrFetcher === "function"
        ? optionsOrFetcher
        : canForceFallback
          ? {
              ...baseOptions,
              presenceFetcher: baseOptions.fallbackFetcher,
              fallbackFetcher: null,
              fallbackOnRateLimit: false,
            }
          : baseOptions;

    const result = await schedulePresenceTask(
      () => getPresenceBatchedUnlocked(chunk, chunkOptions),
      priority,
    );

    presences.push(...(result.presences ?? []));
    checkedIds.push(...(result.checkedIds ?? []));
    rateLimited = rateLimited || result.rateLimited === true;
    usedFallback =
      usedFallback ||
      canForceFallback ||
      result.usedFallback === true;

    if (
      !canForceFallback &&
      result.rateLimited &&
      result.usedFallback &&
      result.checkedIds.length === chunk.length &&
      typeof baseOptions?.fallbackFetcher === "function"
    ) {
      forceFallbackForRemaining = true;
    }

    if (
      result.rateLimited &&
      stopOnRateLimit &&
      result.checkedIds.length < chunk.length
    ) {
      break;
    }

    if (
      index + batchSize < normalizedIds.length &&
      interBatchDelayMs > 0
    ) {
      await sleep(interBatchDelayMs);
    }
  }

  return {
    presences,
    checkedIds: [...new Set(checkedIds)],
    rateLimited,
    usedFallback,
  };
}

function schedulePresenceTask(task, priority = "interactive") {
  return new Promise((resolve, reject) => {
    const queue =
      priority === "background"
        ? presenceBackgroundQueue
        : presenceInteractiveQueue;

    queue.push({ task, resolve, reject });
    void pumpPresenceScheduler();
  });
}

async function pumpPresenceScheduler() {
  if (presenceSchedulerRunning) return;
  presenceSchedulerRunning = true;

  try {
    while (
      presenceInteractiveQueue.length > 0 ||
      presenceBackgroundQueue.length > 0
    ) {
      const job =
        presenceInteractiveQueue.shift() ??
        presenceBackgroundQueue.shift();

      try {
        job.resolve(await job.task());
      } catch (error) {
        job.reject(error);
      }
    }
  } finally {
    presenceSchedulerRunning = false;

    if (
      presenceInteractiveQueue.length > 0 ||
      presenceBackgroundQueue.length > 0
    ) {
      void pumpPresenceScheduler();
    }
  }
}

async function getPresenceBatchedUnlocked(
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
  const fallbackOnRateLimit = options.fallbackOnRateLimit === true;

  const presences = [];
  const checkedIds = [];
  let rateLimited = false;
  let usedFallback = false;

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
          const usingFallbackRoute =
            presenceFetcher === getUsersPresenceFallback;

          if (usingFallbackRoute) {
            fallbackPresenceBackoffUntil = Math.max(
              fallbackPresenceBackoffUntil,
              Date.now() +
                getPositiveIntegerEnv(
                  "ROBLOX_FALLBACK_PRESENCE_BACKOFF_MS",
                  DEFAULT_FALLBACK_PRESENCE_BACKOFF_MS,
                ),
            );
            console.warn(
              "Public presence fallback rate-limited; entering fallback-only backoff.",
            );
          } else {
            presenceApiBackoffUntil = Math.max(
              presenceApiBackoffUntil,
              Date.now() +
                getPositiveIntegerEnv(
                  "ROBLOX_PRESENCE_API_BACKOFF_MS",
                  DEFAULT_PRESENCE_API_BACKOFF_MS,
                ),
            );
            console.warn(
              "Roblox presence API rate-limited; entering official-route backoff.",
            );
          }

          if (
            !usingFallbackRoute &&
            fallbackOnRateLimit &&
            fallbackFetcher &&
            pending.size > 0 &&
            Date.now() >= fallbackPresenceBackoffUntil
          ) {
            try {
              const fallbackResult = await fallbackFetcher([...pending]);
              for (const presence of Array.isArray(fallbackResult)
                ? fallbackResult
                : []) {
                const userId = Number(presence?.userId);
                if (!pending.has(userId)) continue;
                resolved.set(userId, {
                  ...presence,
                  presenceSource: "RoProxy public Roblox API proxy",
                });
                pending.delete(userId);
              }
              if (resolved.size > 0) usedFallback = true;
            } catch (fallbackError) {
              if (Number(fallbackError?.status) === 429) {
                fallbackPresenceBackoffUntil = Math.max(
                  fallbackPresenceBackoffUntil,
                  Date.now() +
                    getPositiveIntegerEnv(
                      "ROBLOX_FALLBACK_PRESENCE_BACKOFF_MS",
                      DEFAULT_FALLBACK_PRESENCE_BACKOFF_MS,
                    ),
                );
              }
              console.warn(
                "Secondary public presence route failed after Roblox 429:",
                fallbackError,
              );
            }
          }
          break;
        }

        const timedOut =
          error?.name === "TimeoutError" ||
          /timeout/i.test(String(error?.message ?? ""));
        const retryable = status === 408 || status >= 500 || timedOut;

        if (timedOut) {
          rateLimited = true;
          const usingFallbackRoute =
            presenceFetcher === getUsersPresenceFallback;

          if (usingFallbackRoute) {
            fallbackPresenceBackoffUntil = Math.max(
              fallbackPresenceBackoffUntil,
              Date.now() +
                getPositiveIntegerEnv(
                  "ROBLOX_FALLBACK_TIMEOUT_BACKOFF_MS",
                  DEFAULT_FALLBACK_TIMEOUT_BACKOFF_MS,
                ),
            );
            console.warn(
              "Public presence fallback timed out; entering fallback backoff.",
            );
          } else {
            presenceApiBackoffUntil = Math.max(
              presenceApiBackoffUntil,
              Date.now() +
                getPositiveIntegerEnv(
                  "ROBLOX_PRESENCE_TIMEOUT_BACKOFF_MS",
                  DEFAULT_PRESENCE_TIMEOUT_BACKOFF_MS,
                ),
            );
            console.warn(
              "Roblox presence API timed out; entering official-route backoff.",
            );
          }
          break;
        }

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
    if (
      !rateLimited &&
      fallbackFetcher &&
      pending.size > 0 &&
      Date.now() >= fallbackPresenceBackoffUntil
    ) {
      try {
        const fallbackResult = await fallbackFetcher([...pending]);
        for (const presence of Array.isArray(fallbackResult) ? fallbackResult : []) {
          const userId = Number(presence?.userId);
          if (!pending.has(userId)) continue;
          resolved.set(userId, {
            ...presence,
            presenceSource: "RoProxy public Roblox API proxy",
          });
          usedFallback = true;
          pending.delete(userId);
        }
      } catch (error) {
        if (Number(error?.status) === 429) {
          fallbackPresenceBackoffUntil = Math.max(
            fallbackPresenceBackoffUntil,
            Date.now() +
              getPositiveIntegerEnv(
                "ROBLOX_FALLBACK_PRESENCE_BACKOFF_MS",
                DEFAULT_FALLBACK_PRESENCE_BACKOFF_MS,
              ),
          );
        }
        console.warn("Secondary public presence route failed:", error);
      }
    }

    presences.push(...resolved.values());
    checkedIds.push(...resolved.keys());

    if (rateLimited && stopOnRateLimit && pending.size > 0) {
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
    usedFallback,
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
    ps99Public: 0,
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
    ["Pet Simulator 99 official public API", "ps99Public"],
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

  const liveEntry = liveTargetCache.get(Number(candidate?.userId));
  if (liveEntry) {
    score += 1_000;
    if (getPriorityGameKey(liveEntry.presence)) {
      score += 600;
    }
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
    ["Pet Simulator 99 official public API", 170],
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

  const rankedForRemoval = [...candidatePool.values()].sort(
    (left, right) => {
      const priorityDelta =
        getCandidatePriority(
          left,
          {
            minimumValue: getMinimumTargetValue(),
            minimumRap: getMinimumTargetRap(),
          },
        ) -
        getCandidatePriority(
          right,
          {
            minimumValue: getMinimumTargetValue(),
            minimumRap: getMinimumTargetRap(),
          },
        );
      if (priorityDelta !== 0) return priorityDelta;
      return Number(left.lastSeenAt || 0) - Number(right.lastSeenAt || 0);
    },
  );

  for (
    const candidate of rankedForRemoval.slice(
      0,
      candidatePool.size - maxSize,
    )
  ) {
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

    // Known threshold-qualified /scan hits are the hot pool for /target.
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
