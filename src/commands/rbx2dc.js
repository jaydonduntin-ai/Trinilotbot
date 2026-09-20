import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { lookupRobloxUser } from "../roblox/api.js";
import { lookupRobloxToDiscord } from "../sources/associations.js";

export const rbx2dcCommand = {
  definition: new SlashCommandBuilder()
    .setName("rbx2dc")
    .setDescription("Look up a public Roblox-to-Discord account link.")
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Roblox username, user ID, or profile URL.")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100),
    ),

  async execute(interaction) {
    const identifier = interaction.options.getString("username", true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const profileIdMatch = identifier.match(/roblox\.com\/users\/(\d+)/i);
      const numericId = /^\d+$/.test(identifier)
        ? Number(identifier)
        : profileIdMatch
          ? Number(profileIdMatch[1])
          : null;

      const user = Number.isInteger(numericId) && numericId > 0
        ? { id: numericId, name: null }
        : await lookupRobloxUser(identifier);

      if (!user) {
        await interaction.editReply(
          `No Roblox user was found for "${identifier}".`,
        );
        return;
      }

      let association = null;
      try {
        association = await lookupRobloxToDiscord({
          userId: user.id,
          username: user.name,
          guildId: interaction.guildId,
        });
      } catch (sourceError) {
        console.warn("Roblox-to-Discord public source failed:", sourceError);
      }

      await interaction.editReply(
        [
          `**Roblox user:** ${user.name ?? `ID ${user.id}`}`,
          `**Discord username or user ID:** ${
            association?.discordUsername ??
            association?.discordId ??
            "Unavailable"
          }`,
          association
            ? `**Source:** ${association.source}${
                association.evidenceUrl
                  ? ` ([evidence](${association.evidenceUrl}))`
                  : ""
              }`
            : "No verified Roblox-to-Discord mapping was available.",
          association?.corroborated
            ? "**Verification:** Corroborated by multiple configured sources"
            : association
              ? "**Verification:** Verified by source"
              : null,
          association?.conflict
            ? "**Warning:** Providers returned conflicting Discord IDs."
            : null,
        ].filter(Boolean).join("\n"),
      );
    } catch (error) {
      console.error("Could not resolve Roblox-to-Discord lookup:", error);
      await interaction.editReply(
        "Roblox is temporarily unavailable. Please try again later.",
      );
    }
  },
};