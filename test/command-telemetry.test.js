import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  classifyCommandError,
  installCommandTelemetry,
  redactSensitiveText,
} from "../src/monitoring/command-telemetry.js";

test("command telemetry redacts sensitive values", () => {
  const redacted = redactSensitiveText(
    "Authorization: Bot abc.def token=secret api_key=hidden https://x.test/?token=querysecret",
  );

  assert.doesNotMatch(redacted, /abc\.def|secret|hidden|querysecret/);
  assert.match(redacted, /REDACTED/);
});

test("command telemetry classifies common recoverable failures", () => {
  assert.deepEqual(classifyCommandError({ status: 429, message: "Too Many Requests" }), {
    kind: "rate-limit",
    recoverable: true,
    action: "backoff-and-retry-upstream",
  });

  assert.equal(
    classifyCommandError(new Error("request timed out")).kind,
    "transient-network",
  );
  assert.equal(
    classifyCommandError({ status: 503, message: "upstream unavailable" }).kind,
    "upstream-5xx",
  );
});

test("command telemetry records received, started, and succeeded phases", async () => {
  class FakeClient extends EventEmitter {}
  const Events = { InteractionCreate: "interactionCreate" };
  const logs = [];
  const logger = {
    info: (message) => logs.push(message),
    error: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  };

  let executions = 0;
  const commandModules = [
    {
      definition: { name: "example" },
      async execute() {
        executions += 1;
      },
    },
  ];

  const installed = installCommandTelemetry({
    commandModules,
    Client: FakeClient,
    Events,
    logger,
    logPath: null,
    blockedAfterMs: 25,
  });

  assert.equal(installed.wrappedCount, 1);

  const interaction = {
    id: "123",
    commandName: "example",
    guildId: "guild",
    channelId: "channel",
    user: { id: "user" },
    deferred: false,
    replied: true,
    isChatInputCommand: () => true,
  };

  new FakeClient().emit(Events.InteractionCreate, interaction);
  await commandModules[0].execute(interaction);

  assert.equal(executions, 1);
  assert.ok(logs.some((line) => line.includes('"phase":"received"')));
  assert.ok(logs.some((line) => line.includes('"phase":"started"')));
  assert.ok(logs.some((line) => line.includes('"phase":"succeeded"')));
  assert.ok(logs.every((line) => !line.includes("options")));
});

test("command telemetry records a diagnosis and rethrows failures", async () => {
  class FakeClient extends EventEmitter {}
  const Events = { InteractionCreate: "interactionCreate" };
  const logs = [];
  const commandModules = [
    {
      definition: { name: "broken" },
      async execute() {
        const error = new Error("HTTP 429 Too Many Requests token=should-not-leak");
        error.status = 429;
        throw error;
      },
    },
  ];

  installCommandTelemetry({
    commandModules,
    Client: FakeClient,
    Events,
    logger: {
      info: (message) => logs.push(message),
      error: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
    logPath: null,
  });

  const interaction = {
    id: "456",
    commandName: "broken",
    guildId: "guild",
    channelId: "channel",
    user: { id: "user" },
    isChatInputCommand: () => true,
  };

  await assert.rejects(() => commandModules[0].execute(interaction), /429/);

  const failure = logs.find((line) => line.includes('"phase":"failed"'));
  assert.ok(failure);
  assert.match(failure, /"diagnosis":"rate-limit"/);
  assert.doesNotMatch(failure, /should-not-leak/);
});
