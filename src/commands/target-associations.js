import { lookupRobloxToDiscord } from "../sources/associations.js";

const associationCache = new Map();
const POSITIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 10_000;

// One lookup per account per command invocation, including negative results.
export function createTargetAssociationQualifier({ guildId, client, lookup = lookupRobloxToDiscord }) {
  const pending = new Map();
  return async (player) => {
    const id = Number(player?.id ?? player?.userId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!pending.has(id)) {
      const cacheKey = `${guildId ?? "public"}:${id}`;
      const cached = lookup === lookupRobloxToDiscord ? associationCache.get(cacheKey) : null;
      const lookupPromise = cached && cached.expiresAt > Date.now()
        ? Promise.resolve(cached.association)
        : lookup({ userId: id, username: player.username, guildId })
          .then((result) => {
            const association = result?.association ?? null;
            if (lookup === lookupRobloxToDiscord) {
              associationCache.set(cacheKey, {
                association,
                expiresAt: Date.now() + (association ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
              });
              if (associationCache.size > MAX_CACHE_ENTRIES) {
                associationCache.delete(associationCache.keys().next().value);
              }
            }
            return association;
          });
      pending.set(id, lookupPromise
        .then(async (association) => {
          if (!association?.verified || association.conflict) return null;
          const discordId = String(association.discordId ?? association.discordIds?.[0] ?? "");
          if (!/^\d{17,20}$/.test(discordId)) return null;
          const user = await client?.users?.fetch(discordId, { force: false }).catch(() => null);
          return {
            ...association,
            discordId,
            discordUsername: user?.username ?? association.discordUsername ?? null,
            discordGlobalName: user?.globalName ?? association.discordGlobalName ?? null,
          };
        }).catch(() => null));
    }
    const association = await pending.get(id);
    return association ? { ...player, discordAssociation: association } : null;
  };
}
