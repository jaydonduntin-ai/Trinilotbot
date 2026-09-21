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
    "scan",
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


test("/rbx2mm2 is RAP-only with a 150K minimum and 50-result output cap", () => {
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

  assert.equal(minRap.min_value, 150000);
  assert.match(definition.description, /150K\+ RAP/i);
  assert.equal(limit.max_value, 50);
  assert.match(limit.description, /default 50, max 50/i);
});


test("/target is RAP-only while /scan and /dev retain RAP/value floors", () => {
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

  for (const name of ["scan", "dev"]) {
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


test("/scan is exhaustive by default and keeps an optional manual cap", () => {
  const command = commandModules.find(
    (candidate) => candidate.definition.name === "scan",
  );
  const definition = command.definition.toJSON();
  const limit = definition.options.find((option) => option.name === "limit");

  assert.ok(limit);
  assert.equal(limit.required, false);
  assert.equal(limit.max_value, 5000);
  assert.match(limit.description, /omit for exhaustive\/resumable scanning/i);
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
