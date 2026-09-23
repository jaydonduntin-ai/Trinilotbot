import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("embedded association routes are mounted on the existing web server", async () => {
  const bridge = await readFile(
    new URL("../src/web/join-bridge.js", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../services/association-service.js", import.meta.url),
    "utf8",
  );

  assert.match(bridge, /handleAssociationRequest/);
  assert.match(bridge, /\/api\/v2\//);
  assert.match(service, /export async function handleAssociationRequest/);
  assert.doesNotMatch(service, /createServer\(/);
});
