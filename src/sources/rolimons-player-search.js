const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60_000;
const cache = new Map();

export async function searchRolimonsPlayers(query, { force = false } = {}) {
  const normalized = String(query ?? "").trim();
  if (!normalized) return { players: [], sourceUrl: null };

  const key = normalized.toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > now) {
    return cached;
  }

  const url =
    `https://api.rolimons.com/players/v1/playersearch?searchstring=${encodeURIComponent(normalized)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "trinilotbot/1.3",
      Referer: "https://www.rolimons.com/",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Rolimon's player search returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const rawPlayers =
    payload?.players ??
    payload?.results ??
    payload?.data ??
    [];

  const players = [];
  const seen = new Set();

  for (const entry of Array.isArray(rawPlayers) ? rawPlayers : []) {
    const userId = Number(
      Array.isArray(entry)
        ? entry[0]
        : entry?.userId ?? entry?.user_id ?? entry?.id,
    );
    const username = Array.isArray(entry)
      ? entry[1]
      : entry?.username ?? entry?.name ?? null;

    if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    players.push({
      userId,
      username: username ? String(username) : null,
    });
  }

  const result = {
    players,
    sourceUrl: url,
    expiresAt: now + CACHE_TTL_MS,
  };
  cache.set(key, result);
  return result;
}
