import { MessageFlags, Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { commandModules } from "./commands/index.js";
import { startMonitoring } from "./monitoring/monitor-service.js";
import { startTargetCandidatePoolWarmup } from "./monitoring/target-scanner.js";
import { startScanWatcher } from "./monitoring/scan-watcher.js";
import { commandRateLimiter } from "./security/rate-limit.js";
import { initializeAlertSubscriptions } from "./storage/alert-subscribers.js";
import { getScanWatchlist } from "./storage/scan-watchlist.js";
import { startJoinBridge } from "./web/join-bridge.js";
import {
  isGuildAllowed,
  resolveAllowedGuildIds,
  setAllowedGuildIds,
} from "./security/guild-lock.js";

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
let allowedGuildIds = new Set();
let applicationManagerUserIds = new Set();

const WATCHDOG_INTERVAL_MS = 10_000;
let lastWatchdogTickAt = Date.now();
let watchdogLagStrikes = 0;

function startLocalWatchdog() {
  const timer = setInterval(() => {
    const now = Date.now();
    const lagMs = Math.max(0, now - lastWatchdogTickAt - WATCHDOG_INTERVAL_MS);
    lastWatchdogTickAt = now;

    const ready = client.isReady();
    const memory = process.memoryUsage();
    const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
    const rssMb = Math.round(memory.rss / 1024 / 1024);

    if (lagMs > 5_000) {
      watchdogLagStrikes += 1;
      console.warn(
        `Watchdog: event-loop lag ${lagMs}ms · strike ${watchdogLagStrikes}.`,
      );
    } else {
      watchdogLagStrikes = 0;
    }

    if (!ready) {
      console.warn("Watchdog: Discord client is not ready.");
    }

    if (watchdogLagStrikes >= 3) {
      console.error(
        "Watchdog: repeated event-loop stalls detected; exiting for Railway restart.",
      );
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 250).unref?.();
      return;
    }

    if (rssMb > 768) {
      console.error(
        `Watchdog: RSS ${rssMb}MB exceeded safety ceiling; exiting for Railway restart.`,
      );
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 250).unref?.();
      return;
    }

    if (now % 60_000 < WATCHDOG_INTERVAL_MS) {
      console.info(
        `Watchdog healthy · discord=${ready ? "ready" : "not-ready"} · heap=${heapUsedMb}MB · rss=${rssMb}MB · heavy=${activeHeavyCommands}.`,
      );
    }
  }, WATCHDOG_INTERVAL_MS);

  timer.unref?.();
}

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`Discord connected as ${readyClient.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    const response = await fetch(
      "https://discord.com/api/v10/applications/@me",
      {
        headers: { Authorization: `Bot ${token}` },
      },
    );
    if (response.ok) {
      const application = await response.json();
      const managerIds = new Set();
      const ownerId = application?.owner?.id;
      const teamOwnerId = application?.team?.owner_user_id;
      if (ownerId) managerIds.add(String(ownerId));
      if (teamOwnerId) managerIds.add(String(teamOwnerId));
      for (const member of application?.team?.members ?? []) {
        if (member?.user?.id && Number(member?.membership_state) === 2) {
          managerIds.add(String(member.user.id));
        }
      }
      applicationManagerUserIds = managerIds;
      console.info(
        `Discord application managers resolved: ${applicationManagerUserIds.size}.`,
      );

      const integrationConfig =
        application?.integration_types_config ?? {};
      if (
        Object.prototype.hasOwnProperty.call(integrationConfig, "1") &&
        integrationConfig?.["0"]
      ) {
        const privateInstallResponse = await fetch(
          "https://discord.com/api/v10/applications/@me",
          {
            method: "PATCH",
            headers: {
              Authorization: `Bot ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              integration_types_config: {
                "0": integrationConfig["0"],
              },
            }),
          },
        );

        if (privateInstallResponse.ok) {
          const updatedApplication =
            await privateInstallResponse.json();
          const updatedKeys = Object.keys(
            updatedApplication?.integration_types_config ?? {},
          );
          if (!updatedKeys.includes("1")) {
            console.info(
              "Discord USER_INSTALL disabled; app install context is guild-only.",
            );
          } else {
            console.warn(
              "Discord accepted the USER_INSTALL restriction request but USER_INSTALL is still enabled.",
            );
          }
        } else {
          console.warn(
            `Could not disable Discord USER_INSTALL via API: HTTP ${privateInstallResponse.status}.`,
          );
        }
      } else {
        console.info(
          "Discord USER_INSTALL is already disabled or no guild-install configuration is available.",
        );
      }
    } else {
      console.warn(
        `Could not resolve Discord application managers: HTTP ${response.status}.`,
      );
    }
  } catch (error) {
    console.warn("Could not resolve Discord application managers:", error);
  }

  try {
    const lock = await resolveAllowedGuildIds(
      [...readyClient.guilds.cache.keys()],
    );
    allowedGuildIds = lock.guildIds;

    if (allowedGuildIds.size === 0) {
      console.warn(
        "Discord guild lock is waiting for a trusted guild bootstrap.",
      );

      const delayedGuildBootstrap = setTimeout(async () => {
        if (allowedGuildIds.size > 0) return;
        try {
          const retry = await resolveAllowedGuildIds(
            [...readyClient.guilds.cache.keys()],
          );
          if (retry.guildIds.size === 1) {
            allowedGuildIds = retry.guildIds;
            console.info(
              `Discord guild lock bootstrapped after gateway sync: ${allowedGuildIds.size} allowed guild.`,
            );
            return;
          }

          const watchlist = await getScanWatchlist();
          const channelFrequency = new Map();
          for (const entry of watchlist) {
            for (const rawChannelId of entry?.channels ?? []) {
              const channelId = String(rawChannelId ?? "").trim();
              if (!/^\d+$/.test(channelId)) continue;
              channelFrequency.set(
                channelId,
                (channelFrequency.get(channelId) ?? 0) + 1,
              );
            }
          }

          const likelyChannelIds = [...channelFrequency.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 10)
            .map(([channelId]) => channelId);

          const discoveredGuildIds = new Set();
          for (const channelId of likelyChannelIds) {
            try {
              const channel = await readyClient.channels.fetch(channelId);
              const guildId = channel?.guildId ?? channel?.guild?.id;
              if (guildId) discoveredGuildIds.add(String(guildId));
              if (discoveredGuildIds.size > 1) break;
            } catch {
              // Historical channels may have been deleted or may not be
              // visible to the bot anymore; skip them.
            }
          }

          if (discoveredGuildIds.size === 1) {
            allowedGuildIds = await setAllowedGuildIds(
              discoveredGuildIds,
            );
            console.info(
              "Discord guild lock bootstrapped from persisted scan history.",
            );
          }
        } catch (error) {
          console.warn(
            "Delayed Discord guild-lock bootstrap failed:",
            error,
          );
        }
      }, 5_000);
      delayedGuildBootstrap.unref?.();
    } else {
      console.info(
        `Discord guild lock active: ${allowedGuildIds.size} allowed guild(s) · source=${lock.source}${lock.bootstrapped ? " · bootstrapped" : ""}.`,
      );

      for (const guild of readyClient.guilds.cache.values()) {
        if (!isGuildAllowed(guild.id, allowedGuildIds)) {
          console.warn(
            `Leaving unauthorized Discord guild ${guild.id} during startup.`,
          );
          await guild.leave().catch((error) => {
            console.error(
              `Failed to leave unauthorized guild ${guild.id}:`,
              error,
            );
          });
        }
      }
    }
  } catch (error) {
    console.error("Discord guild lock failed to initialize:", error);
  }

  try {
    const desiredCommands = commandModules.map((command) => ({
      ...command.definition.toJSON(),
      // Restrict slash commands to server installs and guild channels only.
      // This prevents user-installed copies of the app from exposing commands
      // in other servers/DMs even while Discord's portal-only Public Bot
      // toggle is still enabled.
      integration_types: [0],
      contexts: [0],
    }));
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

  startLocalWatchdog();
  console.info("Trinilotbot startup sequence finished.");
});

client.on(Events.GuildCreate, async (guild) => {
  if (allowedGuildIds.size === 0) {
    console.warn(
      `Guild ${guild.id} became available while the private guild lock is unresolved; waiting for owner bootstrap.`,
    );
    return;
  }

  if (!isGuildAllowed(guild.id, allowedGuildIds)) {
    console.warn(
      `Unauthorized Discord guild ${guild.id} attempted to add the bot; leaving immediately.`,
    );
    await guild.leave().catch((error) => {
      console.error(
        `Failed to leave unauthorized guild ${guild.id}:`,
        error,
      );
    });
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

  if (
    allowedGuildIds.size === 0 &&
    interaction.guildId &&
    applicationManagerUserIds.has(String(interaction.user.id))
  ) {
    try {
      allowedGuildIds = await setAllowedGuildIds([
        interaction.guildId,
      ]);
      console.info(
        "Discord guild lock bootstrapped from an application-manager interaction.",
      );
    } catch (error) {
      console.error(
        "Failed to persist Discord guild lock from owner interaction:",
        error,
      );
    }
  }

  if (
    !interaction.guildId ||
    !isGuildAllowed(interaction.guildId, allowedGuildIds)
  ) {
    await interaction.reply({
      content: "This app is locked to its private server.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

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
    integration_types: Array.isArray(command?.integration_types)
      ? command.integration_types.map(Number).sort((a, b) => a - b)
      : [],
    contexts: Array.isArray(command?.contexts)
      ? command.contexts.map(Number).sort((a, b) => a - b)
      : [],
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
