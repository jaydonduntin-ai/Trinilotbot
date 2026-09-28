export const ROLIMONS_DISCOVERY_SOURCES = new Set([
  "Rolimon's recent trade ads",
  "Rolimon's player search",
  "Rolimon's value leaderboard",
]);

export function hasRolimonsDiscoverySource(candidate) {
  const sources = candidate?.sources;
  const values = sources instanceof Set ? [...sources] : Array.isArray(sources) ? sources : [];
  return values.some((source) => ROLIMONS_DISCOVERY_SOURCES.has(String(source)));
}

export function hasVerifiedRolimonsRap(candidate, minimumRap = 5_000) {
  const rap = Number(candidate?.lastKnownRap);
  const floor = Number(minimumRap);
  const source = String(candidate?.lastKnownRapSource ?? "");
  return Number.isFinite(rap) && Number.isFinite(floor) && rap >= floor && source.startsWith("Rolimon's ");
}

export function qualifiesForRolimonsDiscovery(candidate, minimumRap = 5_000) {
  return hasRolimonsDiscoverySource(candidate) && hasVerifiedRolimonsRap(candidate, minimumRap);
}
