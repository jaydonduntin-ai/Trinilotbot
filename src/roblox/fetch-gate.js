const nativeFetch = globalThis.fetch.bind(globalThis);

const DEFAULT_MIN_SPACING_MS = 350;
const DEFAULT_429_BACKOFF_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60 * 1000;

let reservationTail = Promise.resolve();
let nextRequestAt = 0;
let globalCooldownUntil = 0;
let last429LogAt = 0;

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateManagedUrl(input) {
  try {
    const raw = typeof input === "string" || input instanceof URL
      ? input
      : input?.url;
    if (!raw) return false;

    const hostname = new URL(raw).hostname.toLowerCase();
    return (
      hostname === "roblox.com" ||
      hostname.endsWith(".roblox.com") ||
      hostname === "roproxy.com" ||
      hostname.endsWith(".roproxy.com")
    );
  } catch {
    return false;
  }
}

async function reserveRequestSlot() {
  let release;
  const previous = reservationTail;
  reservationTail = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const spacingMs = positiveIntegerEnv(
      "ROBLOX_FETCH_MIN_SPACING_MS",
      DEFAULT_MIN_SPACING_MS,
    );
    const waitUntil = Math.max(nextRequestAt, globalCooldownUntil);
    const waitMs = Math.max(0, waitUntil - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextRequestAt = Date.now() + spacingMs;
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

function registerRateLimit(response) {
  if (response?.status !== 429) return;

  const configuredFallback = positiveIntegerEnv(
    "ROBLOX_FETCH_429_BACKOFF_MS",
    DEFAULT_429_BACKOFF_MS,
  );
  const maxBackoff = positiveIntegerEnv(
    "ROBLOX_FETCH_MAX_BACKOFF_MS",
    DEFAULT_MAX_BACKOFF_MS,
  );
  const requestedBackoff = retryAfterMs(response) ?? configuredFallback;
  const backoffMs = Math.min(maxBackoff, Math.max(configuredFallback, requestedBackoff));
  globalCooldownUntil = Math.max(globalCooldownUntil, Date.now() + backoffMs);

  if (Date.now() - last429LogAt > 10_000) {
    last429LogAt = Date.now();
    console.warn(
      `Roblox request gate observed HTTP 429; pausing Roblox-bound requests for ${Math.ceil(backoffMs / 1000)}s.`,
    );
  }
}

globalThis.fetch = async function guardedFetch(input, init) {
  if (!isRateManagedUrl(input)) {
    return nativeFetch(input, init);
  }

  await reserveRequestSlot();
  const response = await nativeFetch(input, init);
  registerRateLimit(response);
  return response;
};
