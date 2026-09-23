import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ASSOCIATION_API_KEY?.trim() || "";
const DATA_PATH =
  process.env.ASSOCIATION_DATA_PATH ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/associations.json`
    : "data/associations.json");
const SOURCE_NAME =
  process.env.ASSOCIATION_SOURCE_NAME?.trim() || "SE TARG Association Cache";
const ROVER_URL = "https://verify.eryn.io/api/user/";
const BLOXLINK_BASE = "https://api.blox.link/v4";

let ready = false;
let store = { rows: [] };
let saveQueue = Promise.resolve();

await loadStore();
ready = true;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/health") {
      return json(res, ready ? 200 : 503, {
        ok: ready,
        service: SOURCE_NAME,
        rows: store.rows.length,
      });
    }

    if (!authorized(req, url)) {
      return json(res, 401, { success: false, error: "unauthorized" });
    }

    if (url.pathname === "/api/v2/roblox/users/get-discord") {
      const username = normalize(url.searchParams.get("username"));
      const robloxId = normalize(url.searchParams.get("roblox_id"));
      let matches = findRobloxMatches({ username, robloxId });

      if (matches.length === 0 && robloxId) {
        const blox = await lookupBloxlinkRobloxToDiscord(robloxId).catch(() => null);
        if (blox?.length) {
          for (const row of blox) upsertRow(row);
          matches = findRobloxMatches({ username, robloxId });
        }
      }

      return json(res, 200, {
        success: true,
        found: matches.length > 0,
        results: matches,
      });
    }

    if (url.pathname === "/api/v2/discord/users/get-roblox") {
      const discordId = normalize(url.searchParams.get("discord_id"));
      const discordUsername = normalize(url.searchParams.get("discord_username"));
      let matches = findDiscordMatches({ discordId, discordUsername });

      if (matches.length === 0 && discordId) {
        const discovered = [];
        const rover = await lookupRover(discordId).catch(() => null);
        if (rover) discovered.push(rover);
        const blox = await lookupBloxlinkDiscordToRoblox(discordId).catch(() => null);
        if (blox) discovered.push(blox);
        for (const row of discovered) upsertRow(row);
        if (discovered.length) await persistStore();
        matches = findDiscordMatches({ discordId, discordUsername });
      }

      return json(res, 200, {
        success: true,
        found: matches.length > 0,
        results: matches,
      });
    }

    if (url.pathname === "/api/v2/associations" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (body?.verified !== true) {
        return json(res, 400, {
          success: false,
          error: "verified=true is required",
        });
      }
      const row = normalizeRow(body);
      if (!row || (!row.roblox_id && !row.roblox_username) || !row.discord_id) {
        return json(res, 400, {
          success: false,
          error: "discord_id and a Roblox identifier are required",
        });
      }
      upsertRow(row);
      await persistStore();
      return json(res, 200, { success: true, row });
    }

    return json(res, 404, { success: false, error: "not_found" });
  } catch (error) {
    console.error("association service request failed:", error);
    return json(res, 500, { success: false, error: "internal_error" });
  }
}).listen(PORT, "0.0.0.0", () => {
  console.info(`Association service listening on port ${PORT} with ${store.rows.length} cached rows.`);
});

function authorized(req, url) {
  if (!API_KEY) return false;
  const queryKey = url.searchParams.get("api_key")?.trim();
  const auth = req.headers.authorization?.trim();
  const headerKey = auth?.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : req.headers["x-api-key"]?.toString().trim();
  return queryKey === API_KEY || headerKey === API_KEY;
}

function normalize(value) {
  const v = String(value ?? "").trim();
  return v || null;
}

function normalizeRow(raw) {
  return {
    discord_id: normalize(raw?.discord_id ?? raw?.discordId),
    discord_username: normalize(raw?.discord_username ?? raw?.discordUsername),
    discord_global_name: normalize(raw?.discord_global_name ?? raw?.discordGlobalName),
    roblox_id: normalize(raw?.roblox_id ?? raw?.robloxId),
    roblox_username: normalize(raw?.roblox_username ?? raw?.robloxUsername),
    source: normalize(raw?.source) || "local",
    cached_at: normalize(raw?.cached_at ?? raw?.cachedAt) || new Date().toISOString(),
  };
}

function upsertRow(raw) {
  const row = normalizeRow(raw);
  const key = [row.discord_id, row.roblox_id, row.roblox_username?.toLowerCase()].join("|");
  const existingIndex = store.rows.findIndex((candidate) =>
    [candidate.discord_id, candidate.roblox_id, candidate.roblox_username?.toLowerCase()].join("|") === key
  );
  if (existingIndex >= 0) store.rows[existingIndex] = row;
  else store.rows.push(row);
  if (store.rows.length > 250000) {
    store.rows = store.rows
      .sort((a, b) => Date.parse(a.cached_at || 0) - Date.parse(b.cached_at || 0))
      .slice(-250000);
  }
  void persistStore();
  return row;
}

function findRobloxMatches({ username, robloxId }) {
  const uname = username?.toLowerCase();
  return store.rows.filter((row) =>
    (robloxId && row.roblox_id === robloxId) ||
    (uname && row.roblox_username?.toLowerCase() === uname)
  );
}

function findDiscordMatches({ discordId, discordUsername }) {
  const uname = discordUsername?.toLowerCase();
  return store.rows.filter((row) =>
    (discordId && row.discord_id === discordId) ||
    (uname && row.discord_username?.toLowerCase() === uname)
  );
}

async function lookupRover(discordId) {
  const response = await fetch(`${ROVER_URL}${encodeURIComponent(discordId)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (String(payload?.status).toLowerCase() !== "ok") return null;
  const robloxId = normalize(payload?.robloxId ?? payload?.robloxID);
  const robloxUsername = normalize(payload?.robloxUsername);
  if (!robloxId && !robloxUsername) return null;
  return normalizeRow({
    discord_id: discordId,
    roblox_id: robloxId,
    roblox_username: robloxUsername,
    source: "rover",
  });
}

async function lookupBloxlinkDiscordToRoblox(discordId) {
  const apiKey = process.env.BLOXLINK_API_KEY?.trim();
  if (!apiKey) return null;

  for (const path of [
    `/public/discord-to-roblox/${encodeURIComponent(discordId)}`,
    `/public/discord/${encodeURIComponent(discordId)}`,
  ]) {
    const response = await fetch(`${BLOXLINK_BASE}${path}`, {
      headers: { Accept: "application/json", Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) return null;
      continue;
    }
    const payload = await response.json();
    const robloxId = normalize(
      payload?.robloxID ??
      payload?.robloxId ??
      payload?.roblox?.id ??
      payload?.primaryAccount?.id
    );
    const robloxUsername = normalize(
      payload?.robloxUsername ??
      payload?.username ??
      payload?.roblox?.username ??
      payload?.roblox?.name ??
      payload?.primaryAccount?.username
    );
    if (!robloxId && !robloxUsername) continue;
    return normalizeRow({
      discord_id: discordId,
      roblox_id: robloxId,
      roblox_username: robloxUsername,
      source: "bloxlink",
    });
  }

  return null;
}

async function lookupBloxlinkRobloxToDiscord(robloxId) {
  const apiKey = process.env.BLOXLINK_API_KEY?.trim();
  if (!apiKey) return [];

  for (const path of [
    `/public/roblox-to-discord/${encodeURIComponent(robloxId)}`,
    `/public/roblox/${encodeURIComponent(robloxId)}`,
  ]) {
    const response = await fetch(`${BLOXLINK_BASE}${path}`, {
      headers: { Accept: "application/json", Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) return [];
      continue;
    }

    const payload = await response.json();
    const ids = [
      ...(Array.isArray(payload?.discordIDs) ? payload.discordIDs : []),
      payload?.discordID,
      payload?.discordId,
      payload?.discord?.id,
      ...(Array.isArray(payload?.discord)
        ? payload.discord.map((entry) => entry?.id ?? entry)
        : []),
    ].filter(Boolean).map(String);

    const unique = [...new Set(ids)];
    if (unique.length === 0) continue;
    return unique.map((discordId) =>
      normalizeRow({
        discord_id: discordId,
        roblox_id: robloxId,
        discord_username:
          payload?.discordUsername ??
          payload?.discord?.username ??
          payload?.discord?.name,
        discord_global_name:
          payload?.discordGlobalName ??
          payload?.discord?.globalName,
        source: "bloxlink",
      }),
    );
  }

  return [];
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(DATA_PATH, "utf8"));
    store.rows = Array.isArray(parsed?.rows)
      ? parsed.rows.map(normalizeRow).filter((row) => row.discord_id)
      : [];
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Association cache restore failed:", error);
    store = { rows: [] };
  }
}

async function persistStore() {
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    const temp = `${DATA_PATH}.tmp`;
    await writeFile(temp, JSON.stringify(store), "utf8");
    await rename(temp, DATA_PATH);
  });
  return saveQueue;
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request_too_large");
  }
  return body ? JSON.parse(body) : {};
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}
