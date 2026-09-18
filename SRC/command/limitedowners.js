import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  findRolimonsItem,
  searchRolimonsItems,
} from "../sources/rolimons-items.js";
import { getAssetOwners, getRobloxUserById } from "../roblox/api.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export const limitedOwnersCommand = {
  definition: new SlashCommandBuilder()
    .setName("limitedowners")
    .setDescription("Find public owners of a Rolimon's limited item.")
    .addStringOption((option) =>
      option
        .setName("item")
        .setDescription("Limited name, acronym, or asset ID.")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(`Number of owners to return, up to ${MAX_LIMIT}.`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    try {
      const matches = await searchRolimonsItems(focused, 25);
      await interaction.respond(
        matches.map((item) => ({
          name: `${item.name}${item.acronym ? ` (${item.acronym})` : ""} · ${formatNumber(item.value)} value`.slice(0, 100),
          value: String(item.id),
        })),
      );
    } catch (error) {
      console.warn("Limited autocomplete failed:", error);
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    const query = interaction.options.getString("item", true).trim();
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    await interaction.deferReply();

    try {
      const item = await findRolimonsItem(query);
      if (!item) {
        await interaction.editReply(`No Rolimon's limited matched **${escapeMarkdown(query)}**.`);
        return;
      }

      const ownerResult = await getAssetOwners(item.id, { limit });
      if (ownerResult.owners.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2f3136)
              .setTitle(item.name)
              .setURL(item.rolimonsUrl)
              .setDescription(
                "Roblox returned no public asset owners for this item. Some collectible types, especially migrated faces/bundles, may not be enumerable from the asset-owner endpoint.",
              ),
          ],
        });
        return;
      }

      const users = await Promise.all(
        ownerResult.owners.map(async (owner) => {
          try {
            const user = await getRobloxUserById(owner.userId);
            return { owner, user };
          } catch {
            return { owner, user: null };
          }
        }),
      );

      const lines = users.map(({ owner, user }, index) => {
        const username = user?.name ?? `User ${owner.userId}`;
        const roblox = `https://www.roblox.com/users/${owner.userId}/profile`;
        const rolimons = getRolimonsProfileUrl(owner.userId);
        const serial = owner.serialNumber ? ` · Serial #${owner.serialNumber}` : "";
        return `${index + 1}. [${escapeMarkdown(username)}](${roblox}) · [Rolimon's](${rolimons})${serial}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(item.name)
        .setURL(item.rolimonsUrl)
        .setDescription(lines.join("\n"))
        .addFields(
          { name: "Asset ID", value: String(item.id), inline: true },
          { name: "RAP", value: `[${formatNumber(item.rap)}](${item.rolimonsUrl})`, inline: true },
          { name: "Value", value: `[${formatNumber(item.value)}](${item.rolimonsUrl})`, inline: true },
          { name: "Rolimon's", value: `[Open item](${item.rolimonsUrl})`, inline: true },
          { name: "Roblox", value: `[Open catalog](${item.robloxUrl})`, inline: true },
          {
            name: "Owners shown",
            value: `${ownerResult.owners.length}${ownerResult.hasMore ? "+" : ""}`,
            inline: true,
          },
        )
        .setFooter({
          text: "Item data: Rolimon's. Ownership: Roblox public Inventory API. No live-session tracking is performed.",
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Could not load limited owners:", error);
      await interaction.editReply(
        "Limited-owner lookup is temporarily unavailable. Please try again later.",
      );
    }
  },
};

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}
