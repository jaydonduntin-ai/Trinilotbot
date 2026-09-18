const JAILBREAK_VALUES_URL = "https://jbvalues.com/";

export function isJailbreakGame(gameName) {
  return gameName?.toLowerCase().includes("jailbreak") ?? false;
}

export function getJailbreakValuesLink() {
  return JAILBREAK_VALUES_URL;
}