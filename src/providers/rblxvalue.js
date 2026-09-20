import { providerCache } from "./cache.js";
import { registerProvider } from "./provider-registry.js";

const RBLXVALUE_BASE_URL = "https://api.rblxvalue.com/v2";
const RBLXVALUE_SOURCE_URL = "https://rblxvalue.com";
const REQUEST_TIMEOUT_MS = 8_000;
const INVENTORY_TTL_MS = 5 * 60 * 1000;
const PROFILE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;

registerProvider({
  name: "rblxvalue-mm2-inventory",
  capabilities: ["mm2-inventory"],
  query: getRblxValueInventory,
});

export async function getRblxValueInventory({ username, userId }) {
  const apiKey = process.env.ROBLOX_RBLXVALUE_API_KEY?.trim();
  const lookup = String(username ?? userId ?? "").trim();
  if (!apiKey || !lookup) return null;

  const cacheKey = `rblxvalue:mm2:inventory:${lookup.toLowerCase()}`;
  return providerCache.getOrSet(
    cacheKey,
    async () => {
      const url = `${RBLXVALUE_BASE_URL}/inventory/${encodeURIComponent(lookup)}`;
      const payload = await fetchRblxValueJson(
        url,
        apiKey,
        "inventory",
      );
      return normalizeInventory(payload, username ?? lookup, url);
    },
    INVENTORY_TTL_MS,
  );
}

export async function getRblxValueProfile({
  username,
  userId,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  maxRetries = MAX_RETRIES,
}) {
  const apiKey = process.env.ROBLOX_RBLXVALUE_API_KEY?.trim();
  const lookup = String(username ?? userId ?? "").trim();
  if (!apiKey || !lookup) return null;

  const cacheKey =
    `rblxvalue:mm2:profile:${lookup.toLowerCase()}:` +
    `${requestTimeoutMs}:${maxRetries}`;
  return providerCache.getOrSet(
    cacheKey,
    async () => {
      const url = `${RBLXVALUE_BASE_URL}/profile/${encodeURIComponent(lookup)}`;
      try {
        const payload = await fetchRblxValueJson(
          url,
          apiKey,
          "profile",
          {
            requestTimeoutMs,
            maxRetries,
          },
        );
        return normalizeProfile(payload, username ?? lookup, url);
      } catch (error) {
        if (Number(error?.status) === 404) {
          return {
            status: "unavailable",
            game: "MM2",
            username: username ?? lookup,
            reason: "RBLXValue has no public profile for this Roblox username.",
            source: "RBLXValue API v2 profile",
            sourceUrl: getHttpsUrl(url),
            retrievedAt: new Date().toISOString(),
          };
        }
        throw error;
      }
    },
    PROFILE_TTL_MS,
  );
}

function normalizeProfile(payload, username, sourceUrl) {
  const data = payload?.profile ?? payload?.data ?? payload ?? {};
  const totalValue = toNonNegativeNumber(
    data?.total_value ??
      data?.totalValue ??
      data?.inventory_value ??
      data?.inventoryValue ??
      data?.value,
  );
  const itemCount = toNonNegativeNumber(
    data?.item_count ??
      data?.itemCount ??
      data?.inventory_count ??
      data?.inventoryCount,
  );

  if (totalValue === null) {
    return {
      status: "unavailable",
      game: "MM2",
      username,
      reason: String(
        payload?.error ??
          payload?.message ??
          "RBLXValue profile returned no MM2 inventory value.",
      ),
      source: "RBLXValue API v2",
      sourceUrl: getHttpsUrl(sourceUrl),
      retrievedAt: new Date().toISOString(),
    };
  }

  return {
    status: "verified",
    game: "MM2",
    username:
      data?.username ??
      data?.name ??
      username,
    totalValue,
    itemCount,
    currency: "value",
    source: "RBLXValue API v2 profile",
    sourceUrl: getHttpsUrl(sourceUrl),
    credit:
      typeof payload?.credit === "string"
        ? payload.credit
        : "Data from rblxvalue.com",
    retrievedAt: new Date().toISOString(),
  };
}

async function fetchRblxValueJson(
  url,
  apiKey,
  routeLabel,
  {
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
  } = {},
) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Api-Key": apiKey,
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (response.ok) {
        return response.json();
      }

      const error = new Error(
        `RBLXValue v2 ${routeLabel} returned HTTP ${response.status}.`,
      );
      error.status = response.status;

      if (response.status !== 429 || attempt >= maxRetries) {
        throw error;
      }

      const retryAfterSeconds = Number(
        response.headers.get("retry-after"),
      );
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(1_000, retryAfterSeconds * 1000)
        : 1_500 * 2 ** attempt;
      await sleep(delayMs);
      lastError = error;
    } catch (error) {
      lastError = error;
      if (Number(error?.status) !== 429 || attempt >= maxRetries) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(
    `RBLXValue v2 ${routeLabel} request failed.`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
