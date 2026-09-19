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

  // Each leaderboard row links to /player/{id} and visibly contains Value/RAP.
  // Parse the stable player ID, then read the nearby public row text so the
  // target scanner can use leaderboard RAP even if per-player info is blocked.
  const linkPattern = /href=["']\/player\/(\d+)(?:["'/?#])/gi;
  const matches = [...html.matchAll(linkPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const userId = Number(match[1]);

    if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
      continue;
    }

    const segmentStart = match.index ?? 0;
    const segmentEnd =
      index + 1 < matches.length
        ? matches[index + 1].index
        : Math.min(html.length, segmentStart + 5000);
    const rowText = stripHtml(html.slice(segmentStart, segmentEnd));

    const valueMatch = rowText.match(
      /Value\s*R\$?\s*([\d,]+)/i,
    );
    const rapMatch = rowText.match(
      /RAP\s*R\$?\s*([\d,]+)/i,
    );

    seen.add(userId);
    players.push({
      userId,
      username: null,
      totalValue: parseNumber(valueMatch?.[1]),
      totalRAP: parseNumber(rapMatch?.[1]),
    });
  }

  return players;
}

function stripHtml(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function parseNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
}
