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
    const resolved = await resolveDiscordIdentity(interaction, discordUser);
    const lookupQuery = resolved?.id ?? discordUser;
    let association = null;
    try {
      const lookup = await lookupDiscordToRoblox({
        query: lookupQuery,
        guildId: interaction.guildId,
      });
      association = lookup?.association ?? null;
      var providerDiagnostics = lookup?.diagnostics ?? [];
    } catch (sourceError) {
      console.warn("Discord-to-Roblox public source failed:", sourceError);
    }

    await interaction.reply({
      content: [
        `**Discord user:** ${resolved?.label ?? discordUser}`,
        resolved?.id && resolved.id !== discordUser
          ? `**Resolved Discord ID:** \`${resolved.id}\``
          : null,
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


async function resolveDiscordIdentity(interaction, input) {
  const mention = input.match(/^<@!?(\d+)>$/);
  if (mention) {
    return { id: mention[1], label: input };
  }
  if (/^\d+$/.test(input)) {
    return { id: input, label: input };
  }

  const guild = interaction.guild;
  if (!guild) return null;

  const needle = input.toLowerCase();
  const cached = [...guild.members.cache.values()].filter((member) => {
    const user = member.user;
    return [
      user?.username,
      user?.globalName,
      member.displayName,
      user?.tag,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === needle);
  });

  if (cached.length === 1) {
    const member = cached[0];
    return {
      id: member.id,
      label: member.user?.tag ?? member.user?.username ?? member.displayName ?? input,
    };
  }

  try {
    const fetched = await guild.members.fetch({ query: input, limit: 10 });
    const exact = [...fetched.values()].filter((member) => {
      const user = member.user;
      return [
        user?.username,
        user?.globalName,
        member.displayName,
        user?.tag,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === needle);
    });
    if (exact.length === 1) {
      const member = exact[0];
      return {
        id: member.id,
        label: member.user?.tag ?? member.user?.username ?? member.displayName ?? input,
      };
    }
  } catch (error) {
    console.warn("Could not resolve Discord member for /dc2rb:", error);
  }

  return null;
}
