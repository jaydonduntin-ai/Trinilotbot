const SOURCE_TIMEOUT_MS = 8_000;
const BLOXLINK_BASE_URL = "https://api.blox.link/v4";

export async function lookupRobloxToDiscord({ userId, username, guildId = null }) {
  const results = [];

  const bloxlink = await lookupBloxlinkRobloxToDiscord({
    userId,
    guildId,
  }).catch((error) => {
    console.warn("Bloxlink Roblox-to-Discord lookup failed:", error);
    return null;
  });
  if (bloxlink) results.push(bloxlink);

  const template = process.env.ROBLOX_TO_DISCORD_SOURCE_URL;
  if (template) {
    const response = await fetchAssociationSource(template, {
      robloxId: userId,
      robloxUsername: username,
      guildId: guildId ?? "",
    }).catch((error) => {
      console.warn("Configured Roblox-to-Discord source failed:", error);
      return null;
    });
    const normalized = response
      ? normalizeRobloxToDiscord(response, { userId, username })
      : null;
    if (normalized) results.push(normalized);
  }

  return reconcileAssociations(results, "discord");
}

export async function lookupDiscordToRoblox({ query, guildId = null }) {
  const results = [];
  const discordId = /^\d+$/.test(query) ? query : null;

  if (discordId) {
    const bloxlink = await lookupBloxlinkDiscordToRoblox({
      discordId,
      guildId,
    }).catch((error) => {
      console.warn("Bloxlink Discord-to-Roblox lookup failed:", error);
      return null;
    });
    if (bloxlink) results.push(bloxlink);
  }

  const template = process.env.DISCORD_TO_ROBLOX_SOURCE_URL;
  if (template) {
    const response = await fetchAssociationSource(template, {
      discordQuery: query,
      discordId: discordId ?? "",
      discordUsername: query,
      guildId: guildId ?? "",
    }).catch((error) => {
      console.warn("Configured Discord-to-Roblox source failed:", error);
      return null;
    });
    const normalized = response
      ? normalizeDiscordToRoblox(response, query)
      : null;
    if (normalized) results.push(normalized);
  }

  return reconcileAssociations(results, "roblox");
}

async function lookupBloxlinkRobloxToDiscord({ userId, guildId }) {
  const apiKey = process.env.BLOXLINK_API_KEY?.trim();
  if (!apiKey) return null;

  const useGuild = Boolean(guildId && process.env.BLOXLINK_USE_GUILD_LOOKUPS === "true");
  const url = useGuild
    ? `${BLOXLINK_BASE_URL}/public/guilds/${encodeURIComponent(guildId)}/roblox-to-discord/${encodeURIComponent(userId)}`
    : `${BLOXLINK_BASE_URL}/public/roblox-to-discord/${encodeURIComponent(userId)}`;

  const payload = await fetchJson(url, {
    Authorization: apiKey,
  });

  const ids = Array.isArray(payload?.discordIDs)
    ? payload.discordIDs.map(String).filter(Boolean)
    : payload?.discordID
      ? [String(payload.discordID)]
      : [];

  if (ids.length === 0) return null;

  return {
    verified: true,
    source: "Bloxlink",
    discordId: ids[0],
    discordIds: ids,
    discordUsername: null,
    discordGlobalName: null,
    evidenceUrl: null,
  };
}

async function lookupBloxlinkDiscordToRoblox({ discordId, guildId }) {
  const apiKey = process.env.BLOXLINK_API_KEY?.trim();
  if (!apiKey) return null;

  const useGuild = Boolean(guildId && process.env.BLOXLINK_USE_GUILD_LOOKUPS === "true");
  const url = useGuild
    ? `${BLOXLINK_BASE_URL}/public/guilds/${encodeURIComponent(guildId)}/discord-to-roblox/${encodeURIComponent(discordId)}`
    : `${BLOXLINK_BASE_URL}/public/discord-to-roblox/${encodeURIComponent(discordId)}`;

  const payload = await fetchJson(url, {
    Authorization: apiKey,
  });

  const robloxId = toOptionalString(
    payload?.robloxID ?? payload?.robloxId ?? payload?.roblox?.id,
  );
  const robloxUsername = toOptionalString(
    payload?.robloxUsername ??
      payload?.username ??
      payload?.roblox?.username ??
      payload?.roblox?.name,
  );

  if (!robloxId && !robloxUsername) return null;

  return {
    verified: true,
    source: "Bloxlink",
    robloxId,
    robloxUsername,
    evidenceUrl: null,
  };
}

async function fetchAssociationSource(template, parameters) {
  const url = buildSourceUrl(template, parameters);
  if (!url || new URL(url).protocol !== "https:") {
    throw new Error("Association source URL must use HTTPS.");
  }

  return fetchJson(url);
}

async function fetchJson(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Association source returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Association source did not return JSON.");
  }

  return response.json();
}

function normalizeRobloxToDiscord(payload, requested) {
  if (payload?.verified !== true || !payload.discord) {
    return null;
  }

  const roblox = payload.roblox ?? {};
  if (
    roblox.id !== undefined &&
    String(roblox.id) !== String(requested.userId)
  ) {
    return null;
  }
  if (
    roblox.username &&
    requested.username &&
    roblox.username.toLowerCase() !== requested.username.toLowerCase()
  ) {
    return null;
  }

  const discordId = toOptionalString(payload.discord.id);
  const discordUsername = toOptionalString(
    payload.discord.username ?? payload.discord.name,
  );
  if (!discordId && !discordUsername) {
    return null;
  }

  return {
    verified: true,
    source: getAssociationSourceName(),
    discordId,
    discordUsername,
    discordGlobalName: toOptionalString(payload.discord.globalName),
    evidenceUrl: toOptionalString(payload.evidenceUrl),
  };
}

function normalizeDiscordToRoblox(payload, requestedQuery) {
  if (payload?.verified !== true || !payload.roblox) {
    return null;
  }

  const discord = payload.discord ?? {};
  const requestedId = /^\d+$/.test(requestedQuery) ? requestedQuery : null;
  if (
    requestedId &&
    discord.id !== undefined &&
    String(discord.id) !== requestedId
  ) {
    return null;
  }
  if (
    !requestedId &&
    discord.username &&
    discord.username.toLowerCase() !== requestedQuery.toLowerCase()
  ) {
    return null;
  }

  const robloxId = toOptionalString(payload.roblox.id);
  const robloxUsername = toOptionalString(
    payload.roblox.username ?? payload.roblox.name,
  );
  if (!robloxId && !robloxUsername) {
    return null;
  }

  return {
    verified: true,
    source: getAssociationSourceName(),
    robloxId,
    robloxUsername,
    evidenceUrl: toOptionalString(payload.evidenceUrl),
  };
}

function reconcileAssociations(results, target) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const valid = results.filter(Boolean);
  if (valid.length === 0) return null;

  if (target === "discord") {
    const ids = [...new Set(valid.flatMap((item) =>
      item.discordIds?.length
        ? item.discordIds.map(String)
        : item.discordId
          ? [String(item.discordId)]
          : [],
    ))];

    const usernames = [
      ...new Set(valid.map((item) => item.discordUsername).filter(Boolean)),
    ];

    return {
      verified: true,
      source: [...new Set(valid.map((item) => item.source))].join(" + "),
      discordId: ids[0] ?? null,
      discordIds: ids,
      discordUsername: usernames[0] ?? null,
      discordGlobalName:
        valid.map((item) => item.discordGlobalName).find(Boolean) ?? null,
      evidenceUrl:
        valid.map((item) => item.evidenceUrl).find(Boolean) ?? null,
      corroborated: valid.length > 1,
      conflict: ids.length > 1,
    };
  }

  const ids = [
    ...new Set(valid.map((item) => item.robloxId).filter(Boolean).map(String)),
  ];
  const usernames = [
    ...new Set(valid.map((item) => item.robloxUsername).filter(Boolean)),
  ];

  return {
    verified: true,
    source: [...new Set(valid.map((item) => item.source))].join(" + "),
    robloxId: ids[0] ?? null,
    robloxUsername: usernames[0] ?? null,
    evidenceUrl:
      valid.map((item) => item.evidenceUrl).find(Boolean) ?? null,
    corroborated: valid.length > 1,
    conflict: ids.length > 1,
  };
}

function buildSourceUrl(template, parameters) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    encodeURIComponent(parameters[key] ?? ""),
  );
}

function toOptionalString(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function getAssociationSourceName() {
  return (
    process.env.ROBLOX_ASSOCIATION_SOURCE_NAME ??
    "Configured public association source"
  );
}
