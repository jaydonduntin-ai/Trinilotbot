import {
  getAvatarThumbnail,
  getAssetOwners,
  getFriendGroupRoles,
  getGameDetails,
  getRobloxGroupUsers,
  getRobloxUserById,
  getUserFriends,
  getUserFollowers,
  getUserFollowings,
  getUserRobloxGroups,
  getUsersPresence,
  searchRobloxGroups,
  searchRobloxUsers,
} from "../roblox/api.js";
import { getInventorySummary } from "../roblox/inventory.js";
import { getRolimonsPlayerSource } from "../sources/rolimons.js";
import { getRolimonsItems } from "../sources/rolimons-items.js";
import { getRecentTradeAdPlayers } from "../sources/rolimons-trade-ads.js";
import { getRolimonsLeaderboardPlayers } from "../sources/rolimons-leaderboard.js";
import { searchRolimonsPlayers } from "../sources/rolimons-player-search.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { scanGameValue } from "../providers/game-value-providers.js";

export const DEFAULT_TARGET_RAP = 450_000;
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
const DEFAULT_GAME_SCAN_CANDIDATES = 1_200;
const DEFAULT_MAX_ACTIVE_TO_VERIFY = 160;
const DEFAULT_POOL_MAX_SIZE = 5_000;
const DEFAULT_POOL_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_RECENT_CHECK_COOLDOWN_MS = 15 * 60 * 1000;
const TARGET_POOL_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const LIMITED_OWNER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const GROUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
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
const ROLIMONS_LEADERBOARD_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const ROLIMONS_LEADERBOARD_PAGES_PER_REFRESH = 2;
const GROUP_SEARCH_TERMS_PER_REFRESH = 3;
const GROUPS_PER_SEARCH_TERM = 2;
const GROUP_MEMBERSHIP_SEEDS_PER_REFRESH = 4;
const FRIEND_GROUP_SEEDS_PER_REFRESH = 4;
const GROUP_MEMBER_LIMIT = 50;
const GROUP_CONCURRENCY = 3;
const PRESENCE_BATCH_SIZE = 50;
const VERIFY_CONCURRENCY = 5;

const SEARCH_TERMS = [
  "a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p",
  "q","r","s","t","u","v","w","x","y","z",
  "pro","king","queen","dark","shadow","cool","game","player","star","wolf",
  "dragon","ninja","blue","red","green","gold","fire","ice","the","xx",
  "yt","tv","boy","girl","roblox","master","elite","legend","nova","sky",
  "moon","sun","cat","dog","max","ace","zero","neo","rex","leo"
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

export function startTargetCandidatePoolWarmup() {
  if (targetPoolWarmupTimer) return;

  const refresh = async () => {
    try {
      const stats = await refreshGeneralCandidatePool();
      console.info(
        `Target pool refresh: +${stats.userSearch} Roblox-search, +${stats.socialGraph} friends, +${stats.followers} followers, +${stats.followings} followings, +${stats.tradeAds} trade-ad, +${stats.rolimonsSearch} Rolimon's-search, +${stats.leaderboard} leaderboard, +${stats.limitedOwners} limited-owner, +${stats.groupSearchMembers} group-search, +${stats.groupGraphMembers} group-graph, +${stats.friendGroupMembers} friend-group users, ${candidatePool.size} pooled.`,
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
      candidateCount: 0,
      candidatePoolSize: discovery.candidatePoolSize,
      freshCandidateCount: discovery.freshCandidateCount,
      recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
      candidateSourceCounts: discovery.candidateSourceCounts,
      activeCount: 0,
      verifiedCount: 0,
      sources: discovery.sources,
      skipped: "No candidates were returned by the general discovery sources.",
    };
  }

  const presenceScan = await getPresenceBatched(discovery.userIds);
  markCandidatesChecked(presenceScan.checkedIds);

  const activePresences = shuffle(
    presenceScan.presences.filter(
      (presence) => Number(presence.userPresenceType) === 2,
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

    if (verifiedPlayers.length >= requestedLimit) break;
  }

  const stillInGamePlayers = await revalidateCurrentlyInGame(
    verifiedPlayers,
  );

  return {
    minimumRap,
    players: shuffle(stillInGamePlayers)
      .slice(0, requestedLimit)
      .map(({ qualifies, ...player }) => player),
    candidateCount: discovery.userIds.length,
    candidatePoolSize: discovery.candidatePoolSize,
    freshCandidateCount: discovery.freshCandidateCount,
    recentlyCheckedSkipped: discovery.recentlyCheckedSkipped,
    candidateSourceCounts: discovery.candidateSourceCounts,
    activeCount: activePresences.length,
    verifiedCount: stillInGamePlayers.length,
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

  const discovery = await discoverCandidateUserIds(minimumRap, {
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
        buildDiscoveredTargetPlayer(presence, minimumRap).catch((error) => {
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

async function discoverCandidateUserIds(
  minimumRap,
  { respectCooldown = true, maxCandidatesOverride = null } = {},
) {
  void minimumRap;

  const maxCandidates =
    Number.isInteger(Number(maxCandidatesOverride)) &&
    Number(maxCandidatesOverride) > 0
      ? Number(maxCandidatesOverride)
      : getPositiveIntegerEnv(
          "ROBLOX_TARGET_MAX_CANDIDATES",
          DEFAULT_MAX_CANDIDATES,
        );

  const candidateSourceCounts = await refreshGeneralCandidatePool();
  const now = Date.now();
  const selection = selectCandidatesFromPool(maxCandidates, now, {
    respectCooldown,
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
    ],
  };
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
  };
  if (Date.now() - lastGroupRefreshAt >= GROUP_REFRESH_INTERVAL_MS) {
    lastGroupRefreshAt = Date.now();
    groupSourceCounts = await refreshGroupCandidateSources();
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

  return {
    groupSearchMembers: groupSearchUserIds.length,
    groupGraphMembers: groupGraphUserIds.length,
    friendGroupMembers: friendGroupUserIds.length,
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

  return [
    ...new Set(
      results
        .flat()
        .map((player) => Number(player?.userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];
}

function nextLeaderboardPages(count) {
  const pages = [];
  for (let index = 0; index < count; index += 1) {
    pages.push(leaderboardPageCursor);
    leaderboardPageCursor =
      leaderboardPageCursor >= 200 ? 1 : leaderboardPageCursor + 1;
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
    return { qualifies: false, id: userId };
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
      lastSocialExpandedAt: 0,
      lastFollowExpandedAt: 0,
      lastGroupExpandedAt: 0,
      lastFriendGroupExpandedAt: 0,
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
  { respectCooldown = true } = {},
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
