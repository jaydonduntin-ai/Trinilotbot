import test from "node:test";
import assert from "node:assert/strict";
import { commandModules } from "../src/commands/index.js";

test("only rbx2mm2 is registered as a manual slash command", () => {
  const names = commandModules.map((command) => command.definition.name);
  assert.deepEqual(names, ["rbx2mm2"]);

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

test("/rbx2mm2 supports up to 50 results", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "rbx2mm2",
  );
  const definition = command.definition.toJSON();
  const limit = definition.options.find((option) => option.name === "limit");

  assert.ok(limit);
  assert.equal(limit.max_value, 50);
  assert.match(limit.description, /default 50, max 50/i);
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
