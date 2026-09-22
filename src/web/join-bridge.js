import { createServer } from "node:http";
import {
  getUserPresence,
  getUsersPresenceFallback,
  isPublicGameInstance,
} from "../roblox/api.js";

let server = null;

export function startJoinBridge({ healthCheck = null } = {}) {
  if (server) return server;

  const port = Number(process.env.PORT) || 3000;

  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        const healthy = resolveHealthStatus(healthCheck);
        res.writeHead(healthy ? 200 : 503, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(healthy ? "ok" : "not ready");
        return;
      }

      const verifiedUserMatch = url.pathname.match(
        /^\/join\/verified-user\/(\d+)$/,
      );
      if (verifiedUserMatch) {
        const userId = Number(verifiedUserMatch[1]);
        if (!Number.isInteger(userId) || userId <= 0) {
          return sendNotFound(res);
        }

        let presence = null;
        try {
          presence = await getUserPresence(userId);
        } catch (error) {
          if (Number(error?.status) === 429) {
            try {
              presence = (await getUsersPresenceFallback([userId]))?.[0] ?? null;
            } catch (fallbackError) {
              console.warn(
                "Verified join presence fallback failed:",
                fallbackError,
              );
            }
          } else {
            console.warn("Verified join presence lookup failed:", error);
          }
        }

        if (
          Number(presence?.userPresenceType) !== 2 ||
          !presence?.placeId ||
          !presence?.gameId
        ) {
          return sendUnavailableJoinPage(res, {
            title: "Player is not publicly joinable",
            message:
              "Roblox no longer reports this user in a specific game server. They may have left, moved servers, or hidden join details.",
            profileUrl:
              `https://www.roblox.com/users/${encodeURIComponent(userId)}/profile`,
          });
        }

        let publicServer = false;
        try {
          publicServer = await isPublicGameInstance(
            presence.placeId,
            presence.gameId,
            {
              maxPages: Number(
                process.env.ROBLOX_JOIN_VERIFY_MAX_PAGES ?? 10,
              ),
            },
          );
        } catch (error) {
          console.warn("Verified join public-server lookup failed:", error);
        }

        if (!publicServer) {
          return sendUnavailableJoinPage(res, {
            title: "Current server is not publicly joinable",
            message:
              "The player is in-game, but Roblox did not expose that JobId in the public-server list. It may be private, reserved, restricted, or no longer current.",
            profileUrl:
              `https://www.roblox.com/users/${encodeURIComponent(userId)}/profile`,
            gameUrl:
              `https://www.roblox.com/games/${encodeURIComponent(presence.placeId)}`,
          });
        }

        return sendJoinPage(res, {
          title: "Join verified Roblox server",
          appUrl:
            `roblox://placeId=${encodeURIComponent(presence.placeId)}` +
            `&gameInstanceId=${encodeURIComponent(presence.gameId)}`,
          fallbackUrl:
            `https://www.roblox.com/games/${encodeURIComponent(presence.placeId)}`,
          fallbackLabel: "Open experience page",
        });
      }

      const userMatch = url.pathname.match(/^\/join\/user\/(\d+)$/);
      if (userMatch) {
        const userId = Number(userMatch[1]);
        if (!Number.isInteger(userId) || userId <= 0) {
          return sendNotFound(res);
        }

        return sendJoinPage(res, {
          title: "Join Roblox player",
          appUrl: `roblox://userId=${encodeURIComponent(userId)}`,
          fallbackUrl:
            `https://www.roblox.com/users/${encodeURIComponent(userId)}/profile`,
          fallbackLabel: "Open Roblox profile",
        });
      }

      const serverMatch = url.pathname.match(
        /^\/join\/server\/(\d+)\/([A-Za-z0-9-]+)$/,
      );
      if (serverMatch) {
        const placeId = Number(serverMatch[1]);
        const gameId = serverMatch[2];

        if (!Number.isInteger(placeId) || placeId <= 0 || !gameId) {
          return sendNotFound(res);
        }

        return sendJoinPage(res, {
          title: "Join Roblox server",
          appUrl:
            `roblox://placeId=${encodeURIComponent(placeId)}` +
            `&gameInstanceId=${encodeURIComponent(gameId)}`,
          fallbackUrl:
            `https://www.roblox.com/games/${encodeURIComponent(placeId)}`,
          fallbackLabel: "Open experience page",
        });
      }

      const gameMatch = url.pathname.match(/^\/join\/game\/(\d+)$/);
      if (gameMatch) {
        const placeId = Number(gameMatch[1]);
        if (!Number.isInteger(placeId) || placeId <= 0) {
          return sendNotFound(res);
        }

        return sendJoinPage(res, {
          title: "Open Roblox experience",
          appUrl: `roblox://placeId=${encodeURIComponent(placeId)}`,
          fallbackUrl:
            `https://www.roblox.com/games/${encodeURIComponent(placeId)}`,
          fallbackLabel: "Open experience page",
        });
      }

      sendNotFound(res);
    } catch (error) {
      console.error("Join bridge request failed:", error);
      res.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("Unable to open Roblox right now.");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.info(`Roblox join bridge listening on port ${port}.`);
  });

  return server;
}

function sendJoinPage(
  res,
  { title, appUrl, fallbackUrl, fallbackLabel },
) {
  const safeTitle = escapeHtml(title);
  const safeAppUrl = escapeHtml(appUrl);
  const safeFallbackUrl = escapeHtml(fallbackUrl);
  const safeFallbackLabel = escapeHtml(fallbackLabel);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0d10; color:#fff; }
    main { width:min(92vw,420px); padding:28px; box-sizing:border-box; text-align:center; }
    h1 { font-size:26px; margin:0 0 12px; }
    p { color:#b9bec7; line-height:1.45; }
    a { display:block; padding:16px 18px; margin-top:14px; border-radius:12px; text-decoration:none; font-weight:700; }
    .primary { background:#fff; color:#111; }
    .secondary { background:#23272f; color:#fff; }
    small { display:block; color:#858b95; margin-top:18px; line-height:1.4; }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>Launching Roblox directly…</p>
    <a id="open-roblox" class="primary" href="${safeAppUrl}">Launch Roblox</a>
    <a class="secondary" href="${safeFallbackUrl}">${safeFallbackLabel}</a>
    <small>If your browser blocks the automatic handoff, click <b>Launch Roblox</b>. The fallback opens the Roblox profile/experience instead of a legacy 404 route.</small>
  </main>
  <script>
    window.location.href = ${JSON.stringify(appUrl)};
  </script>
</body>
</html>`;

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}


function sendUnavailableJoinPage(
  res,
  { title, message, profileUrl, gameUrl = null },
) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeProfileUrl = escapeHtml(profileUrl);
  const safeGameUrl = gameUrl ? escapeHtml(gameUrl) : null;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0d10; color:#fff; }
    main { width:min(92vw,440px); padding:28px; box-sizing:border-box; text-align:center; }
    h1 { font-size:24px; margin:0 0 12px; }
    p { color:#b9bec7; line-height:1.5; }
    a { display:block; padding:16px 18px; margin-top:14px; border-radius:12px; text-decoration:none; font-weight:700; background:#23272f; color:#fff; }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${safeGameUrl ? `<a href="${safeGameUrl}">Open experience</a>` : ""}
    <a href="${safeProfileUrl}">Open Roblox profile</a>
  </main>
</body>
</html>`;

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}


function sendNotFound(res) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end("Not found");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


export function resolveHealthStatus(healthCheck) {
  if (typeof healthCheck !== "function") return true;
  try {
    return healthCheck() === true;
  } catch {
    return false;
  }
}
