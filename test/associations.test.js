import test from "node:test";
import assert from "node:assert/strict";
import {
  lookupDiscordToRoblox,
  lookupRobloxToDiscord,
} from "../src/sources/associations.js";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("custom association source accepts cached get-discord result rows", async () => {
  const previous = {
    bloxlink: process.env.BLOXLINK_API_KEY,
    sourceUrl: process.env.ROBLOX_TO_DISCORD_SOURCE_URL,
    sourceName: process.env.ROBLOX_ASSOCIATION_SOURCE_NAME,
    apiKey: process.env.ROBLOX_ASSOCIATION_API_KEY,
  };
  const originalFetch = globalThis.fetch;

  delete process.env.BLOXLINK_API_KEY;
  process.env.ROBLOX_TO_DISCORD_SOURCE_URL =
    "https://assoc.test/api/v2/roblox/users/get-discord?api_key={apiKey}&username={robloxUsername}";
  process.env.ROBLOX_ASSOCIATION_SOURCE_NAME = "Association cache";
  process.env.ROBLOX_ASSOCIATION_API_KEY = "secret-test-key";

  globalThis.fetch = async (url) => {
    assert.match(String(url), /api_key=secret-test-key/);
    assert.match(String(url), /username=devclockwrks/);
    return jsonResponse({
      success: true,
      found: true,
      results: [
        {
          discord_id: "261173921657782273",
          roblox_id: 24739880,
          roblox_username: "devclockwrks",
          source: null,
          cached_at: null,
        },
        {
          discord_id: "143804501852291072",
          roblox_id: 24739880,
          roblox_username: "devclockwrks",
          source: "rover",
          cached_at: "2026-04-07T01:44:54.440000",
        },
      ],
    });
  };

  try {
    const result = await lookupRobloxToDiscord({
      userId: 24739880,
      username: "devclockwrks",
      guildId: null,
    });
    assert.deepEqual(result.association.discordIds, ["143804501852291072"]);
    assert.match(result.association.source, /RoVer/);
    assert.equal(result.association.conflict, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("BLOXLINK_API_KEY", previous.bloxlink);
    restoreEnv("ROBLOX_TO_DISCORD_SOURCE_URL", previous.sourceUrl);
    restoreEnv("ROBLOX_ASSOCIATION_SOURCE_NAME", previous.sourceName);
    restoreEnv("ROBLOX_ASSOCIATION_API_KEY", previous.apiKey);
  }
});

test("custom association source accepts cached Discord-to-Roblox result rows", async () => {
  const previous = {
    bloxlink: process.env.BLOXLINK_API_KEY,
    sourceUrl: process.env.DISCORD_TO_ROBLOX_SOURCE_URL,
    sourceName: process.env.ROBLOX_ASSOCIATION_SOURCE_NAME,
    apiKey: process.env.ROBLOX_ASSOCIATION_API_KEY,
  };
  const originalFetch = globalThis.fetch;

  delete process.env.BLOXLINK_API_KEY;
  process.env.DISCORD_TO_ROBLOX_SOURCE_URL =
    "https://assoc.test/api/v2/discord/users/get-roblox?api_key={apiKey}&discord_id={discordId}";
  process.env.ROBLOX_ASSOCIATION_SOURCE_NAME = "Association cache";
  process.env.ROBLOX_ASSOCIATION_API_KEY = "secret-test-key";

  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://verify.eryn.io/")) {
      return jsonResponse({ status: "error" });
    }
    assert.match(String(url), /discord_id=191755376696360960/);
    return jsonResponse({
      success: true,
      found: true,
      results: [
        {
          discord_id: "191755376696360960",
          roblox_id: 2207291,
          roblox_username: "Linkmon99",
          source: "bloxlink",
          cached_at: "2026-06-05T17:35:04.000000",
        },
      ],
    });
  };

  try {
    const result = await lookupDiscordToRoblox({
      query: "191755376696360960",
      guildId: null,
    });
    assert.equal(result.association.robloxId, "2207291");
    assert.equal(result.association.robloxUsername, "Linkmon99");
    assert.match(result.association.source, /Bloxlink/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("BLOXLINK_API_KEY", previous.bloxlink);
    restoreEnv("DISCORD_TO_ROBLOX_SOURCE_URL", previous.sourceUrl);
    restoreEnv("ROBLOX_ASSOCIATION_SOURCE_NAME", previous.sourceName);
    restoreEnv("ROBLOX_ASSOCIATION_API_KEY", previous.apiKey);
  }
});

test("Roblox-to-Discord lookup rejects username-only cached associations", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    bloxlink: process.env.BLOXLINK_API_KEY,
    sourceUrl: process.env.ROBLOX_TO_DISCORD_SOURCE_URL,
  };
  delete process.env.BLOXLINK_API_KEY;
  process.env.ROBLOX_TO_DISCORD_SOURCE_URL = "https://assoc.test/get-discord";
  globalThis.fetch = async () => jsonResponse({
    success: true,
    found: true,
    results: [{ discord_id: "123456789012345678", roblox_username: "example", source: "rover" }],
  });
  try {
    const result = await lookupRobloxToDiscord({ userId: 42, username: "example" });
    assert.equal(result.association, null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("BLOXLINK_API_KEY", previous.bloxlink);
    restoreEnv("ROBLOX_TO_DISCORD_SOURCE_URL", previous.sourceUrl);
  }
});
