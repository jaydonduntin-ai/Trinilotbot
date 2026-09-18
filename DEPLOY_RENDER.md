# Deploy trinilotbot on Render

This package is prepared as a **Render Background Worker**. The bot does not need an incoming web server; it keeps a Discord gateway connection open.

## 1. Put the folder in a Git repository

Unzip `trinilotbot-final.zip`. Upload the **contents of the extracted folder** to a new GitHub repository so that `package.json` and `render.yaml` are at the repository root. Do not upload your `.env` file or Discord token.

## 2. Create the Render service

1. Sign in to Render.
2. Choose **New > Blueprint**.
3. Connect the GitHub repository you created.
4. Render should detect the root `render.yaml`.
5. When Render asks for `DISCORD_BOT_TOKEN`, paste the token from the Discord Developer Portal. Keep it secret.
6. Deploy the Blueprint.

`render.yaml` creates a Node background worker and runs `npm start`.

## 3. Optional environment variables

Add these from the Render dashboard only when you use the related feature:

- `ROBLOX_RBLXVALUE_API_KEY` — MM2 inventory through RBLXValue v2.
- `ROBLOX_MONITOR_CHANNEL_ID` and `ROBLOX_MONITOR_USERNAMES` — monitoring watchlist.
- `ROBLOX_TARGET_USERNAMES` — default `/targets` watchlist.
- `ROBLOX_TO_DISCORD_SOURCE_URL`, `DISCORD_TO_ROBLOX_SOURCE_URL`, `ROBLOX_ASSOCIATION_SOURCE_NAME` — a verified/authorized account-link provider. If no provider is configured, `/rbx2dc` and `/dc2rb` deliberately return Unavailable.
- Game inventory adapter URLs from `.env.example` — only when you have a legitimate compatible provider.

## 4. Invite the Discord bot

In the Discord Developer Portal, use OAuth2 URL Generator with the `bot` and `applications.commands` scopes, then invite the bot to your server. This project only requests the `Guilds` gateway intent.

## 5. Verify the deployment

In Render logs, look for:

```text
Logged in as ...
Registered commands: /ping, /roblox, /limitedowners, /rbx2dc, /dc2rb, /alerts, /targets
```

Then test in Discord:

```text
/ping
/roblox username:Roblox
/limitedowners item:Void Star limit:5
```

`/limitedowners` uses Rolimon's public limited catalog to resolve the item and Roblox's public asset-owner endpoint to list owners. It does **not** automatically track owners' live sessions.

## Notes

- The `data/alert-subscribers.json` storage is file based. On an ephemeral host, subscriber changes can reset after a redeploy/restart. Move this to a database if you need durable subscriptions.
- External providers can change or rate-limit their APIs. The bot treats a failed source as unavailable rather than fabricating data.
- Never paste your Discord token into source files or commit it to GitHub.
