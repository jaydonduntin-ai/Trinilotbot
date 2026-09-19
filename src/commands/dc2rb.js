import { SlashCommandBuilder } from "discord.js";
import { lookupDiscordToRoblox } from "../sources/associations.js";

export const dc2rbCommand = {
  definition: new SlashCommandBuilder()
    .setName("dc2rb")
    .setDescription("Look up a public Discord-to-Roblox account link.")
    .addStringOption((option) =>
      option
        .setName("discord_user")
        .setDescription("A Discord username or public Discord user ID.")
        .setRequired(true)
        .setMaxLength(100),
    ),

  async execute(interaction) {
    const discordUser = interaction.options
      .getString("discord_user", true)
      .trim();
    let association = null;
    try {
      association = await lookupDiscordToRoblox({
        query: discordUser,
        guildId: interaction.guildId,
      });
    } catch (sourceError) {
      console.warn("Discord-to-Roblox public source failed:", sourceError);
    }

    await interaction.reply({
      content: [
        `**Discord user:** ${discordUser}`,
        `**Roblox username or user ID:** ${
          association?.robloxUsername ?? association?.robloxId ?? "Unavailable"
        }`,
        association
          ? `**Source:** ${association.source}${
              association.evidenceUrl
                ? ` ([evidence](${association.evidenceUrl}))`
                : ""
            }`
          : "No verified Discord-to-Roblox mapping was available.",
        association?.corroborated
          ? "**Verification:** Corroborated by multiple configured sources"
          : association
            ? "**Verification:** Verified by source"
            : null,
        association?.conflict
          ? "**Warning:** Providers returned conflicting Roblox IDs."
          : null,
      ].filter(Boolean).join("\n"),
      ephemeral: true,
    });
  },
};