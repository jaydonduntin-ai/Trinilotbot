import test from "node:test";
import assert from "node:assert/strict";
import { commandModules } from "../src/commands/index.js";

test("target and rbx2mm2 are registered as manual slash commands", () => {
  const names = commandModules.map((command) => command.definition.name);
  assert.deepEqual(names, ["target", "rbx2mm2"]);

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
