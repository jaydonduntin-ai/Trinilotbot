import test from "node:test";
import assert from "node:assert/strict";
import { commandModules } from "../src/commands/index.js";

test("all slash commands are registered", () => {
  const names = commandModules.map((command) => command.definition.name);
  assert.deepEqual(names, [
    "ping",
    "roblox",
    "limitedowners",
    "rbx2dc",
    "rbx2mm2",
    "dc2rb",
    "alerts",
    "dev",
    "target",
  ]);

  for (const command of commandModules) {
    const definition = command.definition.toJSON();
    assert.equal(definition.name, command.definition.name);
    assert.ok(definition.description);
    assert.equal(typeof command.execute, "function");
  }
});

test("/ping keeps its existing response", async () => {
  const ping = commandModules.find(
    (command) => command.definition.name === "ping",
  );
  let response;
  await ping.execute({
    reply(value) {
      response = value;
    },
  });
  assert.equal(response, "Pong!");
});


test("/rbx2mm2 is RAP-only with a 100K minimum and 50-result output cap", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "rbx2mm2",
  );
  const definition = command.definition.toJSON();
  const minRap = definition.options.find(
    (option) => option.name === "min_rap",
  );

  const limit = definition.options.find(
    (option) => option.name === "limit",
  );

  assert.equal(minRap.min_value, 100000);
  assert.match(definition.description, /100K\+ RAP/i);
  assert.equal(limit.max_value, 50);
  assert.match(limit.description, /default 50, max 50/i);
});


test("/target is RAP-only while /dev retains RAP/value floors", () => {
  const target = commandModules.find(
    (candidate) => candidate.definition.name === "target",
  );
  const targetDefinition = target.definition.toJSON();
  const targetMinRap = targetDefinition.options.find(
    (option) => option.name === "min_rap",
  );
  const targetMinValue = targetDefinition.options.find(
    (option) => option.name === "min_value",
  );

  assert.ok(targetMinRap, "/target should expose min_rap");
  assert.equal(targetMinRap.min_value, 150000);
  assert.equal(targetMinValue, undefined);

  for (const name of ["dev"]) {
    const command = commandModules.find(
      (candidate) => candidate.definition.name === name,
    );
    const definition = command.definition.toJSON();
    const minRap = definition.options.find(
      (option) => option.name === "min_rap",
    );
    const minValue = definition.options.find(
      (option) => option.name === "min_value",
    );

    assert.ok(minRap, `/${name} should expose min_rap`);
    assert.ok(minValue, `/${name} should expose min_value`);
    assert.equal(minRap.min_value, 150000);
    assert.equal(minValue.min_value, 150000);
  }
});


test("/target supports up to 50 results and defaults to 50", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "target",
  );
  const definition = command.definition.toJSON();
  const limit = definition.options.find((option) => option.name === "limit");

  assert.ok(limit);
  assert.equal(limit.max_value, 50);
  assert.match(limit.description, /default 50, max 50/i);
});

test("/dev defaults to and allows up to 50 developer targets", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "dev",
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

test("/rbx2adm uses a 100K RAP minimum and defaults to 50 results", async () => {
  const { rbx2admCommand } = await import("../src/commands/game-targets.js");
  const definition = rbx2admCommand.definition.toJSON();
  const minRap = definition.options.find((option) => option.name === "min_rap");
  const limit = definition.options.find((option) => option.name === "limit");

  assert.equal(minRap.min_value, 100000);
  assert.equal(limit.max_value, 50);
  assert.match(limit.description, /default 50, max 50/i);
});
