import { SlashCommandBuilder } from "discord.js";
import { lookupRobloxUser } from "../roblox/api.js";
import { lookupRobloxToDiscord } from "../sources/associations.js";

export const rbx2dcCommand = {
  definition: new SlashCommandBuilder()
    .setName("rbx2dc")
    .setDescription("Look up a public Roblox-to-Discord account link.")
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("The Roblox username to look up.")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(20),
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username", true).trim();
    await interaction.deferReply({ ephemeral: true });

    try {
      const user = await lookupRobloxUser(username);

      if (!user) {
        await interaction.editReply(
          `No Roblox user was found for "${username}".`,
        );
        return;
      }

      let association = null;
      try {
        association = await lookupRobloxToDiscord({
          userId: user.id,
          username: user.name,
        });
      } catch (sourceError) {
        console.warn("Roblox-to-Discord public source failed:", sourceError);
      }

      await interaction.editReply(
        [
          `**Roblox user:** ${user.name}`,
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
            : "No verified public Roblox-to-Discord mapping was available.",
        ].join("\n"),
      );
    } catch (error) {
      console.error("Could not resolve Roblox-to-Discord lookup:", error);
      await interaction.editReply(
        "Roblox is temporarily unavailable. Please try again later.",
      );
    }
  },
};