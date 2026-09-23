const SOURCE_TIMEOUT_MS = 8_000;
const BLOXLINK_BASE_URL = "https://api.blox.link/v4";

function createProviderDiagnostics() {
  return [];
}

function recordProvider(diag, provider, status, detail = null) {
  diag.push({ provider, status, detail });
}

export async function lookupRobloxToDiscord({ userId, username, guildId = null }) {
  const results = [];
  const diagnostics = createProviderDiagnostics();

  const bloxlink = await lookupBloxlinkRobloxToDiscord({
    userId,
    guildId,
  }).then((result) => {
    recordProvider(
      diagnostics,
      "Bloxlink",
      result ? "matched" : "no-match",
    );
    return result;
  }).catch((error) => {
    console.warn("Bloxlink Roblox-to-Discord lookup failed:", error);
    recordProvider(
      diagnostics,
      "Bloxlink",
      "error",
      Number(error?.status) || error?.message || null,
    );
    return null;
  });
  if (bloxlink) results.push(bloxlink);

  const roverConfigured = false;
  const rover = await lookupRoverRobloxToDiscord({ userId }).then((result) => {
    recordProvider(
      diagnostics,
      "RoVer",
      result ? "matched" : roverConfigured ? "no-match" : "reverse-lookup-unavailable",
    );
    return result;
  }).catch((error) => {
    console.warn("RoVer Roblox-to-Discord lookup failed:", error);
    recordProvider(
      diagnostics,
      "RoVer",
      "error",
      Number(error?.status) || error?.message || null,
    );
    return null;
  });
  if (rover) results.push(rover);

  const template = process.env.ROBLOX_TO_DISCORD_SOURCE_URL;
  if (template) {
    const response = await fetchAssociationSource(template, {
      robloxId: userId,
      robloxUsername: username,
      guildId: guildId ?? "",
      apiKey: process.env.ROBLOX_ASSOCIATION_API_KEY ?? "",
    }).catch((error) => {
      console.warn("Configured Roblox-to-Discord source failed:", error);
      return null;
    });
    const normalized = response
      ? normalizeRobloxToDiscord(response, { userId, username })
      : null;
    recordProvider(
      diagnostics,
      getAssociationSourceName(),
      normalized ? "matched" : response ? "no-match" : "error",
    );
    if (normalized) results.push(normalized);
  } else {
    recordProvider(
      diagnostics,
      getAssociationSourceName(),
      "not-configured",
    );
  }

  const reconciled = reconcileAssociations(results, "discord");
  return {
    association: reconciled,
    diagnostics,
  };
}

export async function lookupDiscordToRoblox({ query, guildId = null }) {
  const results = [];
  const diagnostics = createProviderDiagnostics();
  const discordId = /^\d+$/.test(query) ? query : null;

  if (discordId) {
    const bloxlink = await lookupBloxlinkDiscordToRoblox({
      discordId,
      guildId,
    }).then((result) => {
      recordProvider(
        diagnostics,
        "Bloxlink",
        result ? "matched" : "no-match",
      );
      return result;
    }).catch((error) => {
      console.warn("Bloxlink Discord-to-Roblox lookup failed:", error);
      recordProvider(
        diagnostics,
        "Bloxlink",
        "error",
        Number(error?.status) || error?.message || null,
      );
      return null;
    });
    if (bloxlink) results.push(bloxlink);

    const roverConfigured = true;
    const rover = await lookupRoverDiscordToRoblox({ discordId }).then(
      (result) => {
        recordProvider(
          diagnostics,
          "RoVer",
          result ? "matched" : roverConfigured ? "no-match" : "not-configured",
        );
        return result;
      },
    ).catch((error) => {
      console.warn("RoVer Discord-to-Roblox lookup failed:", error);
      recordProvider(
        diagnostics,
        "RoVer",
        "error",
        Number(error?.status) || error?.message || null,
      );
      return null;
    });
    if (rover) results.push(rover);
  } else {
    recordProvider(
      diagnostics,
      "Bloxlink",
      "skipped",
      "Discord ID required for provider lookup",
    );
    recordProvider(
      diagnostics,
      "RoVer",
      "skipped",
      "Discord ID required for provider lookup",
    );
  }

  const template = process.env.DISCORD_TO_ROBLOX_SOURCE_URL;
  if (template) {
    const response = await fetchAssociationSource(template, {
      discordQuery: query,
      discordId: discordId ?? "",
      discordUsername: query,
      guildId: guildId ?? "",
      apiKey: process.env.ROBLOX_ASSOCIATION_API_KEY ?? "",
    }).catch((error) => {
      console.warn("Configured Discord-to-Roblox source failed:", error);
      return null;
    });
    const normalized = response
      ? normalizeDiscordToRoblox(response, query)
      : null;
    recordProvider(
      diagnostics,
      getAssociationSourceName(),
      normalized ? "matched" : response ? "no-match" : "error",
    );
    if (normalized) results.push(normalized);
  } else {
    recordProvider(
      diagnostics,
      getAssociationSourceName(),
      "not-configured",
    );
  }

  const reconciled = reconcileAssociations(results, "roblox");
  return {
    association: reconciled,
    diagnostics,
  };
}

async function lookupBloxlinkRobloxToDiscord({ userId, guildId }) {
  const apiKey = process.env.BLOXLINK_API_KEY?.trim();
  if (!apiKey) return null;

  const useGuild = Boolean(
    guildId && process.env.BLOXLINK_USE_GUILD_LOOKUPS === "true",
  );
  const urls = [];

  urls.push(
    `${BLOXLINK_BASE_URL}/public/roblox-to-discord/${encodeURIComponent(userId)}`,
    `${BLOXLINK_BASE_URL}/public/roblox/${encodeURIComponent(userId)}`,
  );

  if (useGuild) {
    urls.push(
      `${BLOXLINK_BASE_URL}/public/guilds/${encodeURIComponent(guildId)}/roblox-to-discord/${encodeURIComponent(userId)}`,
      `${BLOXLINK_BASE_URL}/public/guilds/${encodeURIComponent(guildId)}/roblox/${encodeURIComponent(userId)}`,
    );
  }

  for (const url of [...new Set(urls)]) {
    try {
      const payload = await fetchJson(url, { Authorization: apiKey });
      const ids = [
        ...new Set(
          [
            ...(Array.isArray(payload?.discordIDs)
              ? payload.discordIDs
              : []),
            payload?.discordID,
            payload?.discordId,
            payload?.discord?.id,
            ...(Array.isArray(payload?.discord)
              ? payload.discord.map((entry) => entry?.id ?? entry)
              : []),
          ]
            .filter(Boolean)
            .map(String),
        ),
      ];
      if (ids.length === 0) continue;

      return {
        verified: true,
        source: "Bloxlink",
        discordId: ids[0],
        discordIds: ids,
        discordUsername: toOptionalString(
          payload?.discordUsername ??
            payload?.discord?.username ??
            payload?.discord?.name,
        ),
        discordGlobalName: toOptionalString(
          payload?.discordGlobalName ?? payload?.discord?.globalName,
        ),
        evidenceUrl: null,
      };
    } catch (error) {
      const status = Number(error?.status);
      if (status === 401 || status === 403) throw error;
      if (status !== 404) {
        console.warn(
          `Bloxlink Roblox-to-Discord endpoint failed (${url}):`,
          error,
        );
      }
    }
  }

  return null;
}

async function lookupBloxlinkDiscordToRoblox({ discordId, guildId }) {
  const apiKey = process.env.BLOXLINK_API_KEY?.trim();
  if (!apiKey) return null;

  const useGuild = Boolean(
    guildId && process.env.BLOXLINK_USE_GUILD_LOOKUPS === "true",
  );
  const urls = [];

  urls.push(
    `${BLOXLINK_BASE_URL}/public/discord-to-roblox/${encodeURIComponent(discordId)}`,
    `${BLOXLINK_BASE_URL}/public/discord/${encodeURIComponent(discordId)}`,
  );

  if (useGuild) {
    urls.push(
      `${BLOXLINK_BASE_URL}/public/guilds/${encodeURIComponent(guildId)}/discord-to-roblox/${encodeURIComponent(discordId)}`,
      `${BLOXLINK_BASE_URL}/public/guilds/${encodeURIComponent(guildId)}/discord/${encodeURIComponent(discordId)}`,
    );
  }

  for (const url of [...new Set(urls)]) {
    try {
      const payload = await fetchJson(url, { Authorization: apiKey });
      const robloxId = toOptionalString(
        payload?.robloxID ??
          payload?.robloxId ??
          payload?.roblox?.id ??
          payload?.primaryAccount?.id,
      );
      const robloxUsername = toOptionalString(
        payload?.robloxUsername ??
          payload?.username ??
          payload?.roblox?.username ??
          payload?.roblox?.name ??
          payload?.primaryAccount?.username,
      );

      if (!robloxId && !robloxUsername) continue;

      return {
        verified: true,
        source: "Bloxlink",
        robloxId,
        robloxUsername,
        evidenceUrl: null,
      };
    } catch (error) {
      const status = Number(error?.status);
      if (status === 401 || status === 403) throw error;
      if (status !== 404) {
        console.warn(
          `Bloxlink Discord-to-Roblox endpoint failed (${url}):`,
          error,
        );
      }
    }
  }

  return null;
}

async function lookupRoverRobloxToDiscord({ userId }) {
  // RoVer's documented public registry lookup is Discord -> Roblox.
  // Do not fabricate a reverse endpoint when none is documented.
  return null;
}

async function lookupRoverDiscordToRoblox({ discordId }) {
  const url = `https://verify.eryn.io/api/user/${encodeURIComponent(discordId)}`;
  const payload = await fetchJson(url);

  if (String(payload?.status).toLowerCase() !== "ok") return null;

  const robloxId = toOptionalString(payload?.robloxId ?? payload?.robloxID);
  const robloxUsername = toOptionalString(payload?.robloxUsername);

  if (!robloxId && !robloxUsername) return null;

  return {
    verified: true,
    source: "RoVer registry",
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
    const error = new Error(
      `Association source returned HTTP ${response.status}.`,
    );
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Association source did not return JSON.");
  }

  return response.json();
}

function normalizeRobloxToDiscord(payload, requested) {
  const rowResult = normalizeAssociationRowsToDiscord(payload, requested);
  if (rowResult) return rowResult;

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
    discordIds: discordId ? [discordId] : [],
    discordUsername,
    discordGlobalName: toOptionalString(payload.discord.globalName),
    evidenceUrl: toOptionalString(payload.evidenceUrl),
  };
}

function normalizeDiscordToRoblox(payload, requestedQuery) {
  const rowResult = normalizeAssociationRowsToRoblox(
    payload,
    requestedQuery,
  );
  if (rowResult) return rowResult;

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

function normalizeAssociationRowsToDiscord(payload, requested) {
  if (
    payload?.success !== true ||
    payload?.found !== true ||
    !Array.isArray(payload?.results)
  ) {
    return null;
  }

  const requestedId = String(requested?.userId ?? "").trim();
  const requestedUsername = String(requested?.username ?? "")
    .trim()
    .toLowerCase();

  const rows = payload.results.filter((row) => {
    const rowRobloxId = toOptionalString(
      row?.roblox_id ?? row?.robloxId ?? row?.robloxID,
    );
    const rowUsername = toOptionalString(
      row?.roblox_username ??
        row?.robloxUsername ??
        row?.username,
    );

    if (requestedId && rowRobloxId && rowRobloxId !== requestedId) {
      return false;
    }
    if (
      requestedUsername &&
      rowUsername &&
      rowUsername.toLowerCase() !== requestedUsername
    ) {
      return false;
    }
    return Boolean(
      toOptionalString(row?.discord_id ?? row?.discordId ?? row?.discordID),
    );
  });

  const discordIds = [
    ...new Set(
      rows
        .map((row) =>
          toOptionalString(
            row?.discord_id ?? row?.discordId ?? row?.discordID,
          ),
        )
        .filter(Boolean),
    ),
  ];
  if (discordIds.length === 0) return null;

  const rowSources = [
    ...new Set(
      rows
        .map((row) => toOptionalString(row?.source))
        .filter(Boolean)
        .map(formatProviderSource),
    ),
  ];

  return {
    verified: true,
    source:
      rowSources.length > 0
        ? getAssociationSourceName() + " (" + rowSources.join(" + ") + ")"
        : getAssociationSourceName(),
    discordId: discordIds[0],
    discordIds,
    discordUsername:
      rows
        .map((row) =>
          toOptionalString(
            row?.discord_username ??
              row?.discordUsername ??
              row?.discord_name,
          ),
        )
        .find(Boolean) ?? null,
    discordGlobalName:
      rows
        .map((row) =>
          toOptionalString(
            row?.discord_global_name ?? row?.discordGlobalName,
          ),
        )
        .find(Boolean) ?? null,
    evidenceUrl: toOptionalString(payload?.evidenceUrl),
    cachedAt:
      rows
        .map((row) => toOptionalString(row?.cached_at ?? row?.cachedAt))
        .find(Boolean) ?? null,
  };
}

function normalizeAssociationRowsToRoblox(payload, requestedQuery) {
  if (
    payload?.success !== true ||
    payload?.found !== true ||
    !Array.isArray(payload?.results)
  ) {
    return null;
  }

  const requestedId = /^\d+$/.test(requestedQuery)
    ? requestedQuery
    : null;
  const requestedUsername = requestedId
    ? null
    : requestedQuery.toLowerCase();

  const rows = payload.results.filter((row) => {
    const rowDiscordId = toOptionalString(
      row?.discord_id ?? row?.discordId ?? row?.discordID,
    );
    const rowDiscordUsername = toOptionalString(
      row?.discord_username ??
        row?.discordUsername ??
        row?.discord_name,
    );

    if (requestedId) return rowDiscordId === requestedId;
    if (!rowDiscordUsername) return false;
    return rowDiscordUsername.toLowerCase() === requestedUsername;
  });

  if (rows.length === 0) return null;

  const robloxIds = [
    ...new Set(
      rows
        .map((row) =>
          toOptionalString(
            row?.roblox_id ?? row?.robloxId ?? row?.robloxID,
          ),
        )
        .filter(Boolean),
    ),
  ];
  const robloxUsernames = [
    ...new Set(
      rows
        .map((row) =>
          toOptionalString(
            row?.roblox_username ??
              row?.robloxUsername ??
              row?.username,
          ),
        )
        .filter(Boolean),
    ),
  ];
  if (robloxIds.length === 0 && robloxUsernames.length === 0) {
    return null;
  }

  const rowSources = [
    ...new Set(
      rows
        .map((row) => toOptionalString(row?.source))
        .filter(Boolean)
        .map(formatProviderSource),
    ),
  ];

  return {
    verified: true,
    source:
      rowSources.length > 0
        ? getAssociationSourceName() + " (" + rowSources.join(" + ") + ")"
        : getAssociationSourceName(),
    robloxId: robloxIds[0] ?? null,
    robloxIds,
    robloxUsername: robloxUsernames[0] ?? null,
    robloxUsernames,
    evidenceUrl: toOptionalString(payload?.evidenceUrl),
    cachedAt:
      rows
        .map((row) => toOptionalString(row?.cached_at ?? row?.cachedAt))
        .find(Boolean) ?? null,
  };
}

function formatProviderSource(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "bloxlink") return "Bloxlink";
  if (normalized === "rover") return "RoVer";
  return String(value ?? "").trim();
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
    ...new Set(
      valid.flatMap((item) =>
        item.robloxIds?.length
          ? item.robloxIds.map(String)
          : item.robloxId
            ? [String(item.robloxId)]
            : [],
      ),
    ),
  ];
  const usernames = [
    ...new Set(
      valid.flatMap((item) =>
        item.robloxUsernames?.length
          ? item.robloxUsernames
          : item.robloxUsername
            ? [item.robloxUsername]
            : [],
      ),
    ),
  ];

  return {
    verified: true,
    source: [...new Set(valid.map((item) => item.source))].join(" + "),
    robloxId: ids[0] ?? null,
    robloxIds: ids,
    robloxUsername: usernames[0] ?? null,
    robloxUsernames: usernames,
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

export async function testAssociationProviders() {
  const results = [];

  // Documented RoVer public registry behavior: a made-up Discord ID should
  // return a clean no-match response rather than crash the provider layer.
  try {
    const rover = await lookupRoverDiscordToRoblox({
      discordId: "1",
    });
    results.push({
      provider: "RoVer",
      direction: "discord-to-roblox",
      ok: rover === null || rover?.verified === true,
      outcome: rover ? "matched" : "no-match",
    });
  } catch (error) {
    results.push({
      provider: "RoVer",
      direction: "discord-to-roblox",
      ok: false,
      outcome: "error",
      detail: Number(error?.status) || error?.message || null,
    });
  }

  if (process.env.BLOXLINK_API_KEY?.trim()) {
    try {
      const blox = await lookupBloxlinkDiscordToRoblox({
        discordId: "1",
        guildId: null,
      });
      results.push({
        provider: "Bloxlink",
        direction: "discord-to-roblox",
        ok: true,
        outcome: blox ? "matched" : "no-match",
      });
    } catch (error) {
      results.push({
        provider: "Bloxlink",
        direction: "discord-to-roblox",
        ok: false,
        outcome: "error",
        detail: Number(error?.status) || error?.message || null,
      });
    }
  } else {
    results.push({
      provider: "Bloxlink",
      direction: "discord-to-roblox",
      ok: false,
      outcome: "not-configured",
    });
  }

  return results;
}

function getAssociationSourceName() {
  return (
    process.env.ROBLOX_ASSOCIATION_SOURCE_NAME ??
    "Configured public association source"
  );
}
