import { MessageFlags, Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { commandModules } from "./commands/index.js";
import { startMonitoring } from "./monitoring/monitor-service.js";
import { startTargetCandidatePoolWarmup } from "./monitoring/target-scanner.js";
import { startScanWatcher } from "./monitoring/scan-watcher.js";
import { commandRateLimiter } from "./security/rate-limit.js";
import { initializeAlertSubscriptions } from "./storage/alert-subscribers.js";
import { startJoinBridge } from "./web/join-bridge.js";

startJoinBridge();

const token = process.env.DISCORD_BOT_TOKEN?.trim();

if (!token) {
  console.error("DISCORD_BOT_TOKEN is missing. Add it to Railway Variables.");
  process.exit(1);
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const HEAVY_COMMAND_NAMES = new Set([
  "target",
  "scan",
  "rbx2mm2",
]);
const MAX_HEAVY_COMMANDS = readPositiveInteger(
  process.env.DISCORD_HEAVY_COMMAND_MAX_CONCURRENT,
  2,
);
let activeHeavyCommands = 0;

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`Discord connected as ${readyClient.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    const desiredCommands = commandModules.map((command) =>
      command.definition.toJSON(),
    );
    const existingCommands = await rest.get(
      Routes.applicationCommands(readyClient.user.id),
    );

    if (!commandDefinitionsMatch(existingCommands, desiredCommands)) {
      await rest.put(Routes.applicationCommands(readyClient.user.id), {
        body: desiredCommands,
      });

      const commandNames = desiredCommands
        .map((command) => `/${command.name}`)
        .join(", ");
      console.info(`Updated commands: ${commandNames}`);
    } else {
      console.info(
        "Slash commands already match Discord; skipped global overwrite.",
      );
    }
  } catch (error) {
    console.error(
      "Slash-command registration check failed. Keeping the bot online so the error can be diagnosed:",
      error,
    );
  }

  try {
    await initializeAlertSubscriptions();
    console.info("Alert subscription storage initialized.");
  } catch (error) {
    console.error(
      "Alert subscription storage failed to initialize. Keeping the bot online:",
      error,
    );
  }

  setTimeout(() => {
    startTargetCandidatePoolWarmup();
  }, 10_000);

  startScanWatcher(client);

  try {
    await startMonitoring(client);
  } catch (error) {
    console.error(
      "Roblox monitoring failed to initialize. Keeping the bot online:",
      error,
    );
  }

  console.info("Trinilotbot startup sequence finished.");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = commandModules.find(
      (candidate) => candidate.definition.name === interaction.commandName,
    );
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`Autocomplete /${interaction.commandName} failed:`, error);
      if (!interaction.responded) {
        await interaction.respond([]).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandModules.find(
    (candidate) => candidate.definition.name === interaction.commandName,
  );
  if (!command) return;

  try {
    const rateLimit = commandRateLimiter.check(
      `${interaction.user.id}:${interaction.commandName}`,
    );
    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
      await interaction.reply({
        content: `Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} before using this command again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isHeavyCommand =
      HEAVY_COMMAND_NAMES.has(interaction.commandName);

    if (
      isHeavyCommand &&
      activeHeavyCommands >= MAX_HEAVY_COMMANDS
    ) {
      await interaction.reply({
        content:
          "The scanner is busy with other live checks. Try again in a few seconds.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (isHeavyCommand) activeHeavyCommands += 1;
    try {
      await command.execute(interaction);
    } finally {
      if (isHeavyCommand) {
        activeHeavyCommands = Math.max(0, activeHeavyCommands - 1);
      }
    }
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    const message =
      "Something went wrong while processing that command. Please try again.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction
        .reply({ content: message, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.on(Events.ShardError, (error) => {
  console.error("Discord shard error:", error);
});

client.on(Events.Warn, (warning) => {
  console.warn("Discord warning:", warning);
});

function commandDefinitionsMatch(existingCommands, desiredCommands) {
  if (!Array.isArray(existingCommands)) return false;
  if (existingCommands.length !== desiredCommands.length) return false;

  const normalizeOption = (option) => ({
    type: Number(option?.type),
    name: option?.name ?? "",
    description: option?.description ?? "",
    required: Boolean(option?.required),
    autocomplete: Boolean(option?.autocomplete),
    min_value:
      option?.min_value === undefined ? null : Number(option.min_value),
    max_value:
      option?.max_value === undefined ? null : Number(option.max_value),
    min_length:
      option?.min_length === undefined ? null : Number(option.min_length),
    max_length:
      option?.max_length === undefined ? null : Number(option.max_length),
    choices: Array.isArray(option?.choices)
      ? option.choices.map((choice) => ({
          name: choice?.name ?? "",
          value: choice?.value ?? null,
        }))
      : [],
    options: Array.isArray(option?.options)
      ? option.options.map(normalizeOption)
      : [],
  });

  const normalizeCommand = (command) => ({
    type: Number(command?.type ?? 1),
    name: command?.name ?? "",
    description: command?.description ?? "",
    options: Array.isArray(command?.options)
      ? command.options.map(normalizeOption)
      : [],
  });

  const existing = existingCommands
    .map(normalizeCommand)
    .sort((left, right) =>
      `${left.type}:${left.name}`.localeCompare(
        `${right.type}:${right.name}`,
      ),
    );
  const desired = desiredCommands
    .map(normalizeCommand)
    .sort((left, right) =>
      `${left.type}:${left.name}`.localeCompare(
        `${right.type}:${right.name}`,
      ),
    );

  return JSON.stringify(existing) === JSON.stringify(desired);
}

try {
  await client.login(token);
} catch (error) {
  console.error(
    "Discord login failed. Check DISCORD_BOT_TOKEN in Railway Variables:",
    error,
  );
  process.exit(1);
}


function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
