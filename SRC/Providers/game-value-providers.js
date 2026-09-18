import { queryProviders, registerProvider } from "./provider-registry.js";
import "./inventory-url-providers.js";
import "./rblxvalue.js";
import "./value-list-providers.js";

const PROVIDER_TIMEOUT_MS = 8_000;

registerProvider({
  name: "mm2-configured-provider",
  capabilities: ["mm2-inventory"],
  query: (input) =>
    queryConfiguredProvider("ROBLOX_MM2_PROVIDER_URL", "MM2", input),
});

registerProvider({
  name: "adopt-me-configured-provider",
  capabilities: ["adopt-me-inventory"],
  query: (input) =>
    queryConfiguredProvider("ROBLOX_ADOPT_ME_PROVIDER_URL", "Adopt Me", input),
});

export async function scanGameValue({ gameName, userId, username }) {
  const gameKey = getGameKey(gameName);
  if (!gameKey) {
    return null;
  }

  const input = { gameName, userId, username };
  const [inventoryResults, valueListResults] = await Promise.all([
    queryProviders(`${gameKey}-inventory`, input),
    queryProviders(`${gameKey}-value-list`, input),
  ]);
  const inventory = inventoryResults[0] ?? {
    status: "unavailable",
    game: getGameLabel(gameKey),
    reason: `No user inventory provider is configured for ${getGameLabel(gameKey)}.`,
  };

  return {
    ...inventory,
    valueList: valueListResults[0] ?? null,
  };
}

function getGameKey(gameName) {
  const normalized = gameName?.toLowerCase() ?? "";
  if (normalized.includes("murder mystery 2") || normalized.includes("mm2")) {
    return "mm2";
  }
  if (normalized.includes("adopt me")) {
    return "adopt-me";
  }
  if (normalized.includes("jailbreak")) {
    return "jailbreak";
  }
  if (normalized.includes("blade ball")) {
    return "blade-ball";
  }
  if (
    normalized.includes("pet simulator 99") ||
    normalized.includes("pet sim 99")
  ) {
    return "pet-simulator-99";
  }
  if (normalized.includes("steal a brainrot")) {
    return "steal-a-brainrot";
  }
  return null;
}

function getGameLabel(gameKey) {
  return {
    jailbreak: "Jailbreak",
    "adopt-me": "Adopt Me",
    "blade-ball": "Blade Ball",
    mm2: "MM2",
    "pet-simulator-99": "Pet Simulator 99",
    "steal-a-brainrot": "Steal a Brainrot",
  }[gameKey];
}

async function queryConfiguredProvider(envKey, game, input) {
  const template = process.env[envKey];
  if (!template) {
    return null;
  }

  const url = buildProviderUrl(template, input);
  if (!url || new URL(url).protocol !== "https:") {
    throw new Error(`${envKey} must be an HTTPS URL template.`);
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${game} provider returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  return normalizeProviderPayload(payload, game);
}

function normalizeProviderPayload(payload, game) {
  if (payload?.verified !== true) {
    return {
      status: "unavailable",
      game,
      reason: "Provider did not return a verified result.",
    };
  }

  const value = Number(payload.value ?? payload.totalValue ?? payload.total);
  if (!Number.isFinite(value) || value < 0) {
    return {
      status: "unavailable",
      game,
      reason: "Provider returned no numeric value.",
    };
  }

  return {
    status: "verified",
    game,
    value,
    currency: String(payload.currency ?? "value"),
    source: String(payload.source ?? `${game} provider`),
    sourceUrl: getHttpsUrl(payload.sourceUrl),
    scannedAt: new Date().toISOString(),
  };
}

function buildProviderUrl(template, input) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    encodeURIComponent(input[key] ?? ""),
  );
}

function getHttpsUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
