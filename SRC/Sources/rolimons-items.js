const REQUEST_TIMEOUT_MS = 10_000;
const ITEM_TTL_MS = 5 * 60 * 1000;
const ENDPOINTS = [
  "https://api.rolimons.com/items/v2/itemdetails",
  "https://api.rolimons.com/items/v1/itemdetails",
  "https://www.rolimons.com/itemapi/itemdetails",
];

let cache = { expiresAt: 0, items: [], byId: new Map(), sourceUrl: null };

export async function getRolimonsItems({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.items.length > 0 && cache.expiresAt > now) {
    return cache;
  }

  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const payload = await fetchJson(endpoint);
      const normalized = normalizeItemPayload(payload, endpoint);
      if (normalized.items.length === 0) {
        throw new Error("Rolimon's returned no limited items.");
      }
      cache = {
        ...normalized,
        expiresAt: now + ITEM_TTL_MS,
      };
      return cache;
    } catch (error) {
      lastError = error;
    }
  }

  if (cache.items.length > 0) {
    return cache;
  }
  throw lastError ?? new Error("Rolimon's item data is unavailable.");
}

export async function findRolimonsItem(query) {
  const normalized = String(query ?? "").trim();
  if (!normalized) return null;

  const dataset = await getRolimonsItems();
  if (/^\d+$/.test(normalized)) {
    return dataset.byId.get(String(Number(normalized))) ?? null;
  }

  const lower = normalized.toLowerCase();
  return (
    dataset.items.find((item) => item.name.toLowerCase() === lower) ??
    dataset.items.find((item) => item.acronym?.toLowerCase() === lower) ??
    dataset.items.find((item) => item.name.toLowerCase().startsWith(lower)) ??
    dataset.items.find((item) => item.name.toLowerCase().includes(lower)) ??
    null
  );
}

export async function searchRolimonsItems(query, limit = 25) {
  const dataset = await getRolimonsItems();
  const lower = String(query ?? "").trim().toLowerCase();
  const ranked = dataset.items
    .map((item) => ({
      item,
      score: getMatchScore(item, lower),
    }))
    .filter(({ score }) => score < 100)
    .sort((a, b) => a.score - b.score || b.item.value - a.item.value)
    .slice(0, Math.max(1, Math.min(25, limit)))
    .map(({ item }) => item);
  return ranked;
}

export async function enrichInventoryWithRolimons(inventory) {
  if (!inventory?.items?.length) return inventory;
  const dataset = await getRolimonsItems();
  const grouped = new Map();

  for (const owned of inventory.items) {
    const key = String(owned.assetId);
    const market = dataset.byId.get(key);
    const current = grouped.get(key) ?? {
      assetId: owned.assetId,
      name: market?.name ?? owned.name ?? "Unavailable",
      recentAveragePrice:
        Number.isFinite(market?.rap) && market.rap >= 0
          ? market.rap
          : owned.recentAveragePrice,
      value: Number.isFinite(market?.value) && market.value >= 0 ? market.value : null,
      copiesOwned: 0,
      totalRAP: 0,
      totalValue: null,
      serialNumbers: [],
      itemUrl: `https://www.rolimons.com/item/${encodeURIComponent(owned.assetId)}`,
    };

    current.copiesOwned += 1;
    if (owned.serialNumber !== null && owned.serialNumber !== undefined) {
      current.serialNumbers.push(owned.serialNumber);
    }
    grouped.set(key, current);
  }

  const items = [...grouped.values()].map((item) => {
    item.totalRAP = Number(item.recentAveragePrice ?? 0) * item.copiesOwned;
    item.totalValue =
      typeof item.value === "number" ? item.value * item.copiesOwned : null;
    return item;
  });

  const valueComplete = items.every((item) => typeof item.totalValue === "number");
  return {
    ...inventory,
    source: "Roblox public inventory + Rolimon's item values",
    items,
    itemCount: items.reduce((sum, item) => sum + item.copiesOwned, 0),
    totalRAP: items.reduce((sum, item) => sum + item.totalRAP, 0),
    totalValue: valueComplete
      ? items.reduce((sum, item) => sum + item.totalValue, 0)
      : null,
    valueComplete,
    rolimonsSourceUrl: dataset.sourceUrl,
  };
}

function normalizeItemPayload(payload, sourceUrl) {
  const rawItems = payload?.items ?? payload?.item_details ?? payload?.data ?? {};
  const entries = Array.isArray(rawItems)
    ? rawItems.map((entry) => [entry?.id ?? entry?.assetId, entry])
    : Object.entries(rawItems);

  const items = [];
  for (const [rawId, raw] of entries) {
    const id = Number(rawId ?? raw?.id ?? raw?.assetId);
    if (!Number.isInteger(id) || id <= 0) continue;

    const name = Array.isArray(raw) ? raw[0] : raw?.name;
    if (!name) continue;

    const acronym = Array.isArray(raw) ? raw[1] : raw?.acronym;
    const rap = toNumber(Array.isArray(raw) ? raw[2] : raw?.rap);
    const value = toNumber(Array.isArray(raw) ? raw[3] : raw?.value);

    items.push({
      id,
      name: String(name),
      acronym: acronym ? String(acronym) : null,
      rap: rap ?? 0,
      value: value !== null && value >= 0 ? value : rap ?? 0,
      rolimonsUrl: `https://www.rolimons.com/item/${id}`,
      robloxUrl: `https://www.roblox.com/catalog/${id}`,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    items,
    byId: new Map(items.map((item) => [String(item.id), item])),
    sourceUrl,
  };
}

function getMatchScore(item, query) {
  if (!query) return 50;
  const name = item.name.toLowerCase();
  const acronym = item.acronym?.toLowerCase() ?? "";
  if (name === query || acronym === query) return 0;
  if (name.startsWith(query) || acronym.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 100;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "trinilotbot/1.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Rolimon's item endpoint returned HTTP ${response.status}.`);
  }
  return response.json();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
