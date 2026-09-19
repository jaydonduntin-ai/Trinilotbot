import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { commandModules } from "./commands/index.js";
import { startMonitoring } from "./monitoring/monitor-service.js";
import { startTargetCandidatePoolWarmup } from "./monitoring/target-scanner.js";
import { commandRateLimiter } from "./security/rate-limit.js";
import { initializeAlertSubscriptions } from "./storage/alert-subscribers.js";

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

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`Discord connected as ${readyClient.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: commandModules.map((command) => command.definition.toJSON()),
    });

    const commandNames = commandModules
      .map((command) => `/${command.definition.name}`)
      .join(", ");
    console.info(`Registered commands: ${commandNames}`);
  } catch (error) {
    console.error(
      "Slash-command registration failed. Keeping the bot online so the error can be diagnosed:",
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

  startTargetCandidatePoolWarmup();

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
        ephemeral: true,
      });
      return;
    }

    await command.execute(interaction);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    const message =
      "Something went wrong while processing that command. Please try again.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction
        .reply({ content: message, ephemeral: true })
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

try {
  await client.login(token);
} catch (error) {
  console.error(
    "Discord login failed. Check DISCORD_BOT_TOKEN in Railway Variables:",
    error,
  );
  process.exit(1);
}
