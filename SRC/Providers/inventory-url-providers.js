import { providerCache } from "./cache.js";
import { registerProvider } from "./provider-registry.js";

const REQUEST_TIMEOUT_MS = 8_000;
const INVENTORY_TTL_MS = 5 * 60 * 1000;

const GAME_CONFIGS = [
  ["jailbreak", "Jailbreak"],
  ["adopt-me", "Adopt Me"],
  ["blade-ball", "Blade Ball"],
  ["mm2", "MM2"],
  ["pet-simulator-99", "Pet Simulator 99"],
  ["steal-a-brainrot", "Steal a Brainrot"],
];

for (const [key, game] of GAME_CONFIGS) {
  registerProvider({
    name: `configured-${key}-inventory`,
    capabilities: [`${key}-inventory`],
    query: (input) =>
      fetchConfiguredInventory({
        key,
        game,
        input,
      }),
  });
}

async function fetchConfiguredInventory({ key, game, input }) {
  const template =
    process.env[`ROBLOX_${toEnvKey(key)}_INVENTORY_URL`] ??
    (key === "mm2" ? process.env.ROBLOX_MM2_PROVIDER_URL : null);
  if (!template) {
    return null;
  }

  const url = buildUrl(template, input);
  if (!url || new URL(url).protocol !== "https:") {
    throw new Error(`ROBLOX_${toEnvKey(key)}_INVENTORY_URL must use HTTPS.`);
  }

  const cacheKey = `configured-inventory:${key}:${input.userId ?? input.username}`;
  return providerCache.getOrSet(
    cacheKey,
    async () => {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `${game} inventory provider returned HTTP ${response.status}.`,
        );
      }
      const payload = await response.json();
      return normalizeInventory(payload, game, url, input);
    },
    INVENTORY_TTL_MS,
  );
}

function normalizeInventory(payload, game, sourceUrl, input) {
  if (payload?.verified !== true) {
    return {
      status: "unavailable",
      game,
      reason: "Inventory provider did not return a verified result.",
      sourceUrl,
      retrievedAt: new Date().toISOString(),
    };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const totalValue = Number(payload.totalValue ?? payload.total ?? NaN);
  return {
    status: "verified",
    game,
    username: input.username ?? null,
    userId: input.userId ?? null,
    inventory: items,
    itemCount: items.length,
    totalValue:
      Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : null,
    currency: String(payload.currency ?? "value"),
    source: String(payload.source ?? `${game} inventory provider`),
    sourceUrl: getHttpsUrl(payload.sourceUrl) ?? sourceUrl,
    retrievedAt: new Date().toISOString(),
  };
}

function buildUrl(template, input) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    encodeURIComponent(input[key] ?? ""),
  );
}

function toEnvKey(key) {
  return key.toUpperCase().replaceAll("-", "_");
}

function getHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
