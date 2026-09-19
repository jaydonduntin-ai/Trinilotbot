import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { getGameValueRequirement } from "../integrations/game-values.js";
import { getRolimonsProfileUrl } from "../integrations/rolimons.js";
import { getRobloxProfile } from "../roblox/profile.js";

const LIMITEDS_PER_PAGE = 8;
const PAGINATION_TIMEOUT_MS = 120_000;

export const robloxCommand = {
  definition: new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Look up a Roblox user and show a public profile card.")
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Roblox username, user ID, or profile URL.")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100),
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username", true).trim();
    await interaction.deferReply();

    try {
      const profile = await getRobloxProfile(username);
      if (!profile) {
        await interaction.editReply(`No Roblox user was found for "${username}".`);
        return;
      }

      const totalPages = getLimitedsPageCount(profile);
      const message = await interaction.editReply({
        embeds: buildProfileEmbeds(profile, 0),
        components: buildProfileComponents(profile, interaction.id, 0, totalPages),
      });

      if (totalPages <= 1) return;

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: PAGINATION_TIMEOUT_MS,
      });

      let currentPage = 0;
      collector.on("collect", async (buttonInteraction) => {
        if (buttonInteraction.user.id !== interaction.user.id) {
          await buttonInteraction.reply({
            content: "Only the user who ran /roblox can change these pages.",
            ephemeral: true,
          });
          return;
        }

        currentPage = buttonInteraction.customId.endsWith(":next")
          ? Math.min(currentPage + 1, totalPages - 1)
          : Math.max(currentPage - 1, 0);

        await buttonInteraction.update({
          embeds: buildProfileEmbeds(profile, currentPage),
          components: buildProfileComponents(profile, interaction.id, currentPage, totalPages),
        });
      });

      collector.on("end", async () => {
        try {
          await interaction.editReply({ components: [] });
        } catch (error) {
          console.warn("Could not remove expired Roblox pagination buttons:", error);
        }
      });
    } catch (error) {
      console.error("Could not build Roblox profile card:", error);
      await interaction.editReply("Roblox is temporarily unavailable. Please try again later.");
    }
  },
};

function buildProfileEmbeds(profile, page) {
  const rolimonsUrl = getRolimonsProfileUrl(profile.id);
  const gameRequirement = getGameValueRequirement(profile.currentGame?.name);
  const description = profile.description?.trim()
    ? truncate(profile.description.trim(), 900)
    : "No profile description.";

  const profileEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${profile.displayName} (@${profile.username})${profile.hasVerifiedBadge ? " ✓" : ""}`)
    .setURL(profile.profileUrl)
    .setDescription(`${description}\n\n[Open Roblox profile](${profile.profileUrl})`)
    .addFields(
      { name: "User ID", value: String(profile.id), inline: true },
      { name: "Roblox verified", value: profile.hasVerifiedBadge ? "Yes" : "No", inline: true },
      { name: "Created", value: formatDate(profile.created), inline: true },
      { name: "Premium", value: profile.premiumStatus, inline: true },
      { name: "Inventory", value: formatInventoryStatus(profile.inventory), inline: true },
      { name: "Presence", value: profile.presenceStatus, inline: true },
      { name: "Friends", value: formatCount(profile.socialCounts?.friends), inline: true },
      { name: "Followers", value: formatCount(profile.socialCounts?.followers), inline: true },
      { name: "Following", value: formatCount(profile.socialCounts?.following), inline: true },
      { name: "Current game", value: formatCurrentGame(profile.currentGame), inline: true },
      {
        name: "Current server",
        value: formatCurrentServer(profile.currentGame),
        inline: false,
      },
      { name: "Last known game", value: profile.lastGame ?? "Unavailable", inline: true },
      { name: "Last online", value: formatLastOnline(profile.lastOnline), inline: true },
      { name: "Total RAP", value: formatTotalRAP(profile, rolimonsUrl), inline: true },
      { name: "Total value", value: formatTotalValue(profile, rolimonsUrl), inline: true },
      { name: "Roblox badges", value: formatBadges(profile.badges), inline: false },
      { name: "MM2 / Adopt Me scanner", value: formatGameValue(profile.gameValue), inline: false },
      { name: "Rolimon's", value: `[Open player profile](${rolimonsUrl})`, inline: false },
    )
    .setFooter({
      text: `Sources: ${profile.sources.join(" + ")}. Private/unavailable fields are not guessed.`,
    });

  if (profile.avatarUrl) profileEmbed.setThumbnail(profile.avatarUrl);

  if (gameRequirement) {
    profileEmbed.addFields({
      name: `${gameRequirement.label} threshold`,
      value: gameRequirement.lookupUrl
        ? `${gameRequirement.text} — [open tracker](${gameRequirement.lookupUrl})`
        : `${gameRequirement.text} — ${gameRequirement.dataStatus}`,
      inline: false,
    });
  }

  return [profileEmbed, buildLimitedsEmbed(profile, page)];
}

function buildLimitedsEmbed(profile, page) {
  const inventory = profile.inventory;
  if (!inventory) {
    return new EmbedBuilder().setColor(0x2f3136).setTitle("Limiteds").setDescription("Inventory status unavailable.");
  }
  if (inventory.status === "private") {
    return new EmbedBuilder().setColor(0x2f3136).setTitle("Limiteds").setDescription("This Roblox inventory is private.");
  }
  if (inventory.items.length === 0) {
    return new EmbedBuilder().setColor(0x2f3136).setTitle("Limiteds").setDescription("No collectible limiteds were returned by Roblox.");
  }

  const totalPages = getLimitedsPageCount(profile);
  const start = page * LIMITEDS_PER_PAGE;
  const pageItems = inventory.items.slice(start, start + LIMITEDS_PER_PAGE);
  const lines = pageItems.map((item) => {
    const itemName = escapeMarkdown(item.name);
    const assetUrl = `https://www.roblox.com/catalog/${item.assetId}`;
    const copies = item.copiesOwned ? ` · Copies: ${item.copiesOwned}` : "";
    const value = typeof item.value === "number" ? `Value: ${formatNumber(item.value)}` : "Value: Unavailable";
    const totalValue = typeof item.totalValue === "number" ? ` · Total: ${formatNumber(item.totalValue)}` : "";
    return `[${itemName}](${item.itemUrl ?? assetUrl}) — RAP: ${formatRobux(item.recentAveragePrice)} · ${value}${totalValue}${copies}`;
  });

  const suffix = inventory.hasMore
    ? "More inventory pages were not fetched; totals may be partial."
    : "RAP is Roblox recent-average-price data; values are sourced from Rolimon's when available.";

  return new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle(`Limiteds · Page ${page + 1}/${totalPages}`)
    .setDescription(`${lines.join("\n")}\n\n${suffix}`);
}

function buildPaginationRow(interactionId, page, totalPages) {
  if (totalPages <= 1) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`roblox-limiteds:${interactionId}:prev`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`roblox-limiteds:${interactionId}:next`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages - 1),
    ),
  ];
}

function buildProfileComponents(profile, interactionId, page, totalPages) {
  const links = [
    new ButtonBuilder().setLabel("Roblox profile").setStyle(ButtonStyle.Link).setURL(profile.profileUrl),
    new ButtonBuilder().setLabel("Rolimon's").setStyle(ButtonStyle.Link).setURL(getRolimonsProfileUrl(profile.id)),
  ];
  if (profile.currentGame?.followJoinUrl) {
    links.push(
      new ButtonBuilder()
        .setLabel("Join player")
        .setStyle(ButtonStyle.Link)
        .setURL(profile.currentGame.followJoinUrl),
    );
  }
  if (profile.currentGame?.gameUrl) {
    links.push(
      new ButtonBuilder()
        .setLabel("Open current game")
        .setStyle(ButtonStyle.Link)
        .setURL(profile.currentGame.gameUrl),
    );
  }
  if (profile.currentGame?.joinUrl) {
    links.push(
      new ButtonBuilder()
        .setLabel("Try exact server")
        .setStyle(ButtonStyle.Link)
        .setURL(profile.currentGame.joinUrl),
    );
  }
  return [new ActionRowBuilder().addComponents(links.slice(0, 5)), ...buildPaginationRow(interactionId, page, totalPages)];
}

function getLimitedsPageCount(profile) {
  return Math.max(1, Math.ceil((profile.inventory?.items.length ?? 0) / LIMITEDS_PER_PAGE));
}

function formatInventoryStatus(inventory) {
  if (!inventory) return "Unavailable";
  if (inventory.status === "private") return "Private";
  if (inventory.status === "public") return "Public";
  return "Unavailable";
}

function formatTotalRAP(profile, url) {
  const value = profile.inventory?.totalRAP ?? profile.rolimonsTotals?.rap;
  if (typeof value !== "number") return "Unavailable";
  const prefix = profile.inventory?.hasMore ? "At least " : "";
  return `${prefix}[${formatNumber(value)}](${url})`;
}

function formatTotalValue(profile, url) {
  const value = profile.inventory?.totalValue ?? profile.rolimonsTotals?.value;
  if (typeof value !== "number") return "Unavailable";
  return `[${formatNumber(value)}](${url})`;
}

function formatCurrentGame(game) {
  if (!game) return "Unavailable";
  return game.gameUrl ? `[${escapeMarkdown(game.name)}](${game.gameUrl})` : game.name;
}

function formatCurrentServer(game) {
  if (!game) return "Unavailable";
  const parts = [];
  if (game.placeId) parts.push(`Place ID: \`${game.placeId}\``);
  if (game.gameId) parts.push(`Job ID: \`${game.gameId}\``);
  if (game.followJoinUrl) parts.push("[Join player](<" + game.followJoinUrl + ">)");
  if (game.joinUrl) {
    parts.push(
      "[Try exact server](<" +
        game.joinUrl +
        ">) · Roblox currently has a known gameInstanceId deep-link issue",
    );
  }
  return parts.length > 0 ? parts.join("\n") : "Unavailable";
}

function formatLastOnline(value) {
  if (!value) return "Unavailable";
  const epoch = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(epoch) ? `<t:${epoch}:F> · <t:${epoch}:R>` : "Unavailable";
}

function formatDate(value) {
  if (!value) return "Unavailable";
  const epoch = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(epoch) ? `<t:${epoch}:D>` : "Unavailable";
}

function formatCount(value) {
  return typeof value === "number" ? formatNumber(value) : "Unavailable";
}

function formatBadges(badges) {
  if (!Array.isArray(badges) || badges.length === 0) return "None returned";
  return truncate(badges.map((badge) => escapeMarkdown(badge.name)).join(" · "), 1000);
}

function formatGameValue(gameValue) {
  if (!gameValue) return "Not a supported scanner game";
  if (gameValue.status === "verified") {
    const total = Number(gameValue.totalValue ?? gameValue.value);
    const valueText = Number.isFinite(total) ? `${total.toLocaleString()} ${gameValue.currency ?? "value"}` : "value unavailable";
    return `${valueText} · ${gameValue.source ?? "provider"} · ${formatTimestamp(gameValue.retrievedAt)}`;
  }
  const valueList = gameValue.valueList;
  const listText = valueList ? ` Value list: ${valueList.source} (${formatTimestamp(valueList.retrievedAt)}).` : "";
  return `User inventory unavailable — ${gameValue.reason}.${listText}`;
}

function formatTimestamp(value) {
  return value ? new Date(value).toISOString() : "timestamp unavailable";
}

function formatRobux(value) {
  return `${formatNumber(value)} RAP`;
}
function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}
