import { getLimitedInventory, RobloxApiError } from "./api.js";

const DEFAULT_MAX_PAGES = 5;

export async function getInventorySummary(userId, options = {}) {
  try {
    const inventory = await getLimitedInventory(userId, {
      maxPages: options.maxPages ?? getMaxInventoryPages(),
    });

    const totalRAP = inventory.items.reduce(
      (total, item) => total + item.recentAveragePrice,
      0,
    );

    return {
      status: "public",
      items: inventory.items,
      itemCount: inventory.items.length,
      totalRAP,
      totalValue: null,
      pagesFetched: inventory.pagesFetched,
      hasMore: inventory.hasMore,
    };
  } catch (error) {
    if (error instanceof RobloxApiError && [401, 403].includes(error.status)) {
      return {
        status: "private",
        items: [],
        itemCount: 0,
        totalRAP: null,
        totalValue: null,
        pagesFetched: 0,
        hasMore: false,
      };
    }
    throw error;
  }
}

function getMaxInventoryPages() {
  const value = Number(process.env.ROBLOX_INVENTORY_MAX_PAGES);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_PAGES;
}
