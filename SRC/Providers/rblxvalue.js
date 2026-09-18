import { providerCache } from "./cache.js";
import { registerProvider } from "./provider-registry.js";

const RBLXVALUE_BASE_URL = "https://api.rblxvalue.com/v2";
const RBLXVALUE_SOURCE_URL = "https://rblxvalue.com";
const REQUEST_TIMEOUT_MS = 8_000;
const INVENTORY_TTL_MS = 5 * 60 * 1000;

registerProvider({
  name: "rblxvalue-mm2-inventory",
  capabilities: ["mm2-inventory"],
  query: getRblxValueInventory,
});

async function getRblxValueInventory({ username, userId }) {
  const apiKey = process.env.ROBLOX_RBLXVALUE_API_KEY?.trim();
  const lookup = String(userId ?? username ?? "").trim();
  if (!apiKey || !lookup) return null;

  const cacheKey = `rblxvalue:mm2:inventory:${lookup.toLowerCase()}`;
  return providerCache.getOrSet(
    cacheKey,
    async () => {
      const url = `${RBLXVALUE_BASE_URL}/inventory/${encodeURIComponent(lookup)}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json", "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`RBLXValue v2 inventory returned HTTP ${response.status}.`);
      }

      const payload = await response.json();
      return normalizeInventory(payload, username ?? lookup, url);
    },
    INVENTORY_TTL_MS,
  );
}

function normalizeInventory(payload, username, sourceUrl) {
  const rawItems = payload?.inventory ?? payload?.items ?? payload?.data?.items ?? [];
  const items = Array.isArray(rawItems)
    ? rawItems.map(normalizeItem).filter(Boolean)
    : [];

  const totalValue =
    toNonNegativeNumber(payload?.total_value ?? payload?.totalValue ?? payload?.value ?? payload?.data?.total_value) ??
    items.reduce((total, item) => total + item.totalValue, 0);

  if (items.length === 0 && (payload?.error || payload?.message)) {
    return {
      status: "unavailable",
      game: "MM2",
      reason: String(payload.error ?? payload.message),
      source: "RBLXValue v2",
      sourceUrl: RBLXVALUE_SOURCE_URL,
      retrievedAt: new Date().toISOString(),
    };
  }

  return {
    status: "verified",
    game: "MM2",
    username,
    inventory: items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    totalValue,
    currency: "value",
    source: "RBLXValue API v2",
    sourceUrl: getHttpsUrl(sourceUrl),
    credit: typeof payload?.credit === "string" ? payload.credit : "Data from rblxvalue.com",
    retrievedAt: new Date().toISOString(),
  };
}

function normalizeItem(item) {
  const name = item?.name ?? item?.item?.name;
  const quantity = toNonNegativeNumber(item?.quantity ?? item?.count) ?? 1;
  const value = toNonNegativeNumber(
    item?.value ?? item?.estimated_value ?? item?.estimatedValue ?? item?.item?.value,
  );
  if (!name || value === null) return null;

  return {
    name: String(name),
    slug: typeof (item?.slug ?? item?.item?.slug) === "string" ? (item.slug ?? item.item.slug) : null,
    quantity,
    value,
    totalValue: value * quantity,
    category: typeof (item?.category ?? item?.item?.category) === "string" ? (item.category ?? item.item.category) : null,
    type: typeof (item?.type ?? item?.item?.type) === "string" ? (item.type ?? item.item.type) : null,
    imageUrl: getHttpsUrl(item?.image_url ?? item?.imageUrl ?? item?.item?.image_url),
  };
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
