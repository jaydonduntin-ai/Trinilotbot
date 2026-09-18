import { getJailbreakValuesLink } from "./jailbreak.js";

const DEFAULT_RULES = [
  {
    key: "jailbreak",
    matches: ["jailbreak"],
    label: "Jailbreak",
    unit: "JB value",
    envKey: "ROBLOX_JAILBREAK_MIN_VALUE",
    defaultThreshold: 5_000_000,
    lookupUrl: getJailbreakValuesLink(),
  },
  {
    key: "adopt-me",
    matches: ["adopt me"],
    label: "Adopt Me",
    unit: "Fly Ride total value",
    envKey: "ROBLOX_ADOPT_ME_MIN_VALUE",
    defaultThreshold: null,
  },
  {
    key: "blade-ball",
    matches: ["blade ball"],
    label: "Blade Ball",
    unit: "tokens",
    envKey: "ROBLOX_BLADE_BALL_MIN_TOKENS",
    defaultThreshold: 100_000,
  },
  {
    key: "pet-simulator-99",
    matches: ["pet simulator 99", "pet sim 99"],
    label: "Pet Simulator 99",
    unit: "gems",
    envKey: "ROBLOX_PET_SIM_99_MIN_GEMS",
    defaultThreshold: 500_000_000,
  },
  {
    key: "murder-mystery-2",
    matches: ["murder mystery 2", "mm2"],
    label: "Murder Mystery 2",
    unit: "game value",
    envKey: "ROBLOX_MM2_MIN_VALUE",
    defaultThreshold: null,
  },
  {
    key: "steal-a-brainrot",
    matches: ["steal a brainrot"],
    label: "Steal a Brainrot",
    unit: "game value",
    envKey: "ROBLOX_STEAL_A_BRAINROT_MIN_VALUE",
    defaultThreshold: null,
  },
  {
    key: "obby-ball",
    matches: ["obby ball"],
    label: "Obby Ball",
    unit: "game value",
    envKey: "ROBLOX_OBBY_BALL_MIN_VALUE",
    defaultThreshold: null,
  },
];

export function getGameValueRule(gameName) {
  const normalizedName = gameName?.toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return (
    DEFAULT_RULES.find((rule) =>
      rule.matches.some((match) => normalizedName.includes(match)),
    ) ?? null
  );
}

export function getGameValueRequirement(gameName) {
  const rule = getGameValueRule(gameName);
  if (!rule) {
    return null;
  }

  const threshold = readThreshold(rule.envKey, rule.defaultThreshold);
  const thresholdText =
    threshold === null ? "configured threshold unavailable" : threshold.toLocaleString();

  return {
    ...rule,
    threshold,
    text: `${rule.label}: ${thresholdText} ${rule.unit}`,
    dataStatus:
      rule.key === "jailbreak" && rule.lookupUrl
        ? "Official game-value API unavailable; use the linked tracker."
        : "No legitimate public API configured; value is Unavailable.",
  };
}

function readThreshold(envKey, fallback) {
  const value = Number(process.env[envKey]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}