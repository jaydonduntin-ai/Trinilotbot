const SOURCE_TIMEOUT_MS = 8_000;

export async function lookupRobloxToDiscord({ userId, username }) {
  const template = process.env.ROBLOX_TO_DISCORD_SOURCE_URL;
  if (!template) {
    return null;
  }

  const response = await fetchAssociationSource(template, {
    robloxId: userId,
    robloxUsername: username,
  });
  return normalizeRobloxToDiscord(response, { userId, username });
}

export async function lookupDiscordToRoblox({ query }) {
  const template = process.env.DISCORD_TO_ROBLOX_SOURCE_URL;
  if (!template) {
    return null;
  }

  const response = await fetchAssociationSource(template, {
    discordQuery: query,
    discordId: /^\d+$/.test(query) ? query : "",
    discordUsername: query,
  });
  return normalizeDiscordToRoblox(response, query);
}

async function fetchAssociationSource(template, parameters) {
  const url = buildSourceUrl(template, parameters);
  if (!url || new URL(url).protocol !== "https:") {
    throw new Error("Association source URL must use HTTPS.");
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
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