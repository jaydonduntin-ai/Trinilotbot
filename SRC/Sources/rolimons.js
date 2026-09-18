const SOURCE_TIMEOUT_MS = 10_000;
const ENDPOINTS = [
  (userId) => `https://api.rolimons.com/players/v1/playerinfo/${encodeURIComponent(userId)}`,
  (userId) => `https://www.rolimons.com/playerapi/player/${encodeURIComponent(userId)}`,
];

export async function getRolimonsPlayerSource(userId) {
  if (!isRolimonsSourceEnabled()) {
    return null;
  }

  let lastError = null;
  for (const buildUrl of ENDPOINTS) {
    const url = buildUrl(userId);
    try {
      const payload = await fetchJson(url);
      return normalizePlayerInfo(payload, url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Rolimon's player data is unavailable.");
}

function normalizePlayerInfo(payload, sourceUrl) {
  const premium = payload?.premium;
  const presenceType = payload?.presenceType ?? payload?.presence_type;
  const lastLocation = payload?.lastLocation ?? payload?.last_location;
  const lastOnline = payload?.lastOnline ?? payload?.last_online;
  const value = toNullableNumber(payload?.value);
  const rap = toNullableNumber(payload?.rap);

  return {
    source: "Rolimon's public player info",
    sourceUrl,
    avatarUrl: payload?.thumb_url_lg ?? payload?.thumbnailUrl ?? null,
    premiumStatus:
      typeof premium === "boolean"
        ? premium
          ? "Premium"
          : "Not premium"
        : "Unavailable",
    presenceStatus: getPresenceStatus(presenceType, lastLocation),
    isOnline: payload?.isOnline === true || payload?.is_online === true,
    lastGame:
      typeof lastLocation === "string" && lastLocation !== "Website" && lastLocation !== "Offline"
        ? lastLocation
        : null,
    lastOnline: normalizeEpochOrIso(lastOnline),
    totalValue: value,
    totalRAP: rap,
    roliBadges: payload?.rolibadges ?? payload?.badges ?? null,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "trinilotbot/1.1" },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Rolimon's returned HTTP ${response.status}.`);
  }

  return response.json();
}

function getPresenceStatus(presenceType, lastLocation) {
  const byType = {
    0: "Offline",
    1: "Online",
    2: "In game",
    3: "In Roblox Studio",
  }[presenceType];
  if (byType) return byType;
  if (typeof lastLocation === "string" && lastLocation) return lastLocation;
  return "Unavailable";
}

function normalizeEpochOrIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Number.isFinite(Number(value))) {
    const number = Number(value);
    const ms = number > 10_000_000_000 ? number : number * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isRolimonsSourceEnabled() {
  return process.env.ROBLOX_SOURCE_ROLIMONS_ENABLED !== "false";
}
