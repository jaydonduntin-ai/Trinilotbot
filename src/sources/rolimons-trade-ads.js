const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 20_000;
const ENDPOINTS = [
  "https://api.rolimons.com/tradeads/v1/getrecentads",
  "https://www.rolimons.com/tradeadsapi/getrecentads",
];

let cache = {
  expiresAt: 0,
  players: [],
  itemIds: [],
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
      const normalized = normalizeTradeAds(payload);
      if (normalized.players.length === 0) {
        throw new Error("Rolimon's returned no recent trade-ad players.");
      }

      cache = {
        expiresAt: now + CACHE_TTL_MS,
        ...normalized,
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

function normalizeTradeAds(payload) {
  const ads =
    payload?.trade_ads ??
    payload?.tradeAds ??
    payload?.ads ??
    payload?.data ??
    [];

  if (!Array.isArray(ads)) {
    return { players: [], itemIds: [] };
  }

  const players = [];
  const itemIds = [];
  const seenPlayers = new Set();
  const seenItems = new Set();

  for (const ad of ads) {
    const userId = Number(
      Array.isArray(ad)
        ? ad[2]
        : ad?.user_id ?? ad?.userId ?? ad?.userid ?? ad?.player_id,
    );
    const username = Array.isArray(ad)
      ? ad[3]
      : ad?.username ?? ad?.user_name ?? ad?.player_name ?? null;

    if (Number.isInteger(userId) && userId > 0 && !seenPlayers.has(userId)) {
      seenPlayers.add(userId);
      players.push({
        userId,
        username: username ? String(username) : null,
      });
    }

    const offer = Array.isArray(ad)
      ? ad[4]
      : ad?.offer ?? ad?.offering ?? ad?.offering_items;
    const request = Array.isArray(ad)
      ? ad[5]
      : ad?.request ?? ad?.requesting ?? ad?.requesting_items;

    for (const itemId of [
      ...extractItemIds(offer),
      ...extractItemIds(request),
    ]) {
      if (!seenItems.has(itemId)) {
        seenItems.add(itemId);
        itemIds.push(itemId);
      }
    }
  }

  return { players, itemIds };
}

function extractItemIds(value) {
  const raw = Array.isArray(value)
    ? value
    : value?.items ?? value?.item_ids ?? value?.itemIds ?? [];

  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => Number(item?.id ?? item?.assetId ?? item))
    .filter((itemId) => Number.isInteger(itemId) && itemId > 0);
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
