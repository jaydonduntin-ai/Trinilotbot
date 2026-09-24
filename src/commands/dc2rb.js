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
      const lookup = await lookupDiscordToRoblox({
        query: discordUser,
        guildId: interaction.guildId,
      });
      association = lookup?.association ?? null;
      var providerDiagnostics = lookup?.diagnostics ?? [];
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
        `**Providers checked:** ${formatProviderDiagnostics(providerDiagnostics)}`,
      ].filter(Boolean).join("\n"),
    });
  },
};
function formatProviderDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return "No provider diagnostics available.";
  }

  return diagnostics
    .map((entry) => {
      const detail = entry?.detail ? ` (${entry.detail})` : "";
      return `${entry?.provider ?? "Unknown"}: ${entry?.status ?? "unknown"}${detail}`;
    })
    .join(" · ");
}
