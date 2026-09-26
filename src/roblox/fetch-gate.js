const nativeFetch = globalThis.fetch.bind(globalThis);

const DEFAULT_MIN_SPACING_MS = 350;
const DEFAULT_PRESENCE_MIN_SPACING_MS = 5_000;
const DEFAULT_FALLBACK_PRESENCE_MIN_SPACING_MS = 7_000;
const DEFAULT_ROUTE_MIN_SPACING_MS = 750;
const DEFAULT_429_BACKOFF_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60 * 1000;

let reservationTail = Promise.resolve();
let nextGlobalRequestAt = 0;
const nextRouteRequestAt = new Map();
const routeCooldownUntil = new Map();
const route429Streaks = new Map();
const last429LogAt = new Map();

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRequestUrl(input) {
  try {
    const raw = typeof input === "string" || input instanceof URL
      ? input
      : input?.url;
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
}

function getManagedRoute(input) {
  const url = parseRequestUrl(input);
  if (!url) return null;

  const hostname = url.hostname.toLowerCase();
  const isRoblox =
    hostname === "roblox.com" || hostname.endsWith(".roblox.com");
  const isRoProxy =
    hostname === "roproxy.com" || hostname.endsWith(".roproxy.com");

  if (!isRoblox && !isRoProxy) return null;

  if (hostname === "presence.roblox.com") {
    return {
      key: "roblox-presence",
      spacingMs: positiveIntegerEnv(
        "ROBLOX_FETCH_PRESENCE_MIN_SPACING_MS",
        DEFAULT_PRESENCE_MIN_SPACING_MS,
      ),
    };
  }

  if (hostname === "presence.roproxy.com") {
    return {
      key: "fallback-presence",
      spacingMs: positiveIntegerEnv(
        "ROBLOX_FETCH_FALLBACK_PRESENCE_MIN_SPACING_MS",
        DEFAULT_FALLBACK_PRESENCE_MIN_SPACING_MS,
      ),
    };
  }

  const routeName = hostname
    .replace(/\.roblox\.com$/, "")
    .replace(/\.roproxy\.com$/, "")
    .replace(/[^a-z0-9-]/g, "-");
  const provider = isRoProxy ? "roproxy" : "roblox";

  return {
    key: `${provider}-${routeName || "root"}`,
    spacingMs: positiveIntegerEnv(
      "ROBLOX_FETCH_ROUTE_MIN_SPACING_MS",
      DEFAULT_ROUTE_MIN_SPACING_MS,
    ),
  };
}

async function reserveRequestSlot(route) {
  let release;
  const previous = reservationTail;
  reservationTail = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const globalSpacingMs = positiveIntegerEnv(
      "ROBLOX_FETCH_MIN_SPACING_MS",
      DEFAULT_MIN_SPACING_MS,
    );
    const routeNextAt = Number(nextRouteRequestAt.get(route.key) ?? 0);
    const cooldownUntil = Number(routeCooldownUntil.get(route.key) ?? 0);
    const waitUntil = Math.max(
      nextGlobalRequestAt,
      routeNextAt,
      cooldownUntil,
    );
    const waitMs = Math.max(0, waitUntil - Date.now());
    if (waitMs > 0) await sleep(waitMs);

    const now = Date.now();
    nextGlobalRequestAt = now + globalSpacingMs;
    nextRouteRequestAt.set(route.key, now + route.spacingMs);
  } finally {
    release();
  }
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

function registerResponse(route, response) {
  if (response?.status !== 429) {
    if (response?.ok) route429Streaks.delete(route.key);
    return;
  }

  const configuredFallback = positiveIntegerEnv(
    "ROBLOX_FETCH_429_BACKOFF_MS",
    DEFAULT_429_BACKOFF_MS,
  );
  const maxBackoff = positiveIntegerEnv(
    "ROBLOX_FETCH_MAX_BACKOFF_MS",
    DEFAULT_MAX_BACKOFF_MS,
  );
  const streak = Math.min(
    4,
    Number(route429Streaks.get(route.key) ?? 0) + 1,
  );
  route429Streaks.set(route.key, streak);

  const retryAfter = retryAfterMs(response);
  const adaptiveFallback = configuredFallback * 2 ** (streak - 1);
  const requestedBackoff = retryAfter ?? adaptiveFallback;
  const backoffMs = Math.min(
    maxBackoff,
    Math.max(configuredFallback, requestedBackoff),
  );

  routeCooldownUntil.set(
    route.key,
    Math.max(
      Number(routeCooldownUntil.get(route.key) ?? 0),
      Date.now() + backoffMs,
    ),
  );

  const lastLog = Number(last429LogAt.get(route.key) ?? 0);
  if (Date.now() - lastLog > 10_000) {
    last429LogAt.set(route.key, Date.now());
    console.warn(
      `Roblox request gate observed HTTP 429 on ${route.key}; pausing only that route for ${Math.ceil(backoffMs / 1000)}s.`,
    );
  }
}

globalThis.fetch = async function guardedFetch(input, init) {
  const route = getManagedRoute(input);
  if (!route) {
    return nativeFetch(input, init);
  }

  await reserveRequestSlot(route);
  const response = await nativeFetch(input, init);
  registerResponse(route, response);
  return response;
};
