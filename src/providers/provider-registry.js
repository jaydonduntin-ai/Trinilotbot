const providers = new Map();

export function registerProvider(provider) {
  if (!provider?.name || !Array.isArray(provider.capabilities)) {
    throw new TypeError("A provider needs a name and capabilities.");
  }

  providers.set(provider.name, provider);
  return provider;
}

export function getProviders(capability) {
  return [...providers.values()].filter((provider) =>
    provider.capabilities.includes(capability),
  );
}

export async function queryProviders(
  capability,
  input,
  { logger = console } = {},
) {
  const matchingProviders = getProviders(capability);
  const results = [];

  for (const provider of matchingProviders) {
    if (typeof provider.query !== "function") {
      continue;
    }

    try {
      const result = await provider.query(input);
      if (result) {
        results.push({ provider: provider.name, ...result });
      }
    } catch (error) {
      logger.warn?.(`Provider ${provider.name} failed:`, error);
    }
  }

  return results;
}

export function clearProvidersForTests() {
  providers.clear();
}
