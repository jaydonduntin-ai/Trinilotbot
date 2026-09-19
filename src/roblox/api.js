const ROBLOX_API_TIMEOUT_MS = 10_000;
const USERS_API_URL = "https://users.roblox.com";
const PRESENCE_API_URL = "https://presence.roblox.com";
const PRESENCE_PROXY_API_URL = "https://presence.roproxy.com";
const GAMES_API_URL = "https://games.roblox.com";
const THUMBNAILS_API_URL = "https://thumbnails.roblox.com";
const INVENTORY_API_URL = "https://inventory.roblox.com";
const FRIENDS_API_URL = "https://friends.roblox.com";
const ACCOUNT_INFORMATION_API_URL = "https://accountinformation.roblox.com";
const GROUPS_API_URL = "https://groups.roblox.com";
const CATALOG_API_URL = "https://catalog.roblox.com";

export class RobloxApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "RobloxApiError";
    this.status = status;
  }
}

async function fetchRobloxJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(ROBLOX_API_TIMEOUT_MS),
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new RobloxApiError("Roblox returned an invalid JSON response.");
    }
  }

  if (!response.ok) {
    throw new RobloxApiError(
      `Roblox API returned HTTP ${response.status}.`,
      response.status,
    );
  }

  return payload;
}

export async function lookupRobloxUsers(usernames) {
  const normalizedUsernames = [
    ...new Set(
      usernames
        .map((username) => username.trim())
        .filter((username) => username.length > 0),
    ),
  ];

  if (normalizedUsernames.length === 0) {
    return [];
  }

  const payload = await fetchRobloxJson(`${USERS_API_URL}/v1/usernames/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      usernames: normalizedUsernames,
      excludeBannedUsers: false,
    }),
  });

  return payload?.data ?? [];
}

export async function lookupRobloxUser(username) {
  const users = await lookupRobloxUsers([username]);
  return users[0] ?? null;
}

export async function searchRobloxUsers(
  keyword,
  { limit = 10, cursor = null } = {},
) {
  const normalizedKeyword = String(keyword ?? "").trim();
  if (!normalizedKeyword) return { users: [], nextPageCursor: null };

  const requestedLimit = [10, 25, 50, 100].includes(Number(limit))
    ? Number(limit)
    : 10;
  const cursorQuery = cursor
    ? `&cursor=${encodeURIComponent(cursor)}`
    : "";

  const payload = await fetchRobloxJson(
    `${USERS_API_URL}/v1/users/search?keyword=${encodeURIComponent(
      normalizedKeyword,
    )}&limit=${requestedLimit}${cursorQuery}`,
  );

  return {
    users: Array.isArray(payload?.data) ? payload.data : [],
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function searchMarketplaceItems({
  keyword = null,
  category = 2,
  subcategory = 2,
  sortType = 2,
  sortAggregation = 5,
  limit = 30,
  cursor = null,
} = {}) {
  const requestedLimit = [10, 28, 30].includes(Number(limit))
    ? Number(limit)
    : 30;

  const params = new URLSearchParams({
    Category: String(category),
    Subcategory: String(subcategory),
    SortType: String(sortType),
    SortAggregation: String(sortAggregation),
    Limit: String(requestedLimit),
  });

  if (keyword) {
    params.set("Keyword", String(keyword));
  }
  if (cursor) {
    params.set("Cursor", String(cursor));
  }

  const payload = await fetchRobloxJson(
    `${CATALOG_API_URL}/v1/search/items/details?${params.toString()}`,
  );

  return {
    items: Array.isArray(payload?.data) ? payload.data : [],
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function getRobloxGroupDetails(groupId) {
  const normalizedId = Number(groupId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return null;
  }

  return fetchRobloxJson(
    `${GROUPS_API_URL}/v1/groups/${encodeURIComponent(normalizedId)}`,
  );
}

export async function getRobloxGroupWallPosters(
  groupId,
  { limit = 50, cursor = null } = {},
) {
  const normalizedId = Number(groupId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return { users: [], nextPageCursor: null };
  }

  const requestedLimit = [10, 25, 50, 100].includes(Number(limit))
    ? Number(limit)
    : 50;
  const cursorQuery = cursor
    ? `&cursor=${encodeURIComponent(cursor)}`
    : "";

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/groups/${encodeURIComponent(
      normalizedId,
    )}/wall/posts?sortOrder=Desc&limit=${requestedLimit}${cursorQuery}`,
  );

  const rawPosts = Array.isArray(payload?.data) ? payload.data : [];
  const users = [];
  const seen = new Set();

  for (const post of rawPosts) {
    const poster =
      post?.poster ??
      post?.user ??
      post?.author ??
      post?.creator ??
      null;
    const userId = Number(
      poster?.userId ??
      poster?.id ??
      post?.posterUserId ??
      post?.userId,
    );

    if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    users.push({
      id: userId,
      name: poster?.username ?? poster?.name ?? null,
      displayName: poster?.displayName ?? null,
    });
  }

  return {
    users,
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function getRobloxGroupRelationships(
  groupId,
  relationshipType,
  { limit = 50, cursor = null } = {},
) {
  const normalizedId = Number(groupId);
  const normalizedType = String(relationshipType ?? "").trim();
  if (
    !Number.isInteger(normalizedId) ||
    normalizedId <= 0 ||
    !normalizedType
  ) {
    return { groups: [], nextPageCursor: null };
  }

  const requestedLimit = [10, 25, 50, 100].includes(Number(limit))
    ? Number(limit)
    : 50;
  const cursorQuery = cursor
    ? `&cursor=${encodeURIComponent(cursor)}`
    : "";

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/groups/${encodeURIComponent(
      normalizedId,
    )}/relationships/${encodeURIComponent(
      normalizedType,
    )}?sortOrder=Asc&limit=${requestedLimit}${cursorQuery}`,
  );

  const rawGroups =
    payload?.relatedGroups ??
    payload?.data ??
    payload?.groups ??
    [];
  const groups = [];

  for (const entry of Array.isArray(rawGroups) ? rawGroups : []) {
    const group = entry?.group ?? entry?.relatedGroup ?? entry;
    const id = Number(group?.id ?? group?.groupId);
    if (!Number.isInteger(id) || id <= 0) continue;
    groups.push({
      id,
      name: group?.name ?? null,
    });
  }

  return {
    groups,
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function searchRobloxGroups(
  keyword,
  { limit = 10, cursor = null } = {},
) {
  const normalizedKeyword = String(keyword ?? "").trim();
  if (!normalizedKeyword) {
    return { groups: [], nextPageCursor: null };
  }

  const requestedLimit = [10, 25, 50, 100].includes(Number(limit))
    ? Number(limit)
    : 10;
  const cursorQuery = cursor
    ? `&cursor=${encodeURIComponent(cursor)}`
    : "";

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/groups/search?keyword=${encodeURIComponent(
      normalizedKeyword,
    )}&limit=${requestedLimit}${cursorQuery}`,
  );

  return {
    groups: Array.isArray(payload?.data) ? payload.data : [],
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function getRobloxGroupUsers(
  groupId,
  { limit = 100, cursor = null } = {},
) {
  const normalizedId = Number(groupId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return { users: [], nextPageCursor: null };
  }

  const requestedLimit = [10, 25, 50, 100].includes(Number(limit))
    ? Number(limit)
    : 100;
  const cursorQuery = cursor
    ? `&cursor=${encodeURIComponent(cursor)}`
    : "";

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/groups/${encodeURIComponent(
      normalizedId,
    )}/users?sortOrder=Asc&limit=${requestedLimit}${cursorQuery}`,
  );

  const users = (payload?.data ?? [])
    .map((entry) => {
      const raw = entry?.user ?? entry;
      const id = Number(raw?.userId ?? raw?.id);
      if (!Number.isInteger(id) || id <= 0) return null;
      return {
        id,
        name: raw?.username ?? raw?.name ?? null,
        displayName: raw?.displayName ?? raw?.display_name ?? null,
      };
    })
    .filter(Boolean);

  return {
    users,
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function getUserPrimaryGroup(userId) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return null;
  }

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/users/${encodeURIComponent(
      normalizedId,
    )}/groups/primary/role`,
  );

  const group = payload?.group ?? payload;
  const id = Number(group?.id ?? group?.groupId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return {
    id,
    name: group?.name ?? null,
  };
}

export async function getUserRobloxGroups(userId) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return [];
  }

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/users/${encodeURIComponent(
      normalizedId,
    )}/groups/roles`,
  );

  return (payload?.data ?? [])
    .map((entry) => {
      const group = entry?.group ?? entry;
      const id = Number(group?.id ?? group?.groupId);
      if (!Number.isInteger(id) || id <= 0) return null;
      return {
        id,
        name: group?.name ?? null,
        memberCount: Number(group?.memberCount) || null,
      };
    })
    .filter(Boolean);
}

export async function getUserFollowers(
  userId,
  { limit = 100, cursor = null } = {},
) {
  return getPagedSocialUsers(userId, "followers", { limit, cursor });
}

export async function getUserFollowings(
  userId,
  { limit = 100, cursor = null } = {},
) {
  return getPagedSocialUsers(userId, "followings", { limit, cursor });
}

async function getPagedSocialUsers(
  userId,
  relation,
  { limit = 100, cursor = null } = {},
) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return { users: [], nextPageCursor: null };
  }

  const requestedLimit = [10, 25, 50, 100].includes(Number(limit))
    ? Number(limit)
    : 100;
  const cursorQuery = cursor
    ? `&cursor=${encodeURIComponent(cursor)}`
    : "";

  const payload = await fetchRobloxJson(
    `${FRIENDS_API_URL}/v1/users/${encodeURIComponent(
      normalizedId,
    )}/${relation}?sortOrder=Asc&limit=${requestedLimit}${cursorQuery}`,
  );

  return {
    users: Array.isArray(payload?.data) ? payload.data : [],
    nextPageCursor: payload?.nextPageCursor ?? null,
  };
}

export async function getFriendGroupRoles(userId) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return [];
  }

  const payload = await fetchRobloxJson(
    `${GROUPS_API_URL}/v1/users/${encodeURIComponent(
      normalizedId,
    )}/friends/groups/roles`,
  );

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const groups = [];

  for (const entry of data) {
    const candidates = [
      entry?.group,
      ...(Array.isArray(entry?.groups) ? entry.groups : []),
      ...(Array.isArray(entry?.roles) ? entry.roles : []),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const group = candidate?.group ?? candidate;
      const id = Number(group?.id ?? group?.groupId);
      if (!Number.isInteger(id) || id <= 0) continue;
      groups.push({
        id,
        name: group?.name ?? null,
      });
    }
  }

  return [
    ...new Map(groups.map((group) => [group.id, group])).values(),
  ];
}

export async function getUserFriends(userId) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return [];
  }

  const payload = await fetchRobloxJson(
    `${FRIENDS_API_URL}/v1/users/${encodeURIComponent(
      normalizedId,
    )}/friends`,
  );

  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function getRobloxUserById(userId) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return null;
  }

  return fetchRobloxJson(
    `${USERS_API_URL}/v1/users/${encodeURIComponent(normalizedId)}`,
  );
}

export async function getUsersPresence(userIds) {
  const normalizedIds = userIds
    .map((userId) => Number(userId))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  if (normalizedIds.length === 0) {
    return [];
  }

  const payload = await fetchRobloxJson(
    `${PRESENCE_API_URL}/v1/presence/users`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userIds: normalizedIds }),
    },
  );

  return payload?.userPresences ?? [];
}

export async function getUserPresence(userId) {
  const presences = await getUsersPresence([userId]);
  return presences[0] ?? null;
}

export async function getUsersPresenceFallback(userIds) {
  const normalizedIds = userIds
    .map((userId) => Number(userId))
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  if (normalizedIds.length === 0) {
    return [];
  }

  const payload = await fetchRobloxJson(
    `${PRESENCE_PROXY_API_URL}/v1/presence/users`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      body: JSON.stringify({ userIds: normalizedIds }),
    },
  );

  return payload?.userPresences ?? [];
}

export async function getGameDetails(universeId) {
  if (!universeId) {
    return null;
  }

  const payload = await fetchRobloxJson(
    `${GAMES_API_URL}/v1/games?universeIds=${encodeURIComponent(universeId)}`,
  );
  return payload?.data?.[0] ?? null;
}

export async function isPublicGameInstance(placeId, gameId) {
  if (!placeId || !gameId) {
    return false;
  }

  const payload = await fetchRobloxJson(
    `${GAMES_API_URL}/v1/games/${encodeURIComponent(
      placeId,
    )}/servers/Public?sortOrder=Asc&limit=100`,
  );

  return (
    Array.isArray(payload?.data) &&
    payload.data.some((server) => server.id === gameId)
  );
}

export async function getAvatarThumbnail(userId) {
  const payload = await fetchRobloxJson(
    `${THUMBNAILS_API_URL}/v1/users/avatar-headshot?userIds=${encodeURIComponent(
      userId,
    )}&size=420x420&format=Png&isCircular=false`,
  );

  return payload?.data?.[0]?.imageUrl ?? null;
}

export async function getUserSocialCounts(userId) {
  const encoded = encodeURIComponent(userId);
  const requests = await Promise.allSettled([
    fetchRobloxJson(`${FRIENDS_API_URL}/v1/users/${encoded}/friends/count`),
    fetchRobloxJson(`${FRIENDS_API_URL}/v1/users/${encoded}/followers/count`),
    fetchRobloxJson(`${FRIENDS_API_URL}/v1/users/${encoded}/followings/count`),
  ]);

  const countFrom = (result) =>
    result.status === "fulfilled" && Number.isFinite(Number(result.value?.count))
      ? Number(result.value.count)
      : null;

  return {
    friends: countFrom(requests[0]),
    followers: countFrom(requests[1]),
    following: countFrom(requests[2]),
  };
}

export async function getRobloxBadges(userId) {
  const payload = await fetchRobloxJson(
    `${ACCOUNT_INFORMATION_API_URL}/v1/users/${encodeURIComponent(userId)}/roblox-badges`,
  );
  return Array.isArray(payload) ? payload : payload?.data ?? [];
}

async function fetchAssetOwnersPage(url) {
  // Owner discovery intentionally uses only Roblox's public endpoint.
  return fetchRobloxJson(url);
}

export async function getAssetOwners(assetId, { limit = 10 } = {}) {
  const requestedLimit = Math.max(1, Math.min(100, Number(limit) || 10));
  const owners = [];
  let cursor = null;

  while (owners.length < requestedLimit) {
    // Roblox's paged inventory endpoints use fixed page sizes. Fetch a valid
    // page size and slice locally so /limitedowners can accept any 1-25 limit.
    const pageSize = requestedLimit <= 10 ? 10 : 25;
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const ownersUrl =
      `${INVENTORY_API_URL}/v2/assets/${encodeURIComponent(assetId)}/owners?sortOrder=Asc&limit=${pageSize}${cursorQuery}`;
    const payload = await fetchAssetOwnersPage(ownersUrl);

    for (const entry of payload?.data ?? []) {
      const userId = Number(entry?.owner?.id ?? entry?.ownerId ?? entry?.userId);
      if (!Number.isInteger(userId) || userId <= 0) continue;
      owners.push({
        userId,
        userAssetId: entry?.id ?? entry?.userAssetId ?? null,
        serialNumber: entry?.serialNumber ?? null,
        created: entry?.created ?? null,
        updated: entry?.updated ?? null,
      });
      if (owners.length >= requestedLimit) break;
    }

    cursor = payload?.nextPageCursor ?? null;
    if (!cursor) break;
  }

  return { owners, hasMore: Boolean(cursor) };
}

export async function getLimitedInventory(userId, { maxPages = 5 } = {}) {
  const items = [];
  let cursor = null;
  let pagesFetched = 0;

  do {
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const payload = await fetchRobloxJson(
      `${INVENTORY_API_URL}/v1/users/${encodeURIComponent(
        userId,
      )}/assets/collectibles?limit=100&sortOrder=Desc${cursorQuery}`,
    );

    for (const item of payload?.data ?? []) {
      if (
        Number.isInteger(item.assetId) &&
        Number.isInteger(item.recentAveragePrice)
      ) {
        items.push({
          assetId: item.assetId,
          name: item.name ?? "Unavailable",
          recentAveragePrice: item.recentAveragePrice,
          userAssetId: item.userAssetId ?? null,
          serialNumber: item.serialNumber ?? null,
        });
      }
    }

    cursor = payload?.nextPageCursor ?? null;
    pagesFetched += 1;
  } while (cursor && pagesFetched < maxPages);

  return {
    items,
    pagesFetched,
    hasMore: Boolean(cursor),
  };
}
