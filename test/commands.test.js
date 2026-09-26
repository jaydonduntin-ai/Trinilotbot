import test from "node:test";
import assert from "node:assert/strict";
import { commandModules } from "../src/commands/index.js";

test("manual slash commands are registered", () => {
  const names = commandModules.map((command) => command.definition.name);
  assert.deepEqual(names, ["target", "rbx2mm2", "dev", "dc2roblox"]);

  for (const command of commandModules) {
    const definition = command.definition.toJSON();
    assert.equal(definition.name, command.definition.name);
    assert.ok(definition.description);
    assert.equal(typeof command.execute, "function");
  }
});

test("/rbx2mm2 has no RAP threshold option", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "rbx2mm2",
  );
  const definition = command.definition.toJSON();
  const minRap = definition.options?.find(
    (option) => option.name === "min_rap",
  );

  assert.equal(minRap, undefined);
  assert.match(definition.description, /no RAP minimum/i);
});

test("/rbx2mm2 has no fixed result-count option", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "rbx2mm2",
  );
  const definition = command.definition.toJSON();
  const limit = definition.options?.find((option) => option.name === "limit");

  assert.equal(limit, undefined);
  assert.match(definition.description, /Murder Mystery 2/i);
});

test("/dev requires active creator evidence instead of RAP/value", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "dev",
  );
  const definition = command.definition.toJSON();
  const optionNames = (definition.options ?? []).map((option) => option.name);

  assert.deepEqual(optionNames, ["limit", "min_players"]);
  assert.match(definition.description, /active Roblox experiences/i);

  const minPlayers = definition.options?.find(
    (option) => option.name === "min_players",
  );
  assert.equal(minPlayers?.min_value, 1);
  assert.equal(minPlayers?.max_value, 1_000_000);
});

test("/dc2roblox only accepts a Discord user selection", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "dc2roblox",
  );
  const definition = command.definition.toJSON();

  assert.equal(definition.options?.length, 1);
  assert.equal(definition.options?.[0]?.name, "member");
  assert.equal(definition.options?.[0]?.required, true);
});

test("Discord command and option descriptions stay within 100 characters", () => {
  for (const command of commandModules) {
    const definition = command.definition.toJSON();
    assert.ok(
      definition.description.length <= 100,
      `/${definition.name} description exceeds Discord's 100-character limit`,
    );

    for (const option of definition.options ?? []) {
      assert.ok(
        option.description.length <= 100,
        `/${definition.name} ${option.name} description exceeds Discord's 100-character limit`,
      );
    }
  }
});

test("Discord commands are intended for guild-only use", async () => {
  const { isGuildAllowed } = await import("../src/security/guild-lock.js");
  const allowed = new Set(["123"]);
  assert.equal(isGuildAllowed("123", allowed), true);
  assert.equal(isGuildAllowed("456", allowed), false);
  assert.equal(isGuildAllowed(null, allowed), false);
});
