import { providerCache } from "./cache.js";
import { registerProvider } from "./provider-registry.js";

const REQUEST_TIMEOUT_MS = 8_000;
const VALUE_LIST_TTL_MS = 15 * 60 * 1000;

registerProvider({
  name: "supreme-values-mm2-list",
  capabilities: ["mm2-value-list"],
  query: () =>
    fetchValueList({
      game: "MM2",
      source: "Supreme Values",
      url:
        process.env.ROBLOX_SUPREME_VALUES_URL ??
        "https://supremevalues.com/mm2/index",
      expectedText: "Supreme Values",
    }),
});

registerProvider({
  name: "adopt-me-trading-values-list",
  capabilities: ["adopt-me-value-list"],
  query: () =>
    fetchValueList({
      game: "Adopt Me",
      source: "Adopt Me Trading Values",
      url:
        process.env.ROBLOX_ADOPT_ME_VALUES_URL ??
        "https://adoptmetradingvalues.com/pet-value-list.php",
      expectedText: "Adopt Me",
    }),
});

async function fetchValueList({ game, source, url, expectedText }) {
  if (url === "disabled") {
    return null;
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error(`${source} URL must use HTTPS.`);
  }

  const cacheKey = `value-list:${game}:${url}`;
  return providerCache.getOrSet(
    cacheKey,
    async () => {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/json",
          "User-Agent": "RobloxDiscordBot/1.0 (+public-provider)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`${source} returned HTTP ${response.status}.`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      if (!body.includes(expectedText)) {
        throw new Error(`${source} returned an unexpected document.`);
      }

      return {
        status: "value-list",
        game,
        source,
        sourceUrl: url,
        retrievedAt: new Date().toISOString(),
        contentType,
        hasCurrentValues: /value|price/i.test(body),
      };
    },
    VALUE_LIST_TTL_MS,
  );
}
