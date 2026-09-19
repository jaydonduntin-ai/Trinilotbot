const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = new Map();

export async function getRolimonsLeaderboardPlayers(page = 1, { force = false } = {}) {
  const normalizedPage = Math.max(1, Math.min(250, Number(page) || 1));
  const now = Date.now();
  const cached = cache.get(normalizedPage);

  if (!force && cached && cached.expiresAt > now) {
    return cached;
  }

  const url = `https://www.rolimons.com/leaderboard/${normalizedPage}`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "trinilotbot/1.3",
      Referer: "https://www.rolimons.com/",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Rolimon's leaderboard returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const players = parseLeaderboardPlayers(html);

  if (players.length === 0) {
    throw new Error("Rolimon's leaderboard returned no parseable players.");
  }

  const result = {
    players,
    page: normalizedPage,
    sourceUrl: url,
    expiresAt: now + CACHE_TTL_MS,
  };
  cache.set(normalizedPage, result);
  return result;
}

function parseLeaderboardPlayers(html) {
  const players = [];
  const seen = new Set();

  const linkPattern = /href=["']\/player\/(\d+)["'][^>]*>([^<]+)</gi;
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const userId = Number(match[1]);
    const username = decodeHtml(match[2]).trim();

    if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    players.push({ userId, username });
  }

  return players;
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
