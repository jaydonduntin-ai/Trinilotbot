# trinilotbot — finalized portable build

Node.js + `discord.js` bot for public Roblox lookups and Discord slash commands. The package is portable: it can run with `npm start`, Docker, or the included Render Blueprint.

## Commands

- `/ping` — health check.
- `/roblox username:<name>` — public Roblox profile card with avatar, user ID, description, creation date, verified badge status, friend/follower/following counts, presence, public current game, last-online data when a source actually provides it, inventory privacy status, limiteds, RAP/value, Roblox badges, and links. RAP/value link to the player's Rolimon's profile. An exact-server join button is shown only when Roblox confirms that public server instance.
- `/limitedowners item:<name|acronym|asset-id> limit:<1-25>` — autocomplete across Rolimon's limited catalog and list public owners returned by Roblox's public asset-owner endpoint, with Roblox/Rolimon's profile links and serials when returned. No live-session tracking is added to this command.
- `/rbx2dc username:<name>` — verified public Roblox-to-Discord mapping when a compatible association provider is configured; otherwise `Unavailable`.
- `/dc2rb discord_user:<name-or-id>` — verified public Discord-to-Roblox mapping when a compatible association provider is configured; otherwise `Unavailable`.
- `/alerts action:<enable|disable|status>` — opt in/out of monitor mentions.
- `/targets` — watchlist-only active-player scan, maximum 7 results, with minimum RAP filter and public exact-server join requirement. Use `/limitedowners` for automatic public owner discovery instead of supplying a username.

## Data rules

Public Roblox APIs are used for profile/presence/social/inventory/owner information. Rolimon's is used for public market/item data and player-value links, with caching and fallback endpoints. The bot does not guess private inventories, account links, IDs, values, or server instance IDs. Unsupported fields are shown as unavailable.

RBLXValue v2 is supported for MM2 when `ROBLOX_RBLXVALUE_API_KEY` is present. Value-list websites stay separate from proof of a user's inventory. Optional inventory adapters must return verified structured JSON before the bot displays their user-specific values.

## Quick start

```bash
npm install
npm test
npm start
```

Set `DISCORD_BOT_TOKEN` in the environment first. Copy `.env.example` only as a reference; do not commit real secrets.

For Render, follow **DEPLOY_RENDER.md**. The repository-root `render.yaml` creates a Node background worker.

## Required vs optional configuration

The only required secret is `DISCORD_BOT_TOKEN`. Optional features are enabled with the variables documented in `.env.example`. `/limitedowners` does not require a secret API key because its Roblox owner lookup is a public endpoint. `/rbx2dc` and `/dc2rb` need a verified/authorized association source configured through the two source URL templates; they intentionally do not infer account ownership.

## Association adapter contract

`ROBLOX_TO_DISCORD_SOURCE_URL` and `DISCORD_TO_ROBLOX_SOURCE_URL` must be HTTPS URL templates. Supported placeholders include `{robloxId}`, `{robloxUsername}`, `{discordQuery}`, `{discordId}`, and `{discordUsername}`. The provider must return JSON with `verified: true`.

Roblox-to-Discord example:

```json
{
  "verified": true,
  "roblox": {"id": 1, "username": "Roblox"},
  "discord": {"id": "123", "username": "example"},
  "evidenceUrl": "https://provider.example/evidence"
}
```

Discord-to-Roblox example:

```json
{
  "verified": true,
  "discord": {"id": "123", "username": "example"},
  "roblox": {"id": 1, "username": "Roblox"},
  "evidenceUrl": "https://provider.example/evidence"
}
```

## Deployment caveat

`data/alert-subscribers.json` is local file storage. On hosts with ephemeral filesystems, alert subscriptions may reset after a restart/deploy. The bot itself still runs; use a database later if durable subscriptions matter.
