import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  getRobloxUserById,
  lookupRobloxUser,
} from "../roblox/api.js";
import { lookupRobloxToDiscord } from "../sources/associations.js";

export const rbx2dcCommand = {
  definition: new SlashCommandBuilder()
    .setName("rbx2dc")
    .setDescription("Look up a verified public Roblox-to-Discord account link.")
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
    await interaction.deferReply();

    try {
      const profileIdMatch = identifier.match(/roblox\.com\/users\/(\d+)/i);
      const numericId = /^\d+$/.test(identifier)
        ? Number(identifier)
        : profileIdMatch
          ? Number(profileIdMatch[1])
          : null;

      const user = Number.isInteger(numericId) && numericId > 0
        ? await getRobloxUserById(numericId).catch(() => null)
        : await lookupRobloxUser(identifier);

      if (!user) {
        await interaction.editReply(
          `No Roblox user was found for "${identifier}".`,
        );
        return;
      }

      let association = null;
      let providerDiagnostics = [];

      try {
        const lookup = await lookupRobloxToDiscord({
          userId: user.id,
          username: user.name,
          guildId: interaction.guildId,
        });
        association = lookup?.association ?? null;
        providerDiagnostics = lookup?.diagnostics ?? [];
      } catch (sourceError) {
        console.warn("Roblox-to-Discord verified source failed:", sourceError);
      }

      if (!association?.verified || !/^\d{17,20}$/.test(String(association.discordId ?? association.discordIds?.[0] ?? ""))) {
        const noMatchEmbed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setTitle("No verified Roblox → Discord link found")
          .setDescription(
            "No configured source returned an explicit verified association for this Roblox account.",
          )
          .addFields(
            {
              name: "Roblox",
              value: `[@${user.name}](https://www.roblox.com/users/${user.id}/profile) · ID ${user.id}`,
              inline: false,
            },
            {
              name: "Providers checked",
              value: truncate(formatProviderDiagnostics(providerDiagnostics), 1000),
              inline: false,
            },
          )
          .setFooter({
            text: "The command does not infer or guess Discord identities.",
          });

        await interaction.editReply({ embeds: [noMatchEmbed] });
        return;
      }

      if (association.conflict) {
        const conflictEmbed = new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("Conflicting verified-source results")
          .setDescription(
            "Configured providers returned different Discord identities, so no account is being presented as the match.",
          )
          .addFields({
            name: "Providers checked",
            value: truncate(formatProviderDiagnostics(providerDiagnostics), 1000),
            inline: false,
          });

        await interaction.editReply({ embeds: [conflictEmbed] });
        return;
      }

      const discordId = association.discordId ?? association.discordIds?.[0] ?? null;
      const discordUser = discordId
        ? await interaction.client.users.fetch(discordId, { force: true }).catch(() => null)
        : null;

      const discordUsername =
        discordUser?.username ?? association.discordUsername ?? "Unavailable";
      const discordDisplayName =
        discordUser?.globalName ?? association.discordGlobalName ?? null;
      const avatarUrl = discordUser?.displayAvatarURL({ size: 256 }) ?? null;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Verified Roblox → Discord link")
        .addFields(
          {
            name: "Roblox account",
            value: `[@${user.name}](https://www.roblox.com/users/${user.id}/profile) · ID ${user.id}`,
            inline: false,
          },
          {
            name: "Discord username",
            value: discordDisplayName
              ? `${discordDisplayName} (@${discordUsername})`
              : `@${discordUsername}`,
            inline: true,
          },
          {
            name: "Discord ID",
            value: discordId ?? "Unavailable",
            inline: true,
          },
          {
            name: "Verified source",
            value: association.source ?? "Configured association source",
            inline: true,
          },
          ...(association.evidenceUrl ? [{
            name: "Public evidence",
            value: truncate(association.evidenceUrl, 1000),
            inline: false,
          }] : []),
          {
            name: "Verification",
            value: association.corroborated
              ? "Corroborated by multiple configured sources"
              : "Verified by the returned source",
            inline: false,
          },
        )
        .setFooter({
          text: truncate(`Providers: ${formatProviderDiagnostics(providerDiagnostics)}`, 2000),
        });

      if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Could not resolve Roblox-to-Discord lookup:", error);
      await interaction.editReply(
        "The verified Roblox-to-Discord lookup is temporarily unavailable. Please try again later.",
      );
    }
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

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
