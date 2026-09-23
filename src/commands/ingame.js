import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { lookupRobloxUser } from "../roblox/api.js";
import { scanGameValue } from "../providers/game-value-providers.js";

const GAMES = {
  mm2: "Murder Mystery 2",
  jailbreak: "Jailbreak",
  "adopt-me": "Adopt Me",
  "blade-ball": "Blade Ball",
  ps99: "Pet Simulator 99",
};

export const ingameCommand = {
  definition: new SlashCommandBuilder()
    .setName("ingame")
    .setDescription("Look up a Roblox user's public game inventory/value data.")
    .addStringOption((option) =>
      option
        .setName("game")
        .setDescription("Game inventory to check")
        .setRequired(true)
        .addChoices(
          { name: "Murder Mystery 2", value: "mm2" },
          { name: "Jailbreak", value: "jailbreak" },
          { name: "Adopt Me", value: "adopt-me" },
          { name: "Blade Ball", value: "blade-ball" },
          { name: "Pet Simulator 99", value: "ps99" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Roblox username")
        .setRequired(true),
    ),

  async execute(interaction) {
    const gameKey = interaction.options.getString("game", true);
    const username = interaction.options.getString("username", true).trim();
    const gameLabel = GAMES[gameKey];

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const user = await lookupRobloxUser(username);
      if (!user) {
        await interaction.editReply(`Roblox user @${username} was not found.`);
        return;
      }

      const result = await scanGameValue({
        gameName: gameLabel,
        userId: Number(user.id),
        username: user.name,
      });

      const embed = new EmbedBuilder()
        .setColor(result?.status === "verified" ? 0x57f287 : 0x2f3136)
        .setTitle(`${gameLabel} inventory — @${user.name}`)
        .setURL(`https://www.roblox.com/users/${user.id}/profile`)
        .addFields(
          { name: "Roblox user", value: `${user.name} (${user.id})`, inline: true },
          { name: "Game", value: gameLabel, inline: true },
          {
            name: "Inventory/value",
            value: formatResult(result),
            inline: false,
          },
        )
        .setFooter({ text: "Only verified public/provider data is displayed." })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("/ingame lookup failed:", error);
      await interaction.editReply(
        "The inventory lookup failed at its source. No inventory value was guessed or fabricated.",
      );
    }
  },
};

function formatResult(result) {
  if (!result || result.status !== "verified") {
    return result?.reason ?? "No verified public inventory provider returned data for this game/user.";
  }

  const total = Number(result.totalValue ?? result.value);
  const lines = [
    Number.isFinite(total)
      ? `Total: ${total.toLocaleString()} ${result.currency ?? "value"}`
      : "Total: unavailable",
    result.itemCount != null ? `Items: ${Number(result.itemCount).toLocaleString()}` : null,
    result.source ? `Source: ${result.source}` : null,
    result.scannedAt ? `Scanned: ${result.scannedAt}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}
