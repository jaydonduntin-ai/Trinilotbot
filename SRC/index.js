import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { commandModules } from "./commands/index.js";
import { startMonitoring } from "./monitoring/monitor-service.js";
import { commandRateLimiter } from "./security/rate-limit.js";
import { initializeAlertSubscriptions } from "./storage/alert-subscribers.js";

const token = process.env.DISCORD_BOT_TOKEN?.trim();

if (!token) {
  throw new Error(
    "DISCORD_BOT_TOKEN is missing. Add it to the project's environment secrets.",
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: commandModules.map((command) => command.definition.toJSON()),
    });

    await initializeAlertSubscriptions();
    await startMonitoring(client);

    const commandNames = commandModules
      .map((command) => `/${command.definition.name}`)
      .join(", ");
    console.info(`Logged in as ${readyClient.user.tag}`);
    console.info(`Registered commands: ${commandNames}`);
  } catch (error) {
    console.error("Could not finish Discord bot startup:", error);
    await client.destroy();
    process.exitCode = 1;
  }
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
    const message = "Something went wrong while processing that command. Please try again.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

await client.login(token);
