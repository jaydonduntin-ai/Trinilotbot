const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_URL = "https://www.jailbreaktradingnetwork.com/trading-offers";

let cache = {
  expiresAt: 0,
  userIds: [],
  usernames: [],
  sourceUrl: DEFAULT_URL,
};

export async function getJailbreakTradeCandidates({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.expiresAt > now) return cache;

  const sourceUrl =
    process.env.JBTN_PUBLIC_FEED_URL?.trim() || DEFAULT_URL;

  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": "trinilotbot/1.4 public-trade-discovery",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Jailbreak Trading Network source returned HTTP ${response.status}.`,
    );
  }

  const text = await response.text();
  const parsed = parseCandidates(text);

  cache = {
    expiresAt: now + CACHE_TTL_MS,
    ...parsed,
    sourceUrl,
  };
  return cache;
}

function parseCandidates(text) {
  const userIds = new Set();
  const usernames = new Set();
  const raw = String(text ?? "");

  for (const match of raw.matchAll(/roblox\.com\/users\/(\d+)/gi)) {
    const id = Number(match[1]);
    if (Number.isInteger(id) && id > 0) userIds.add(id);
  }

  const idPatterns = [
    /"robloxUserId"\s*:\s*"?([0-9]+)"?/gi,
    /"roblox_user_id"\s*:\s*"?([0-9]+)"?/gi,
    /"userId"\s*:\s*"?([0-9]+)"?/gi,
  ];
  for (const pattern of idPatterns) {
    for (const match of raw.matchAll(pattern)) {
      const id = Number(match[1]);
      if (Number.isInteger(id) && id > 0) userIds.add(id);
    }
  }

  const usernamePatterns = [
    /"robloxUsername"\s*:\s*"([A-Za-z0-9_]{3,20})"/gi,
    /"roblox_username"\s*:\s*"([A-Za-z0-9_]{3,20})"/gi,
    /Roblox\s*(?:Username|User)\s*[:\-]\s*([A-Za-z0-9_]{3,20})/gi,
  ];
  for (const pattern of usernamePatterns) {
    for (const match of raw.matchAll(pattern)) {
      usernames.add(match[1]);
    }
  }

  return {
    userIds: [...userIds].slice(0, 500),
    usernames: [...usernames].slice(0, 500),
  };
}
