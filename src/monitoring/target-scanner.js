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
  searchMarketplaceItems,
  searchRobloxGroups,
  searchRobloxUsers,
} from "../roblox/api.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import {
  enrichInventoryWithRolimons,
  getRolimonsItems,
} from "../sources/rolimons-items.js";
import { getRecentTradeAdPlayers } from "../sources/rolimons-trade-ads.js";
import { getRolimonsLeaderboardPlayers } from "../sources/rolimons-leaderboard.js";
import { searchRolimonsPlayers } from "../sources/rolimons-player-search.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";
import { getRblxValueProfile } from "../providers/rblxvalue.js";

export const DEFAULT_TARGET_RAP = 450_000;
export const DEFAULT_TARGET_VALUE = 150_000;
export const DEFAULT_MM2_VALUE = 150_000;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_TARGETS = 7;

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
const DEFAULT_GAME_SCAN_CANDIDATES = 1_200;
const DEFAULT_MAX_ACTIVE_TO_VERIFY = 160;
const DEFAULT_POOL_MAX_SIZE = 5_000;
const DEFAULT_POOL_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_RECENT_CHECK_COOLDOWN_MS = 15 * 60 * 1000;
const TARGET_POOL_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
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
const ROLIMONS_LEADERBOARD_PAGES_PER_REFRESH = 5;
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
let targetPoolWarmupTimer = null;
let searchTermCursor = 0;
let groupSearchTermCursor = 0;
let leaderboardPageCursor = 1;
let lastLimitedOwnerRefreshAt = 0;
let lastGroupRefreshAt = 0;
let lastLeaderboardRefreshAt = 0;
let lastMarketplaceRefreshAt = 0;
let candidateRefreshPromise = null;

export function startTargetCandidatePoolWarmup() {
  if (targetPoolWarmupTimer) return;

  const refresh = async () => {
    try {
      const stats = await refreshCandidatePool();
      console.info(
        `Target pool refresh: +${stats.userSearch} Roblox-search, +${stats.socialGraph} friends, +${stats.followers} followers, +${stats.followings} followings, +${stats.tradeAds} trade-ad, +${stats.rolimonsSearch} Rolimon's-search, +${stats.leaderboard} leaderboard, +${stats.limitedOwners} Rolimon's-owner, +${stats.marketplaceCreators} marketplace-creators, +${stats.marketplaceOwners} marketplace-owners, +${stats.marketplaceGroupMembers} marketplace-group-members, +${stats.groupSearchMembers} group-search, +${stats.groupGraphMembers} group-graph, +${stats.friendGroupMembers} friend-group, +${stats.primaryGroupMembers} primary-group, +${stats.groupOwners} group-owner, +${stats.groupWallPosters} wall-poster, +${stats.allyGroupMembers} ally-group, +${stats.enemyGroupMembers} enemy-group users, ${candidatePool.size} pooled.`,
      );
    } catch (error) {
      console.warn("Background target candidate refresh failed:", error);
    }
  };

  void refresh();
  targetPoolWarmupTimer = setInterval(
    refresh,
    TARGET_POOL_REFRESH_INTERVAL_MS,
  );
}

export async function scanDiscoveredTargets({
  minimumValue = getMinimumTargetValue(),
  minimumRap = null,
  limit = DEFAULT_TARGET_COUNT,
} = {}) {
  const requestedLimit = Math.min(
    MAX_TARGETS,
    Math.max(1, Number(limit) || DEFAULT_TARGET_COUNT),
  );

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
    const presenceScan = await getPresenceBatched(wave);
    markCandidatesChecked(presenceScan.checkedIds);
    presenceScannedCount += presenceScan.checkedIds.length;

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

  const stillInGamePlayers = await revalidateCurrentlyInGame(
    verifiedPlayers,
  );

  return {
    minimumValue,
    minimumRap,
    players: shuffle(stillInGamePlayers)
      .slice(0, requestedLimit)
      .map(({ qualifies, ...player }) => player),
    candidateCount: discovery.userIds.length,
    candidatePoolSize: discovery.candidatePoolSize,
    freshCandidateCount: discovery.freshCandidateCount,
    recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
    candidateSourceCounts: discovery.candidateSourceCounts,
    presenceScannedCount,
    activeCount: activeSeen.size,
    verifiedCount: stillInGamePlayers.length,
    verificationAttempts,
    valueUnavailableCount,
    belowValueCount,
    rapUnavailableCount,
    belowRapCount,
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
    const presenceScan = await getPresenceBatched(wave);
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

  const liveCheck = await getPresenceBatched(userIds);
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
      };
    });
}

export async function scanGameTargets({
  gameKey,
  minimumRap = getMinimumTargetRap(),
  limit = DEFAULT_TARGET_COUNT,
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
    minimumValue: null,
    respectCooldown: false,
    maxCandidatesOverride: getPositiveIntegerEnv(
      "ROBLOX_GAME_TARGET_MAX_CANDIDATES",
      DEFAULT_GAME_SCAN_CANDIDATES,
    ),
  });

  if (discovery.userIds.length === 0) {
    return {
      gameKey,
      gameLabel: game.label,
      universeId: game.universeId,
      minimumRap,
      players: [],
      candidateCount: 0,
      candidatePoolSize: discovery.candidatePoolSize,
      candidateSourceCounts: discovery.candidateSourceCounts,
      gameActiveCount: 0,
      verifiedCount: 0,
      sources: discovery.sources,
    };
  }

  const presenceScan = await getPresenceBatched(discovery.userIds);
  const gamePresences = shuffle(
    presenceScan.presences.filter((presence) =>
      isPresenceForGame(presence, game),
    ),
  );

  const verifiedPlayers = [];
  for (
    let index = 0;
    index < gamePresences.length;
    index += VERIFY_CONCURRENCY
  ) {
    const batch = gamePresences.slice(index, index + VERIFY_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((presence) =>
        buildDiscoveredTargetPlayer(presence, {
          minimumRap,
          minimumValue: null,
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
      }
    }

    if (verifiedPlayers.length >= requestedLimit) break;
  }

  return {
    gameKey,
    gameLabel: game.label,
    universeId: game.universeId,
    minimumRap,
    players: shuffle(verifiedPlayers)
      .slice(0, requestedLimit)
      .map(({ qualifies, ...player }) => player),
    candidateCount: discovery.userIds.length,
    candidatePoolSize: discovery.candidatePoolSize,
    candidateSourceCounts: discovery.candidateSourceCounts,
    gameActiveCount: gamePresences.length,
    verifiedCount: verifiedPlayers.length,
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

  if (candidatePool.size === 0) {
    await withTimeout(refreshCandidatePool(), 8_000, null);
  } else {
    void refreshCandidatePool();
  }

  const candidateSourceCounts = getPoolSourceCounts();
  const now = Date.now();
  const selection = selectCandidatesFromPool(maxCandidates, now, {
    respectCooldown,
    minimumValue,
    minimumRap,
  });

  return {
    userIds: selection.userIds,
    candidateSourceCounts,
    candidatePoolSize: candidatePool.size,
    freshCandidateCount: selection.freshCount,
    recentlyCheckedSkipped: selection.recentlyCheckedSkipped,
    sources: [
      "Roblox public user search",
      "Roblox public friends graph",
      "Rolimon's recent trade ads",
      "Rolimon's limited catalog + Roblox public asset owners",
      "Roblox public group search + group members",
      "Roblox public user-group graph + group members",
      "Roblox public followers",
      "Roblox public followings",
      "Roblox friends' public groups + group members",
      "Rolimon's player search",
      "Rolimon's value leaderboard",
      "Roblox Marketplace creators",
      "Roblox Marketplace collectible owners",
      "Roblox Marketplace creator-group members",
      "Roblox public primary-group members",
      "Roblox public group owners",
      "Roblox public group wall posters",
      "Roblox public allied-group members",
      "Roblox public enemy-group members",
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
      candidateRefreshPromise = null;
    });

  return candidateRefreshPromise;
}

async function refreshGeneralCandidatePool() {
  const terms = nextSearchTerms(SEARCH_TERMS_PER_REFRESH);
  const rolimonsTerms = terms.slice(0, ROLIMONS_SEARCH_TERMS_PER_REFRESH);

  const [searchResults, tradeAdsResult, rolimonsSearchResults] =
    await Promise.all([
      mapWithConcurrency(
        terms,
        SEARCH_CONCURRENCY,
        async (term) => {
          try {
            const result = await searchRobloxUsers(term, { limit: 10 });
            return result.users;
          } catch (error) {
            console.warn(`Roblox user search failed for "${term}":`, error);
            return [];
          }
        },
      ),
      getRecentTradeAdPlayers().catch((error) => {
        console.warn("Rolimon's trade-ad discovery failed:", error);
        return null;
      }),
      mapWithConcurrency(
        rolimonsTerms,
        SEARCH_CONCURRENCY,
        async (term) => {
          try {
            const result = await searchRolimonsPlayers(term);
            return result.players;
          } catch (error) {
            console.warn(
              `Rolimon's player search failed for "${term}":`,
              error,
            );
            return [];
          }
        },
      ),
    ]);

  const searchUserIds = [
    ...new Set(
      searchResults
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  const tradeAdUserIds = [
    ...new Set(
      (tradeAdsResult?.players ?? [])
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  const rolimonsSearchUserIds = [
    ...new Set(
      rolimonsSearchResults
        .flat()
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  const now = Date.now();
  addCandidatesToPool(searchUserIds, "Roblox public user search", now);
  addCandidatesToPool(
    tradeAdUserIds,
    "Rolimon's recent trade ads",
    now,
  );
  addCandidatesToPool(
    rolimonsSearchUserIds,
    "Rolimon's player search",
    now,
  );

  const socialSeeds = selectSocialExpansionSeeds(SOCIAL_SEEDS_PER_REFRESH);
  const socialResults = await mapWithConcurrency(
    socialSeeds,
    SOCIAL_CONCURRENCY,
    async (candidate) => {
      try {
        const friends = await getUserFriends(candidate.userId);
        candidate.lastSocialExpandedAt = Date.now();
        return friends;
      } catch (error) {
        candidate.lastSocialExpandedAt = Date.now();
        console.warn(
          `Roblox friend expansion failed for user ${candidate.userId}:`,
          error,
        );
        return [];
      }
    },
  );

  const socialUserIds = [
    ...new Set(
      socialResults
        .flat()
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    socialUserIds,
    "Roblox public friends graph",
    Date.now(),
  );

  const followSeeds = selectFollowExpansionSeeds(FOLLOW_SEEDS_PER_REFRESH);
  const followResults = await mapWithConcurrency(
    followSeeds,
    SOCIAL_CONCURRENCY,
    async (candidate) => {
      const [followersResult, followingsResult] = await Promise.allSettled([
        getUserFollowers(candidate.userId, { limit: 100 }),
        getUserFollowings(candidate.userId, { limit: 100 }),
      ]);

      candidate.lastFollowExpandedAt = Date.now();
      return {
        followers:
          followersResult.status === "fulfilled"
            ? followersResult.value.users
            : [],
        followings:
          followingsResult.status === "fulfilled"
            ? followingsResult.value.users
            : [],
      };
    },
  );

  const followerUserIds = [
    ...new Set(
      followResults
        .flatMap((result) => result.followers)
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  const followingUserIds = [
    ...new Set(
      followResults
        .flatMap((result) => result.followings)
        .map((user) => Number(user?.id))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];

  addCandidatesToPool(
    followerUserIds,
    "Roblox public followers",
    Date.now(),
  );
  addCandidatesToPool(
    followingUserIds,
    "Roblox public followings",
    Date.now(),
  );

  let limitedOwnerUserIds = [];
  if (
    Date.now() - lastLimitedOwnerRefreshAt >=
    LIMITED_OWNER_REFRESH_INTERVAL_MS
  ) {
    lastLimitedOwnerRefreshAt = Date.now();
    limitedOwnerUserIds = await refreshLimitedOwnerCandidates(
      tradeAdsResult?.itemIds ?? [],
    );
    addCandidatesToPool(
      limitedOwnerUserIds,
      "Rolimon's limited catalog + Roblox public asset owners",
      Date.now(),
    );
  }

  let leaderboardUserIds = [];
  if (
    Date.now() - lastLeaderboardRefreshAt >=
    ROLIMONS_LEADERBOARD_REFRESH_INTERVAL_MS
  ) {
    lastLeaderboardRefreshAt = Date.now();
    leaderboardUserIds = await refreshRolimonsLeaderboardCandidates();
    addCandidatesToPool(
      leaderboardUserIds,
      "Rolimon's value leaderboard",
      Date.now(),
    );
  }

  let groupSourceCounts = {
    groupSearchMembers: 0,
    groupGraphMembers: 0,
    friendGroupMembers: 0,
    primaryGroupMembers: 0,
    groupOwners: 0,
    groupWallPosters: 0,
    allyGroupMembers: 0,
    enemyGroupMembers: 0,
  };
  if (Date.now() - lastGroupRefreshAt >= GROUP_REFRESH_INTERVAL_MS) {
    lastGroupRefreshAt = Date.now();
    groupSourceCounts = await refreshGroupCandidateSources();
  }

  let marketplaceSourceCounts = {
    marketplaceCreators: 0,
    marketplaceOwners: 0,
    marketplaceGroupMembers: 0,
  };
  if (
    Date.now() - lastMarketplaceRefreshAt >=
    MARKETPLACE_REFRESH_INTERVAL_MS
  ) {
    lastMarketplaceRefreshAt = Date.now();
    marketplaceSourceCounts = await refreshMarketplaceCandidateSources();
  }

  pruneCandidatePool();

  return {
    userSearch: searchUserIds.length,
    socialGraph: socialUserIds.length,
    followers: followerUserIds.length,
    followings: followingUserIds.length,
    tradeAds: tradeAdUserIds.length,
    rolimonsSearch: rolimonsSearchUserIds.length,
    leaderboard: leaderboardUserIds.length,
    limitedOwners: limitedOwnerUserIds.length,
    ...groupSourceCounts,
    ...marketplaceSourceCounts,
  };
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
    ROLIMONS_LEADERBOARD_PAGES_PER_REFRESH,
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

    const highValueSeeds = shuffle(
      dataset.items.filter(
        (item) =>
          Math.max(Number(item.rap) || 0, Number(item.value) || 0) >=
          seedFloor,
      ),
    );

    const seedItems = takeUniqueItems(
      [...tradeAdSeeds, ...highValueSeeds],
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
  { minimumValue = null, minimumRap = null } = {},
) {
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

  const candidate = candidatePool.get(userId);
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
    totalValue,
    valueSource,
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

async function revalidateCurrentlyInGame(players) {
  if (!Array.isArray(players) || players.length === 0) {
    return [];
  }

  const userIds = players
    .map((player) => Number(player?.id))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  const liveCheck = await getPresenceBatched(userIds);
  const inGameByUserId = new Map(
    liveCheck.presences
      .filter((presence) => Number(presence?.userPresenceType) === 2)
      .map((presence) => [Number(presence.userId), presence]),
  );

  return players
    .filter((player) => inGameByUserId.has(Number(player.id)))
    .map((player) => {
      const presence = inGameByUserId.get(Number(player.id));
      return {
        ...player,
        presenceStatus: "In game",
        gameName: presence?.lastLocation || player.gameName,
      };
    });
}

async function getPresenceBatched(userIds) {
  const presences = [];
  const checkedIds = [];

  for (let index = 0; index < userIds.length; index += PRESENCE_BATCH_SIZE) {
    const batch = userIds.slice(index, index + PRESENCE_BATCH_SIZE);
    let success = false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await getUsersPresence(batch);
        presences.push(...result);
        checkedIds.push(...batch);
        success = true;
        break;
      } catch (error) {
        const status = Number(error?.status);
        const retryable =
          status === 429 ||
          status === 408 ||
          status >= 500;

        if (!retryable || attempt >= 3) {
          console.warn("Roblox presence batch failed:", error);
          break;
        }

        const delayMs = 400 * 2 ** attempt;
        console.warn(
          `Roblox presence batch throttled/unavailable (HTTP ${status || "?"}); retrying in ${delayMs}ms.`,
        );
        await sleep(delayMs);
      }
    }

    // Avoid bursting dozens of presence requests back-to-back.
    if (success && index + PRESENCE_BATCH_SIZE < userIds.length) {
      await sleep(120);
    }
  }

  return { presences, checkedIds };
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
    tradeAds: 0,
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
    ["Roblox public user search", "userSearch"],
    ["Roblox public friends graph", "socialGraph"],
    ["Roblox public followers", "followers"],
    ["Roblox public followings", "followings"],
    ["Rolimon's recent trade ads", "tradeAds"],
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
  } = {},
) {
  const cooldownMs = getPositiveIntegerEnv(
    "ROBLOX_TARGET_RECENT_CHECK_COOLDOWN_MS",
    DEFAULT_RECENT_CHECK_COOLDOWN_MS,
  );

  const fresh = [];
  const coolingDown = [];

  for (const candidate of candidatePool.values()) {
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

  const preferred = [...neverChecked, ...previouslyChecked];
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
