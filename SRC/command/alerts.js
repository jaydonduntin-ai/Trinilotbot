import { SlashCommandBuilder } from "discord.js";
import {
  getAlertSubscription,
  setAlertSubscription,
} from "../storage/alert-subscribers.js";

export const alertsCommand = {
  definition: new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("Opt in or out of Roblox monitor alerts.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Choose whether to receive monitor alerts.")
        .setRequired(true)
        .addChoices(
          { name: "Enable alerts", value: "enable" },
          { name: "Disable alerts", value: "disable" },
          { name: "Check status", value: "status" },
        ),
    ),

  async execute(interaction) {
    const action = interaction.options.getString("action", true);
    const discordUserId = interaction.user.id;

    if (action === "status") {
      const status = (await getAlertSubscription(discordUserId))
        ? "enabled"
        : "disabled";
      await interaction.reply({
        content: `Roblox monitor alerts are currently **${status}** for you.`,
        ephemeral: true,
      });
      return;
    }

    const enabled = action === "enable";
    await setAlertSubscription(discordUserId, enabled);
    await interaction.reply({
      content: enabled
        ? "Roblox monitor alerts are enabled for you."
        : "Roblox monitor alerts are disabled for you.",
      ephemeral: true,
    });
  },
};