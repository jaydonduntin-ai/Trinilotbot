import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const volumePath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;

const lockPath =
  process.env.DISCORD_GUILD_LOCK_PATH?.trim() ||
  (volumePath
    ? join(volumePath, "discord-guild-lock.json")
    : fileURLToPath(
        new URL("../../data/discord-guild-lock.json", import.meta.url),
      ));

export async function resolveAllowedGuildIds(currentGuildIds = []) {
  const configured = parseConfiguredGuildIds(
    process.env.DISCORD_ALLOWED_GUILD_IDS,
  );
  if (configured.size > 0) {
    await persistAllowedGuildIds(configured);
    return {
      guildIds: configured,
      source: "environment",
      bootstrapped: false,
    };
  }

  const stored = await loadStoredGuildIds();
  if (stored.size > 0) {
    return {
      guildIds: stored,
      source: "persistent-lock",
      bootstrapped: false,
    };
  }

  const normalizedCurrent = [
    ...new Set(
      currentGuildIds
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value)),
    ),
  ];

  if (normalizedCurrent.length === 1) {
    const guildIds = new Set(normalizedCurrent);
    await persistAllowedGuildIds(guildIds);
    return {
      guildIds,
      source: "single-current-guild",
      bootstrapped: true,
    };
  }

  return {
    guildIds: new Set(),
    source: "unresolved",
    bootstrapped: false,
  };
}

export function isGuildAllowed(guildId, allowedGuildIds) {
  if (!guildId) return false;
  return allowedGuildIds instanceof Set &&
    allowedGuildIds.has(String(guildId));
}

async function loadStoredGuildIds() {
  try {
    const contents = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(contents);
    const raw = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.guildIds)
        ? parsed.guildIds
        : [];
    return new Set(
      raw
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value)),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }
}

async function persistAllowedGuildIds(guildIds) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    guildIds: [...guildIds],
  };
  const tempPath = `${lockPath}.tmp`;

  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(tempPath, lockPath);
}

function parseConfiguredGuildIds(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^\d+$/.test(entry)),
  );
}
