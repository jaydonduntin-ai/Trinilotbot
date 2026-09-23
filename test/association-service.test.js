import test from "node:test";
import assert from "node:assert/strict";

test("association service source exposes both lookup routes", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../services/association-service.js", import.meta.url), "utf8"),
  );
  assert.match(source, /\/api\/v2\/roblox\/users\/get-discord/);
  assert.match(source, /\/api\/v2\/discord\/users\/get-roblox/);
  assert.match(source, /ASSOCIATION_API_KEY/);
  assert.match(source, /verified=true is required/);
});
