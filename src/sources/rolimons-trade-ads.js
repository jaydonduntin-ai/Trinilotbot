const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 20_000;
const ENDPOINTS = [
  "https://api.rolimons.com/tradeads/v1/getrecentads",
  "https://www.rolimons.com/tradeadsapi/getrecentads",
];

let cache = {
  expiresAt: 0,
  players: [],
  sourceUrl: null,
};

export async function getRecentTradeAdPlayers({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.expiresAt > now && cache.players.length > 0) {
    return cache;
  }

  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const payload = await fetchJson(endpoint);
      const players = normalizeTradeAdPlayers(payload);
      if (players.length === 0) {
        throw new Error("Rolimon's returned no recent trade-ad players.");
      }

      cache = {
        expiresAt: now + CACHE_TTL_MS,
        players,
        sourceUrl: endpoint,
      };
      return cache;
    } catch (error) {
      lastError = error;
    }
  }

  if (cache.players.length > 0) {
    return cache;
  }

  throw lastError ?? new Error("Rolimon's recent trade ads are unavailable.");
}

function normalizeTradeAdPlayers(payload) {
  const ads =
    payload?.trade_ads ??
    payload?.tradeAds ??
    payload?.ads ??
    payload?.data ??
    [];

  if (!Array.isArray(ads)) return [];

  const players = [];
  const seen = new Set();

  for (const ad of ads) {
    const userId = Number(
      Array.isArray(ad)
        ? ad[2]
        : ad?.user_id ?? ad?.userId ?? ad?.userid ?? ad?.player_id,
    );
    const username = Array.isArray(ad)
      ? ad[3]
      : ad?.username ?? ad?.user_name ?? ad?.player_name ?? null;

    if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    players.push({
      userId,
      username: username ? String(username) : null,
    });
  }

  return players;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "trinilotbot/1.2",
      Referer: "https://www.rolimons.com/",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Rolimon's trade-ad endpoint returned HTTP ${response.status}.`,
    );
  }

  return response.json();
}
