import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  getAvatarThumbnail,
  getRobloxUserById,
  lookupRobloxUser,
} from "../roblox/api.js";
import { lookupDiscordToRoblox } from "../sources/associations.js";

export const dc2robloxCommand = {
  definition: new SlashCommandBuilder()
    .setName("dc2roblox")
    .setDescription("Show a server member's verified Roblox account.")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Discord member to check for a verified Roblox link.")
        .setRequired(true),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("member", true);

    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply("This command only works inside the bot's server.");
      return;
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply("That user is not a member of this server.");
      return;
    }

    await interaction.deferReply();

    try {
      const lookup = await lookupDiscordToRoblox({
        query: target.id,
        guildId: interaction.guildId,
      });
      const association = lookup?.association ?? null;
      const diagnostics = lookup?.diagnostics ?? [];

      if (!association || association.conflict) {
        const embed = new EmbedBuilder()
          .setColor(association?.conflict ? 0xfee75c : 0x2f3136)
          .setTitle(
            association?.conflict
              ? "Conflicting verified-source results"
              : "No verified Discord → Roblox link found",
          )
          .setDescription(
            association?.conflict
              ? "Configured providers returned different Roblox identities, so no match is being shown."
              : "No configured provider returned an explicit verified Roblox association for this server member.",
          )
          .addFields({
            name: "Providers checked",
            value: truncate(formatDiagnostics(diagnostics), 1000),
            inline: false,
          })
          .setThumbnail(target.displayAvatarURL({ size: 256 }));

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      let robloxUser = null;
      const numericRobloxId = Number(association.robloxId);
      if (Number.isInteger(numericRobloxId) && numericRobloxId > 0) {
        robloxUser = await getRobloxUserById(numericRobloxId).catch(() => null);
      } else if (association.robloxUsername) {
        robloxUser = await lookupRobloxUser(association.robloxUsername).catch(
          () => null,
        );
      }

      const robloxId = robloxUser?.id ?? association.robloxId ?? null;
      const username = robloxUser?.name ?? association.robloxUsername ?? "Unavailable";
      const displayName = robloxUser?.displayName ?? null;
      const avatar = robloxId
        ? await getAvatarThumbnail(robloxId).catch(() => null)
        : null;
      const profile = robloxId
        ? `https://www.roblox.com/users/${robloxId}/profile`
        : null;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Verified Discord → Roblox link")
        .addFields(
          {
            name: "Discord member",
            value: target.globalName
              ? `${target.globalName} (@${target.username}) · ID ${target.id}`
              : `@${target.username} · ID ${target.id}`,
            inline: false,
          },
          {
            name: "Roblox account",
            value: profile
              ? `[${displayName ? `${displayName} (@${username})` : `@${username}`}](${profile})`
              : displayName
                ? `${displayName} (@${username})`
                : `@${username}`,
            inline: false,
          },
          {
            name: "Roblox ID",
            value: robloxId ? String(robloxId) : "Unavailable",
            inline: true,
          },
          {
            name: "Verified source",
            value: association.source ?? "Configured verification source",
            inline: true,
          },
        )
        .setFooter({
          text: truncate(`Providers: ${formatDiagnostics(diagnostics)}`, 2000),
        });

      if (avatar) embed.setThumbnail(avatar);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Discord-to-Roblox lookup failed:", error);
      await interaction.editReply(
        "The verified Discord-to-Roblox lookup is temporarily unavailable.",
      );
    }
  },
};

function formatDiagnostics(diagnostics) {
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

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
