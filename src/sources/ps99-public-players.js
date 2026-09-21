const BASE_URL = "https://ps99.biggamesapi.io";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = {
  expiresAt: 0,
  userIds: [],
  counts: {
    recentPlayers: 0,
    clanPlayers: 0,
    leaguePlayers: 0,
  },
};

export async function getPs99PublicCandidateUserIds({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.expiresAt > now && cache.userIds.length > 0) {
    return cache;
  }

  const requests = await Promise.allSettled([
    fetchJson(
      `${BASE_URL}/v1/players?page=1&pageSize=250&sort=recent&sortOrder=desc`,
    ),
    fetchJson(`${BASE_URL}/v1/clans/players`),
    fetchJson(`${BASE_URL}/v1/leagues/players`),
  ]);

  const recentPayload =
    requests[0].status === "fulfilled" ? requests[0].value : null;
  const clanPayload =
    requests[1].status === "fulfilled" ? requests[1].value : null;
  const leaguePayload =
    requests[2].status === "fulfilled" ? requests[2].value : null;

  const recentIds = normalizeIds(
    Array.isArray(recentPayload?.data) ? recentPayload.data : [],
    (entry) => entry?.robloxUserId,
  );
  const clanIds = normalizeIds(
    clanPayload?.data?.players ?? [],
    (entry) => entry?.UserID ?? entry?.userId,
  );
  const leagueIds = normalizeIds(
    leaguePayload?.data?.players ?? [],
    (entry) => entry?.UserID ?? entry?.userId,
  );

  const userIds = [...new Set([...recentIds, ...clanIds, ...leagueIds])];

  if (userIds.length === 0) {
    if (cache.userIds.length > 0) return cache;
    const errors = requests
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message)
      .filter(Boolean);
    throw new Error(
      `PS99 public API returned no candidate users${errors.length ? `: ${errors.join("; ")}` : "."}`,
    );
  }

  cache = {
    expiresAt: now + CACHE_TTL_MS,
    userIds,
    counts: {
      recentPlayers: recentIds.length,
      clanPlayers: clanIds.length,
      leaguePlayers: leagueIds.length,
    },
  };

  return cache;
}

function normalizeIds(values, selector) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(selector)
        .map(Number)
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  ];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "trinilotbot/1.2",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`PS99 public API returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (payload?.status === "error") {
    throw new Error(
      payload?.error?.message ??
        payload?.error?.code ??
        "PS99 public API returned an error.",
    );
  }
  return payload;
}
