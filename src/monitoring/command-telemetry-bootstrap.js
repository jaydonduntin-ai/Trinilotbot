import { Client, Events } from "discord.js";
import { commandModules } from "../commands/index.js";
import { installCommandTelemetry } from "./command-telemetry.js";

installCommandTelemetry({
  commandModules,
  Client,
  Events,
});
