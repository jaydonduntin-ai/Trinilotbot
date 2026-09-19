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
    "dc2rb",
    "alerts",
    "target",
    "rbx2mm2",
    "rbx2adm",
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
